import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { fromNewAddress } from "./candidate";
import { emailsIn, linkIn } from "./mailbox";
import { derivedPort } from "./ports";

// Issue #209: the Sign-in Providers are one configuration for the whole app. Its specs
// add providers and turn Require SSO for Administrators on, which would change the sign-in
// page and the Back Office of every other spec running at the same time; so they run on a
// server of their own, with a database of their own, migrated like the suite's.

export const FAKE_OIDC_ISSUER = "https://sso.e2e.jobbbox.test";
export const SSO_SUPER_ADMIN = "sso-office@e2e.jobbbox.test";

export type SignInServer = { origin: string; output: () => string; stop: () => Promise<void> };

const adminClient = async (databaseUrl: URL) => {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
};

/** The built web app on E2E_WEB_PORT + `offset`, on a fresh database, with env's Google client and the fake OIDC issuer. */
export async function startSignInServer(offset: number): Promise<SignInServer> {
  const port = derivedPort(offset);
  const origin = `http://localhost:${port}`;
  const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
  const name = `${databaseUrl.pathname.slice(1)}_sign_in`;
  databaseUrl.pathname = `/${name}`;
  const admin = await adminClient(databaseUrl);
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl.toString(),
    APP_URL: origin,
    AUTH_SECRET: "e2e-sign-in-secret-e2e-sign-in-secret-e2e",
    MAIL_TRANSPORT: "console",
    GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "e2e-client-secret",
    ADMIN_EMAILS: SSO_SUPER_ADMIN,
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    // A production build requires Stripe (billing/config.ts): without it, every page that
    // reads a Plan Quota (Mon compte among them) fails. Set here, like the suite's server,
    // on the suite's fake Stripe, never from the shell: CI has no .env (#214 went red there).
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    NODE_OPTIONS: [`--import=${path.resolve("e2e/support/fake-google.mjs")}`, `--import=${path.resolve("e2e/support/fake-oidc.mjs")}`].join(" "),
  };
  const migrate = spawnSync("npm", ["run", "db:migrate"], { env: { ...env, NODE_OPTIONS: "" }, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`migration failed:\n${migrate.stdout}\n${migrate.stderr}`);

  let output = "";
  const child: ChildProcess = spawn("npx", ["next", "start", "apps/web", "-p", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
  return { origin, output: () => output, stop };
}

/** Signs `email` in by magic link on `server` (its emails are in its own output). Leaves `page` on /compte. */
export async function signInByEmail(page: Page, server: SignInServer, email: string): Promise<void> {
  const already = emailsIn(server.output(), email).length;
  await fromNewAddress(page);
  await page.goto(`${server.origin}/connexion`);
  await page.getByLabel(/Votre adresse e-mail|Your email address/).fill(email);
  await page.getByRole("button", { name: /Recevoir mon lien|Send me a sign-in link/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect.poll(() => emailsIn(server.output(), email).length, { message: `sign-in email to ${email}` }).toBeGreaterThan(already);
  await page.goto(linkIn(emailsIn(server.output(), email)[already]!));
  await expect(page).toHaveURL(`${server.origin}/compte`);
}

/**
 * Plays the OIDC issuer's authorize page for `page`: the person approves as `identity`.
 * Checks the app asked for client `clientId`, and calls `onCallback` with the redirect URI it gave.
 */
export async function approveAtIssuer(page: Page, identity: Record<string, unknown>, clientId: string, onCallback: (redirectUri: string) => void = () => {}): Promise<void> {
  await fromNewAddress(page);
  await page.unroute(`${FAKE_OIDC_ISSUER}/**`);
  await page.route(`${FAKE_OIDC_ISSUER}/**`, async (route) => {
    const authorize = new URL(route.request().url());
    expect(authorize.pathname).toBe("/authorize");
    expect(authorize.searchParams.get("client_id")).toBe(clientId);
    const redirectUri = authorize.searchParams.get("redirect_uri")!;
    onCallback(redirectUri);
    const code = Buffer.from(JSON.stringify({ ...identity, aud: clientId, nonce: authorize.searchParams.get("nonce") ?? undefined })).toString("base64url");
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
}
