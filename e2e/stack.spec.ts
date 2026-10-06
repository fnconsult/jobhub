import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";
import { expect, test } from "@playwright/test";

// Brings up the local docker compose stack (Postgres + background-job runner)
// under its own project name and host port, so it never collides with a stack
// a developer already has running. Set E2E_SKIP_DOCKER=1 to skip.
// The host port defaults to a free one picked at run time.
const project = process.env.E2E_COMPOSE_PROJECT ?? `jobhub-e2e-${process.pid}`;
let postgresPort = Number(process.env.E2E_POSTGRES_PORT ?? 0);

function composeCommand(): string[] {
  if (spawnSync("docker", ["compose", "version"]).status === 0) return ["docker", "compose"];
  if (spawnSync("docker-compose", ["version"]).status === 0) return ["docker-compose"];
  return [];
}

const compose = composeCommand();
function run(...args: string[]): string {
  const [bin, ...base] = compose;
  const env = { ...process.env, POSTGRES_PORT: String(postgresPort) };
  return execFileSync(bin!, [...base, "-p", project, ...args], { env, encoding: "utf8", stdio: "pipe" });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

test.describe("local stack (docker compose)", () => {
  test.skip(!!process.env.E2E_SKIP_DOCKER || compose.length === 0, "docker compose not available");
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    if (!postgresPort) postgresPort = await freePort();
    run("up", "-d", "--build", "--wait");
  });

  test.afterAll(() => {
    if (compose.length) run("down", "-v");
  });

  test("Postgres accepts connections on the host port", async () => {
    expect(await canConnect(postgresPort)).toBe(true);
    const out = run("exec", "-T", "postgres", "psql", "-U", "jobhub", "-d", "jobhub", "-tAc", "select 'pret'");
    expect(out.trim()).toBe("pret");
  });

  test("the background-job runner starts and processes its heartbeat job", async () => {
    await expect
      .poll(() => run("logs", "worker"), { timeout: 60_000, intervals: [1_000] })
      .toMatch(/\[worker\] heartbeat \d{4}-\d{2}-\d{2}T/);
    expect(run("logs", "worker")).toMatch(/\[worker\] running \d+ job\(s\)/);
    expect(run("ps", "--status", "running", "--services").split("\n")).toEqual(
      expect.arrayContaining(["postgres", "worker"]),
    );
  });
});
