import { APP_ORIGIN, APP_SIGN_IN_PATH } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../migrations";
import { pendingSessionGate } from "../two-step-verification/gate";
import { createTwoStepVerification } from "../two-step-verification/index";
import { createPendingSessions } from "../two-step-verification/pending-sessions";
import { totpAt } from "../two-step-verification/totp";
import { BASE_URL, codeIn, connectionString, cookiesFrom, linkIn, signInWithMagicLink, startTestAuth, type TestAuth } from "./test-support";

/** What the native app's requests carry instead of an Origin (@better-auth/expo's client, ADR-0076). */
const FROM_APP = { "expo-origin": APP_ORIGIN };
/** The return address the app asks its magic link for (the Expo client makes `/connexion/app` an address in its scheme). */
const APP_RETURN = `${APP_ORIGIN}${APP_SIGN_IN_PATH}`;

describe.skipIf(!connectionString)("the native app's session (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  beforeEach(async () => {
    testAuth = await startTestAuth();
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  /** The app asks a magic link for `email`, as its sign-in screen does, and returns the link emailed. */
  async function appAsksLink(email: string): Promise<URL> {
    const before = testAuth.mailbox.length;
    const sent = await testAuth.request("/api/auth/sign-in/magic-link", { body: { email, callbackURL: APP_RETURN }, headers: FROM_APP });
    if (!sent.ok) throw new Error(`magic link request failed: ${sent.status} ${await sent.text()}`);
    return new URL(linkIn(testAuth.mailbox[before]));
  }

  /** The app, opened by that link, follows it itself and keeps the session cookie the answer sets. */
  async function appSignsIn(email: string): Promise<string> {
    const link = await appAsksLink(email);
    const verified = await testAuth.request(`/api/auth/magic-link/verify?token=${link.searchParams.get("token")}`, { headers: FROM_APP });
    expect(verified.status).toBe(200);
    return cookiesFrom(verified);
  }

  const sessionOf = (cookie: string) => testAuth.auth.api.getSession({ headers: new Headers({ cookie }) });

  it("emails the app a link to the web address the app claims, the token alone in it", async () => {
    const link = await appAsksLink("marie.dupont@example.fr");

    expect(`${link.origin}${link.pathname}`).toBe(`${BASE_URL}${APP_SIGN_IN_PATH}`);
    expect([...link.searchParams.keys()]).toEqual(["token"]);
  });

  it("still emails the web its own link", async () => {
    await testAuth.request("/api/auth/sign-in/magic-link", { body: { email: "marie.dupont@example.fr", callbackURL: "/" } });

    expect(linkIn(testAuth.mailbox[0])).toContain("/api/auth/magic-link/verify?token=");
  });

  it("signs the app in by magic link, the session's sign-in method saying so", async () => {
    const cookie = await appSignsIn("marie.dupont@example.fr");

    const current = await sessionOf(cookie);
    expect(current?.user.email).toBe("marie.dupont@example.fr");
    expect(current?.session.signInMethod).toBe("magic-link");
  });

  it("signs the app in by the email's code, typed in the app (#686)", async () => {
    await appAsksLink("marie.dupont@example.fr");

    const signedIn = await testAuth.request("/api/auth/sign-in/email-otp", { body: { email: "marie.dupont@example.fr", otp: codeIn(testAuth.mailbox[0]) }, headers: FROM_APP });

    expect(signedIn.status).toBe(200);
    const current = await sessionOf(cookiesFrom(signedIn));
    expect(current?.user.email).toBe("marie.dupont@example.fr");
    expect(current?.session.signInMethod).toBe("magic-link");
  });

  it("accepts the app's session on a protected route, a change it asks for included", async () => {
    const cookie = await appSignsIn("marie.dupont@example.fr");

    const updated = await testAuth.request("/api/auth/update-user", { cookie, headers: FROM_APP, body: { interfaceLanguage: "en" } });

    expect(updated.status).toBe(200);
    expect((await sessionOf(cookie))?.user.interfaceLanguage).toBe("en");
  });

  it("refuses the app's session once revoked from the web", async () => {
    const app = await appSignsIn("marie.dupont@example.fr");
    const web = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const appToken = (await sessionOf(app))?.session.token;

    const revoked = await testAuth.request("/api/auth/revoke-session", { cookie: web, body: { token: appToken } });

    expect(revoked.status).toBe(200);
    expect(await sessionOf(app)).toBeNull();
    const refused = await testAuth.request("/api/auth/update-user", { cookie: app, headers: FROM_APP, body: { interfaceLanguage: "en" } });
    expect(refused.status).toBe(401);
    expect(await sessionOf(web)).not.toBeNull();
  });

  it("answers the app a link already used, or never valid, by a redirect carrying INVALID_TOKEN, no session in it", async () => {
    const link = await appAsksLink("marie.dupont@example.fr");
    const verify = `/api/auth/magic-link/verify?token=${link.searchParams.get("token")}`;
    await testAuth.request(verify, { headers: FROM_APP });

    for (const path of [verify, "/api/auth/magic-link/verify?token=never-valid"]) {
      const refused = await testAuth.request(path, { headers: FROM_APP });

      // What the app's fetch follows (app-session.ts tells a link no longer valid by the session missing from the answer).
      expect(refused.status).toBe(302);
      expect(new URL(refused.headers.get("location")!).searchParams.get("error")).toBe("INVALID_TOKEN");
      expect(refused.headers.getSetCookie()).toEqual([]);
    }
  });

  it("revokes the session when the app signs out", async () => {
    const cookie = await appSignsIn("marie.dupont@example.fr");

    const signedOut = await testAuth.request("/api/auth/sign-out", { cookie, headers: FROM_APP, body: {} });

    expect(signedOut.status).toBe(200);
    expect(await sessionOf(cookie)).toBeNull();
  });

  it("trusts no other scheme as a return address", async () => {
    const refused = await testAuth.request("/api/auth/sign-in/magic-link", {
      body: { email: "marie.dupont@example.fr", callbackURL: "otherapp:///connexion/app" },
      headers: { "expo-origin": "otherapp://" },
    });

    expect(refused.status).toBe(403);
    expect(testAuth.mailbox).toHaveLength(0);
  });

  it("refuses a change asked with the session from another scheme", async () => {
    const cookie = await appSignsIn("marie.dupont@example.fr");

    const refused = await testAuth.request("/api/auth/update-user", { cookie, headers: { "expo-origin": "otherapp://" }, body: { interfaceLanguage: "en" } });

    expect(refused.status).toBe(403);
  });

  it("keeps the app's session pending its second step for an account that has Two-step verification", async () => {
    const database = testAuth.auth.options.database as Pool;
    await migrateDatabase(testAuth.config);
    const twoStep = createTwoStepVerification(database, { secret: testAuth.config.secret });
    const web = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const { user, session } = (await sessionOf(web))!;
    const { secret } = await twoStep.startSetup(user.id, "marie.dupont@example.fr");
    await twoStep.confirmSetup({ candidateId: user.id, sessionId: session.id }, totpAt(secret, new Date()));

    const app = await appSignsIn("marie.dupont@example.fr");

    // The proxy answers it 401 `second_step_required` on every route but the second step's (proxy-gate.ts).
    expect(await createPendingSessions(database).of(new Headers({ cookie: app }))).toMatchObject({ candidateId: user.id, step: "second_step" });
    expect(pendingSessionGate("/api/auth/get-session", "GET")).toBe("refuse");
  }, 60_000);

  it("keeps a pending app session from every data route, until a valid code from the app releases it (#688)", async () => {
    const database = testAuth.auth.options.database as Pool;
    await migrateDatabase(testAuth.config);
    let at = new Date();
    const twoStep = createTwoStepVerification(database, { secret: testAuth.config.secret, now: () => at });
    const web = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const { user, session } = (await sessionOf(web))!;
    const { secret } = await twoStep.startSetup(user.id, "marie.dupont@example.fr");
    await twoStep.confirmSetup({ candidateId: user.id, sessionId: session.id }, totpAt(secret, at));
    const app = await appSignsIn("marie.dupont@example.fr");
    const pendingSessions = createPendingSessions(database);
    const pending = (await pendingSessions.of(new Headers({ cookie: app, ...FROM_APP })))!;

    expect(pending).toMatchObject({ candidateId: user.id, step: "second_step" });
    for (const route of ["/api/applications", "/api/job-searches", "/api/agenda", "/api/coach", "/api/auth/get-session", "/api/account/two-step-verification"]) {
      for (const method of ["GET", "POST"]) expect(pendingSessionGate(route, method), `${method} ${route}`).toBe("refuse");
    }
    expect(pendingSessionGate("/api/two-step-verification/second-step", "POST")).toBe("open");
    expect(await twoStep.verify(pending, "000000")).toEqual({ ok: false, error: "invalid_code" });
    expect(await pendingSessions.of(new Headers({ cookie: app }))).not.toBeNull();

    at = new Date(at.getTime() + 30_000);
    expect(await twoStep.verify(pending, totpAt(secret, at))).toEqual({ ok: true, factor: "authenticator_app" });

    expect(await pendingSessions.of(new Headers({ cookie: app }))).toBeNull();
    expect((await sessionOf(app))?.user.email).toBe("marie.dupont@example.fr");
    expect(await sessionOf(web)).not.toBeNull();
  }, 60_000);
});
