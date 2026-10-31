import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { fromNewAddress, requestSignInLink } from "./candidate";
import { emailsIn, linkIn } from "./mailbox";
import { derivedPort } from "./ports";

// A web app of a spec's own (#209, #601): a setting that is one for the whole app (the Sign-in Providers, a Platform
// Setting that changes every Candidate's pages) would change the pages of every other spec running at the same time, so
// those specs switch it on a server of their own, with a database of their own, migrated like the suite's.

export type OwnServer = { origin: string; databaseUrl: string; output: () => string; stop: () => Promise<void> };

const adminClient = async (databaseUrl: URL) => {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
};

/**
 * The built web app on E2E_WEB_PORT + `offset`, on a fresh database named after the suite's with `suffix`, with `env`
 * over the suite's environment (DATABASE_URL and APP_URL are set here). Its emails are in its own output.
 */
export async function startOwnServer(offset: number, suffix: string, env: NodeJS.ProcessEnv): Promise<OwnServer> {
  const port = derivedPort(offset);
  const origin = `http://localhost:${port}`;
  const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
  const name = `${databaseUrl.pathname.slice(1)}_${suffix}`;
  databaseUrl.pathname = `/${name}`;
  const admin = await adminClient(databaseUrl);
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const serverEnv: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env, DATABASE_URL: databaseUrl.toString(), APP_URL: origin };
  const migrate = spawnSync("npm", ["run", "db:migrate"], { env: { ...serverEnv, NODE_OPTIONS: "" }, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`migration failed:\n${migrate.stdout}\n${migrate.stderr}`);

  let output = "";
  const child: ChildProcess = spawn("npx", ["next", "start", "apps/web", "-p", String(port)], { env: serverEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const stop = async () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const cleanup = await adminClient(databaseUrl);
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await cleanup.end();
  };
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
          return fetch(`${origin}/api/health`).then((r) => r.status, () => 0);
        },
        { timeout: 90_000, message: "web app answers /api/health" },
      )
      .toBe(200);
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, databaseUrl: databaseUrl.toString(), output: () => output, stop };
}

/** Signs `email` in by magic link on `server` (its emails are in its own output). Leaves `page` on /compte. */
export async function signInByEmail(page: Page, server: Pick<OwnServer, "origin" | "output">, email: string): Promise<void> {
  const already = emailsIn(server.output(), email).length;
  await fromNewAddress(page);
  await page.goto(`${server.origin}/connexion`);
  await requestSignInLink(page, email);
  await expect.poll(() => emailsIn(server.output(), email).length, { message: `sign-in email to ${email}` }).toBeGreaterThan(already);
  await page.goto(linkIn(emailsIn(server.output(), email)[already]!));
  await expect(page).toHaveURL(`${server.origin}/compte`);
}
