import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { fromNewAddress } from "./candidate";
import { startOwnServer, type OwnServer } from "./own-server";

export { signInByEmail } from "./own-server";

// Issue #209: the Sign-in Providers are one configuration for the whole app. Its specs
// add providers and turn Require SSO for Administrators on, which would change the sign-in
// page and the Back Office of every other spec running at the same time; so they run on a
// server of their own, with a database of their own, migrated like the suite's (own-server.ts).

export const FAKE_OIDC_ISSUER = "https://sso.e2e.jobbbox.test";
export const SSO_SUPER_ADMIN = "sso-office@e2e.jobbbox.test";

export type SignInServer = OwnServer;

/** The built web app on E2E_WEB_PORT + `offset`, on a fresh database, with env's Google client and the fake OIDC issuer. */
export function startSignInServer(offset: number): Promise<SignInServer> {
  return startOwnServer(offset, "sign_in", {
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
  });
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

/** Plays the OIDC issuer's authorize page for `page`: the person, or the issuer, refuses the sign-in with OAuth `error`. */
export async function refuseAtIssuer(page: Page, error: string): Promise<void> {
  await fromNewAddress(page);
  await page.unroute(`${FAKE_OIDC_ISSUER}/**`);
  await page.route(`${FAKE_OIDC_ISSUER}/**`, async (route) => {
    const authorize = new URL(route.request().url());
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.searchParams.set("error", error);
    callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
}
