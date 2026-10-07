import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";

// Issue #33: the README has developers `cp .env.example .env` at the repo root,
// then run `npm run db:migrate` and `npm run dev`. The web app (`next dev`,
// `next start`) must read that root `.env`; values already in the environment
// still win, and a missing root `.env` (CI, containers) is fine.
//
// Each test writes its own repo-root `.env`, starts the web app through its
// public commands with an environment stripped of every app setting, and asks
// for a sign-in link over HTTP: that only works when the server got
// DATABASE_URL (and, for `next start`, MAIL_TRANSPORT) from the root `.env`.
// A developer's own `.env` is moved aside for the duration and put back.

const basePort = Number(process.env.E2E_WEB_PORT ?? 3001);
const rootEnv = ".env";
const backup = `.env.e2e-backup-${process.pid}`;

const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
databaseUrl.pathname = `${databaseUrl.pathname}_rootenv`;
const dbName = databaseUrl.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

async function admin(sql: string) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** The environment of a fresh shell: none of the app's settings (every key of .env.example). */
function shellEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const line of readFileSync(".env.example", "utf8").split("\n")) {
    const key = line.replace(/^#\s*/, "").match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
    if (key) delete env[key];
  }
  for (const key of ["NODE_OPTIONS", "NODE_ENV", "E2E_DATABASE_URL"]) delete env[key];
  return { ...env, ...extra };
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

type Server = { process: ChildProcess; output: () => string; origin: string };
const servers: Server[] = [];

async function startWebApp(command: string[], port: number, env: NodeJS.ProcessEnv): Promise<Server> {
  const taken = await fetch(`http://localhost:${port}/api/health`).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error(`port ${port} is already in use: set E2E_WEB_PORT to move the suite's ports`);
  let output = "";
  const child = spawn(command[0]!, [...command.slice(1)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const server = { process: child, output: () => output, origin: `http://localhost:${port}` };
  servers.push(server);
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
        try {
          return (await fetch(`${server.origin}/api/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, message: "web app answers /api/health" },
    )
    .toBe(200);
  return server;
}

function stop(server: Server) {
  try {
    process.kill(-server.process.pid!, "SIGTERM");
  } catch {
    // already gone
  }
}

/** Asks the web app for a sign-in link, the request the /connexion page makes. */
function requestSignInLink(request: APIRequestContext, server: Server, email: string) {
  return request.post(`${server.origin}/api/auth/sign-in/magic-link`, {
    data: { email, callbackURL: "/compte" },
    headers: { origin: server.origin, "x-forwarded-for": `10.33.${Math.floor(Math.random() * 250)}.1` },
  });
}

/** The sign-in link the server printed (MAIL_TRANSPORT=console) for `email`. */
async function signInLinkFor(server: Server, email: string): Promise<string> {
  const pattern = new RegExp(`\\[mail\\] to ${email.replace(/[.+]/g, "\\$&")}: [^\\n]*\\n[\\s\\S]*?(https?://\\S+)`);
  await expect
    .poll(() => pattern.test(server.output()), { message: `sign-in email to ${email} in:\n${server.output()}` })
    .toBe(true);
  return server.output().match(pattern)![1]!;
}

const newEmail = (label: string) => `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.fr`;

test.describe("repo-root .env (issue #33)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async () => {
    if (existsSync(rootEnv)) renameSync(rootEnv, backup);
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${dbName}`);
  });

  test.afterEach(() => {
    for (const server of servers.splice(0)) stop(server);
  });

  test.afterAll(async () => {
    for (const server of servers.splice(0)) stop(server);
    rmSync(rootEnv, { force: true });
    if (existsSync(backup)) renameSync(backup, rootEnv);
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  });

  test("README getting started: cp .env.example .env, npm run db:migrate, npm run dev, then a sign-in link works", async ({ request }) => {
    const readme = readFileSync("README.md", "utf8");
    const steps = ["cp .env.example .env", "npm run db:migrate", "npm run dev"];
    let at = -1;
    for (const step of steps) {
      const next = readme.indexOf(step, at + 1);
      expect(next, `README step "${step}" in order`).toBeGreaterThan(at);
      at = next;
    }

    const port = basePort + 400;
    const origin = `http://localhost:${port}`;
    // The only edits a developer makes: their database and their port.
    writeFileSync(rootEnv, exampleWith({ DATABASE_URL: databaseUrl.toString(), APP_URL: origin }));

    const migrate = spawnSync("npm", ["run", "db:migrate"], { env: shellEnv(), encoding: "utf8" });
    expect(migrate.status, migrate.stderr).toBe(0);
    expect(migrate.stdout).toContain("Candidate accounts are up to date");

    const server = await startWebApp(["npm", "run", "dev"], port, shellEnv({ PORT: String(port) }));
    const email = newEmail("readme");
    const response = await requestSignInLink(request, server, email);
    expect(response.status(), `${await response.text()}\n${server.output()}`).toBe(200);
    expect((await signInLinkFor(server, email)).startsWith(`${origin}/`)).toBe(true);
    expect(server.output()).not.toContain("Missing environment variable");
  });

  test("next start (production build) reads settings defined only in the root .env", async ({ request }) => {
    const port = basePort + 500;
    const origin = `http://localhost:${port}`;
    writeFileSync(
      rootEnv,
      [
        `DATABASE_URL=${databaseUrl}`,
        `APP_URL=${origin}`,
        "AUTH_SECRET=root-env-e2e-secret-root-env-e2e-secret",
        "MAIL_TRANSPORT=console",
        "",
      ].join("\n"),
    );

    const server = await startWebApp(["npx", "next", "start", "apps/web", "-p", String(port)], port, shellEnv());
    const email = newEmail("start");
    const response = await requestSignInLink(request, server, email);
    expect(response.status(), `${await response.text()}\n${server.output()}`).toBe(200);
    expect((await signInLinkFor(server, email)).startsWith(`${origin}/`)).toBe(true);
  });

  test("values already in the environment win over the root .env", async ({ request }) => {
    const port = basePort + 550;
    const shellOrigin = `http://127.0.0.1:${port}`;
    writeFileSync(
      rootEnv,
      [
        `DATABASE_URL=${databaseUrl}`,
        `APP_URL=http://root-env.invalid:${port}`,
        "AUTH_SECRET=root-env-e2e-secret-root-env-e2e-secret",
        "MAIL_TRANSPORT=smtp-not-console",
        "",
      ].join("\n"),
    );

    const server = await startWebApp(
      ["npx", "next", "start", "apps/web", "-p", String(port)],
      port,
      shellEnv({ APP_URL: shellOrigin, MAIL_TRANSPORT: "console" }),
    );
    const email = newEmail("precedence");
    const response = await requestSignInLink(request, { ...server, origin: shellOrigin }, email);
    expect(response.status(), `${await response.text()}\n${server.output()}`).toBe(200);
    expect((await signInLinkFor(server, email)).startsWith(`${shellOrigin}/`)).toBe(true);
  });

  test("starts without a root .env (CI, containers), with settings from the environment only", async ({ request }) => {
    rmSync(rootEnv, { force: true });
    const port = basePort + 600;

    // Nothing configured at all: the app still starts; sign-ins report the missing settings.
    const bare = await startWebApp(["npx", "next", "start", "apps/web", "-p", String(port)], port, shellEnv());
    const refused = await requestSignInLink(request, bare, newEmail("bare"));
    expect(refused.status()).toBe(500);
    await expect.poll(() => bare.output()).toContain("Missing environment variable");

    // Configured by the environment, as in CI or a container.
    const configuredPort = basePort + 650;
    const configuredOrigin = `http://localhost:${configuredPort}`;
    const server = await startWebApp(
      ["npx", "next", "start", "apps/web", "-p", String(configuredPort)],
      configuredPort,
      shellEnv({
        DATABASE_URL: databaseUrl.toString(),
        APP_URL: configuredOrigin,
        AUTH_SECRET: "root-env-e2e-secret-root-env-e2e-secret",
        MAIL_TRANSPORT: "console",
      }),
    );
    const email = newEmail("container");
    const response = await requestSignInLink(request, server, email);
    expect(response.status(), `${await response.text()}\n${server.output()}`).toBe(200);
    expect((await signInLinkFor(server, email)).startsWith(`${configuredOrigin}/`)).toBe(true);
  });
});
