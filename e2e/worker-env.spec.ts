import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { expect, test } from "@playwright/test";

// Issue #64: in the local docker compose stack the `worker` reads the same
// repo-root `.env` as the web app (AI layer keys and providers), so Job Searches
// and job discovery are not skipped. Inside the compose network its
// DATABASE_URL still points at postgres:5432, whatever the `.env` says, and a
// missing `.env` does not break `docker compose up`.
//
// Driven through the public entry point, the `docker compose` CLI, under its own
// project name and a free host port, so a developer's running stack is left alone.
// Each test writes its own repo-root `.env`; a developer's own `.env` is moved
// aside for the duration and put back. Set E2E_SKIP_DOCKER=1 to skip.

const rootEnv = ".env";
const backup = `.env.e2e-worker-backup-${process.pid}`;
const project = `jobhub-e2e-worker-env-${process.pid}`;
let postgresPort = Number(process.env.E2E_POSTGRES_PORT ?? 0);

function composeCommand(): string[] {
  if (spawnSync("docker", ["compose", "version"]).status === 0) return ["docker", "compose"];
  if (spawnSync("docker-compose", ["version"]).status === 0) return ["docker-compose"];
  return [];
}

const compose = composeCommand();

/** The environment of a fresh shell: none of the app's settings (every key of .env.example). */
function shellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PORT: String(postgresPort) };
  for (const line of readFileSync(".env.example", "utf8").split("\n")) {
    const key = line.replace(/^#\s*/, "").match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
    if (key) delete env[key];
  }
  return env;
}

function run(...args: string[]): string {
  const [bin, ...base] = compose;
  return execFileSync(bin!, [...base, "-p", project, ...args], { env: shellEnv(), encoding: "utf8", stdio: "pipe" });
}

/** `.env.example`, as copied by the README, with the given keys changed (or added). */
function exampleWith(values: Record<string, string>): string {
  let text = readFileSync(".env.example", "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^#?\\s*${key}=.*$`, "m");
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text}\n${key}=${value}\n`;
  }
  return text;
}

/** A developer's `.env`: the example, with every AI task on Mistral (EU) and their keys filled in. */
const validEnv = () =>
  exampleWith({
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    AI_CV_PARSING_PROVIDER: "mistral",
    AI_OFFER_ANALYSIS_PROVIDER: "mistral",
    AI_WEB_SEARCH_PROVIDER: "perplexity",
    MISTRAL_API_KEY: "e2e-worker-env-mistral-key",
    PERPLEXITY_API_KEY: "e2e-worker-env-perplexity-key",
  });

type ComposeConfig = { services: Record<string, { environment?: Record<string, string | null> }> };
const workerEnvironment = () =>
  (JSON.parse(run("config", "--format", "json")) as ComposeConfig).services.worker!.environment ?? {};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** Waits until the worker has started its job runner, so its startup log is complete. */
async function workerStarted(): Promise<string> {
  await expect
    .poll(() => run("logs", "--no-color", "worker"), { timeout: 90_000, intervals: [1_000] })
    .toMatch(/\[worker\] heartbeat \d{4}-\d{2}-\d{2}T/);
  return run("logs", "--no-color", "worker");
}

test.describe("compose worker reads the repo-root .env (issue #64)", () => {
  test.skip(!!process.env.E2E_SKIP_DOCKER || compose.length === 0, "docker compose not available");
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    if (existsSync(rootEnv)) renameSync(rootEnv, backup);
    if (!postgresPort) postgresPort = await freePort();
  });

  test.afterEach(() => {
    if (compose.length) run("down", "-v", "--remove-orphans");
  });

  test.afterAll(() => {
    rmSync(rootEnv, { force: true });
    if (existsSync(backup)) renameSync(backup, rootEnv);
  });

  test("docker compose config: the worker gets the .env values, with DATABASE_URL on postgres:5432", () => {
    // The README's .env points DATABASE_URL at the host port (localhost:5433), for the web app.
    writeFileSync(rootEnv, validEnv());

    const environment = workerEnvironment();
    expect(environment.MISTRAL_API_KEY).toBe("e2e-worker-env-mistral-key");
    expect(environment.PERPLEXITY_API_KEY).toBe("e2e-worker-env-perplexity-key");
    expect(environment.AI_SCORING_PROVIDER).toBe("mistral");
    expect(environment.AI_WEB_SEARCH_PROVIDER).toBe("perplexity");
    expect(environment.APP_URL).toBe("http://localhost:3000");
    expect(environment.DATABASE_URL).toMatch(/^postgres:\/\/[^@]+@postgres:5432\/\w+$/);
  });

  test("with a valid .env, the worker starts with the AI layer: no missing environment variable", async () => {
    test.setTimeout(300_000);
    writeFileSync(rootEnv, validEnv());

    run("up", "-d", "--build", "--wait");
    const logs = await workerStarted();
    expect(logs).not.toContain("Missing environment variable");
    expect(logs).not.toContain("Job discovery is unavailable");
    expect(logs).toMatch(/\[worker\] running \d+ job\(s\)/);
    expect(run("ps", "--status", "running", "--services").split("\n")).toEqual(
      expect.arrayContaining(["postgres", "worker"]),
    );
  });

  test("without a .env, docker compose up still starts the stack; job discovery is skipped with the reason", async () => {
    test.setTimeout(300_000);
    rmSync(rootEnv, { force: true });

    const environment = workerEnvironment();
    expect(environment.DATABASE_URL).toMatch(/^postgres:\/\/[^@]+@postgres:5432\/\w+$/);
    expect(environment.MISTRAL_API_KEY).toBeUndefined();

    run("up", "-d", "--build", "--wait");
    const logs = await workerStarted();
    expect(logs).toMatch(/\[worker\] Job discovery is unavailable: Missing environment variable/);
    expect(run("ps", "--status", "running", "--services").split("\n")).toEqual(
      expect.arrayContaining(["postgres", "worker"]),
    );
  });

  test("the README's local setup says the worker reads .env", () => {
    const readme = readFileSync("README.md", "utf8");
    const start = readme.indexOf("## Getting started");
    expect(start, "README has a Getting started section").toBeGreaterThanOrEqual(0);
    const end = readme.indexOf("\n## ", start + 1);
    const setup = readme.slice(start, end === -1 ? undefined : end);
    expect(setup).toMatch(/`worker`[^\n]*reads[^\n]*`\.env`/);
    expect(setup).toContain("postgres:5432");
  });
});
