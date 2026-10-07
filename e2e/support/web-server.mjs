// Starts the built web app for the e2e suite (playwright.config.ts `webServer`).
// 1. Creates a throwaway Postgres database (E2E_DATABASE_URL) and builds its
//    tables with the public migration CLI, `npm run db:migrate`.
// 2. Starts a fake Stripe API on E2E_STRIPE_PORT (the app reaches it through
//    STRIPE_API_URL, set in playwright.config.ts).
// 3. Runs `next start`, copying its output to E2E_SERVER_LOG: with
//    MAIL_TRANSPORT=console, that log is the Candidates' mailbox.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { startFakeStripe } from "../../apps/web/src/billing/fake-stripe.ts";

const databaseUrl = new URL(process.env.E2E_DATABASE_URL);
const name = databaseUrl.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${name}`);
await admin.end();

const env = { ...process.env, DATABASE_URL: databaseUrl.toString() };
const migrate = spawnSync("npm", ["run", "db:migrate"], { env, stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const stripe = await startFakeStripe(Number(process.env.E2E_STRIPE_PORT));

const logFile = process.env.E2E_SERVER_LOG;
mkdirSync(path.dirname(logFile), { recursive: true });
const log = createWriteStream(logFile, { flags: "w" });
const server = spawn("npx", ["next", "start", "apps/web", "-p", process.env.E2E_WEB_PORT], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", async (code) => {
  await stripe.stop();
  process.exit(code ?? 0);
});
