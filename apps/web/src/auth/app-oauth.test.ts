import { APP_ORIGIN, APP_PROVIDER_RETURN_PATH } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../migrations";
import { createPendingSessions } from "../two-step-verification/pending-sessions";
import { BASE_URL, connectionString, cookiesFrom, signInWithMagicLink, startTestAuth, testProvider, testSignIn, type TestAuth } from "./test-support";
import type { SignInProvider } from "../sign-in-providers/catalog";

/**
 * The Sign-in Providers in the native app (#687, ADR-0076): the web OAuth flow, opened in the system's authentication
 * browser (ASWebAuthenticationSession, Custom Tabs), back in the app by its scheme. The app asks the sign-in as its other
 * requests (no Origin, an `expo-origin`), the browser opens Better Auth's Expo proxy, which keeps the flow's state cookie
 * in that browser, and the callback's answer carries the session cookie to the app's return address.
 */

/** What the native app's requests carry instead of an Origin (@better-auth/expo's client). */
const FROM_APP = { "expo-origin": APP_ORIGIN };
/** Where the app asks a Sign-in Provider to come back, signed in or refused. */
const APP_RETURN = `${APP_ORIGIN}${APP_PROVIDER_RETURN_PATH}`;
/** A top-level navigation in the system's browser: no Origin, no `expo-origin`. */
const IN_BROWSER = {};

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

const google = testProvider({ id: "google", type: "google", displayName: "Google", clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-google-secret" });
/** Apple's web flow: its Services ID as client id, its client secret the JWT the worker signs (here any string). */
const apple = testProvider({ id: "apple", type: "apple", displayName: "Apple", clientId: "ai.jobbbox.signin", clientSecret: "signed-apple-client-secret" });

/** Who each provider says is signing in. */
const person: Record<string, Record<string, unknown>> = {};

/** An ID token as a provider's token endpoint returns it (its signature is not checked on that channel). */
const idToken = (issuer: string, audience: string, claims: Record<string, unknown>) =>
  `${encode({ alg: "RS256", typ: "JWT", kid: "key" })}.${encode({ iss: issuer, aud: audience, iat: now(), exp: now() + 3600, ...claims })}.signature`;

/** Stands in for Google's and Apple's token endpoints. */
function providersAnswer() {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "google-access-token", token_type: "Bearer", expires_in: 3600, id_token: idToken("https://accounts.google.com", google.clientId, person.google ?? {}) });
    }
    if (url.startsWith("https://appleid.apple.com/auth/token")) {
      return Response.json({ access_token: "apple-access-token", token_type: "Bearer", expires_in: 3600, id_token: idToken("https://appleid.apple.com", apple.clientId, person.apple ?? {}) });
    }
    return realFetch(input, init);
  });
}

describe.skipIf(!connectionString)("the Sign-in Providers in the native app (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  async function start(providers: SignInProvider[] = [google, apple]) {
    providersAnswer();
    testAuth = await startTestAuth({ signIn: testSignIn(providers) });
  }
  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(person)) delete person[key];
    await testAuth.stop();
  });

  const locationOf = (response: Response) => new URL(response.headers.get("location")!, BASE_URL);
  const sessionOf = (cookie: string) => testAuth.auth.api.getSession({ headers: new Headers({ cookie }) });

  /**
   * The app asks to sign in through `provider`, as « Continuer avec … » does there, without being redirected: it opens
   * the authorization itself, through the Expo proxy, in the system's browser. Returns the provider's page (its
   * authorization URL) and the browser's cookies once the proxy has answered.
   */
  async function appStarts(provider: string): Promise<{ authorize: URL; browser: string }> {
    const started = await testAuth.request("/api/auth/sign-in/social", {
      body: { provider, callbackURL: APP_RETURN, errorCallbackURL: APP_RETURN, disableRedirect: true },
      headers: FROM_APP,
    });
    expect(started.status).toBe(200);
    const { url, redirect } = (await started.json()) as { url: string; redirect: boolean };
    expect(redirect).toBe(false);
    const proxied = await testAuth.request(`/api/auth/expo-authorization-proxy?authorizationURL=${encodeURIComponent(url)}`, { headers: IN_BROWSER });
    expect(proxied.status).toBe(302);
    expect(proxied.headers.get("location")).toBe(url);
    return { authorize: new URL(url), browser: cookiesFrom(proxied) };
  }

  /** The provider approves and sends the browser back to the callback (a GET), which answers it. */
  async function providerApproves(provider: string, { authorize, browser }: { authorize: URL; browser: string }): Promise<Response> {
    return testAuth.request(`/api/auth/callback/${provider}?code=provider-code&state=${authorize.searchParams.get("state")}`, { cookie: browser, headers: IN_BROWSER });
  }

  /** The session cookie the app's return address carries (`cookie`, the Set-Cookie header the Expo plugin copies there). */
  const sessionCookieIn = (back: URL) =>
    (back.searchParams.get("cookie") ?? "")
      .split(/,(?=\s*[^;,=\s]+=)/)
      .map((cookie) => cookie.split(";")[0]!.trim())
      .filter((cookie) => cookie.includes("session_token"))
      .join("; ");

  it("signs the app in through Google in the system's browser, back by the app's scheme with the session", async () => {
    await start();
    person.google = { sub: "google-marie", email: "marie.dupont@gmail.com", email_verified: true, name: "Marie Dupont" };

    const callback = await providerApproves("google", await appStarts("google"));

    const back = locationOf(callback);
    expect(`${back.protocol}//${back.host}${back.pathname}`).toBe(APP_RETURN);
    expect(back.searchParams.get("error")).toBeNull();
    const current = await sessionOf(sessionCookieIn(back));
    expect(current?.user.email).toBe("marie.dupont@gmail.com");
    expect(current?.session.signInMethod).toBe("google");
  });

  it("signs the app in through Apple, whose answer is posted to the callback (form_post)", async () => {
    await start();
    person.apple = { sub: "apple-001234.abcd", email: "x7k2p9@privaterelay.appleid.com", email_verified: "true" };
    const started = await appStarts("apple");
    expect(started.authorize.origin).toBe("https://appleid.apple.com");
    expect(started.authorize.searchParams.get("response_mode")).toBe("form_post");

    // Apple posts the form from its own origin: the browser sends no cookie of ours with that cross-site POST…
    const posted = await testAuth.auth.handler(
      new Request(new URL("/api/auth/callback/apple", BASE_URL), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com" },
        body: new URLSearchParams({ code: "apple-code", state: started.authorize.searchParams.get("state")! }).toString(),
      }),
    );
    expect(posted.status).toBe(302);
    // …and the callback sends it on to itself as a GET, a top-level navigation that carries the state cookie.
    const relayed = locationOf(posted);
    const callback = await testAuth.request(`${relayed.pathname}${relayed.search}`, { cookie: started.browser, headers: IN_BROWSER });

    const back = locationOf(callback);
    expect(`${back.protocol}//${back.host}${back.pathname}`).toBe(APP_RETURN);
    const current = await sessionOf(sessionCookieIn(back));
    expect(current?.user.email).toBe("x7k2p9@privaterelay.appleid.com");
    expect(current?.session.signInMethod).toBe("apple");
  });

  it("counts a Sign-in Provider's sign-in in the app as both steps (ADR-0075), where a magic link has a step left", async () => {
    await start([google]);
    person.google = { sub: "google-claire", email: "claire@jobbbox.fr", email_verified: true, name: "Claire" };
    const database = testAuth.auth.options.database as Pool;
    await migrateDatabase(testAuth.config);
    // An account that must have Two-step verification (an ADMIN_EMAILS address, #665), as the proxy reads it.
    const pending = createPendingSessions(database, { adminEmails: ["claire@jobbbox.fr"] });

    const back = locationOf(await providerApproves("google", await appStarts("google")));

    expect(await pending.of(new Headers({ cookie: sessionCookieIn(back) }))).toBeNull();
    const magic = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    expect(await pending.of(new Headers({ cookie: magic }))).toMatchObject({ step: "setup" });
  });

  it("sends the app a provider not enabled back as provider_disabled, signed in to nothing", async () => {
    await start([google, { ...apple, enabled: false, testPending: true }]);
    person.apple = { sub: "apple-001234.abcd", email: "marie.dupont@icloud.com", email_verified: "true" };

    const callback = await providerApproves("apple", await appStarts("apple"));

    const back = locationOf(callback);
    expect(`${back.protocol}//${back.host}${back.pathname}`).toBe(APP_RETURN);
    expect(back.searchParams.get("error")).toBe("provider_disabled");
    expect(sessionCookieIn(back)).toBe("");
  });

  it("sends the app an account to link by magic link back as account_not_linked, the account untouched", async () => {
    const untrusted = { ...apple, trustedForLinking: false };
    await start([google, untrusted]);
    await signInWithMagicLink(testAuth, "marie.dupont@icloud.com");
    person.apple = { sub: "apple-001234.abcd", email: "marie.dupont@icloud.com", email_verified: "true" };

    const callback = await providerApproves("apple", await appStarts("apple"));

    const back = locationOf(callback);
    expect(back.searchParams.get("error")).toBe("account_not_linked");
    expect(sessionCookieIn(back)).toBe("");
    expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" = 'apple'")).rows[0].count).toBe("0");
  });

  it("sends the app a refusal at the provider back to its scheme, with the provider's error", async () => {
    await start();
    const { authorize, browser } = await appStarts("google");

    const callback = await testAuth.request(`/api/auth/callback/google?error=access_denied&state=${authorize.searchParams.get("state")}`, { cookie: browser, headers: IN_BROWSER });

    const back = locationOf(callback);
    expect(`${back.protocol}//${back.host}${back.pathname}`).toBe(APP_RETURN);
    expect(back.searchParams.get("error")).toBe("access_denied");
  });

  it("refuses the app a sign-in or a link with an ID token, as a native SDK would send it (ADR-0011)", async () => {
    await start();
    const token = idToken("https://accounts.google.com", google.clientId, { sub: "google-marie", email: "marie.dupont@gmail.com", email_verified: true });
    const magic = await signInWithMagicLink(testAuth, "marie.dupont@gmail.com");

    const signIn = await testAuth.request("/api/auth/sign-in/social", { body: { provider: "google", idToken: { token } }, headers: FROM_APP });
    const link = await testAuth.request("/api/auth/link-social", { cookie: magic, body: { provider: "apple", idToken: { token } }, headers: FROM_APP });

    for (const refused of [signIn, link]) {
      expect(refused.status).toBe(400);
      expect((await refused.json()).code).toBe("ID_TOKEN_SIGN_IN_NOT_SUPPORTED");
      expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
    }
    expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" IN ('google', 'apple')")).rows[0].count).toBe("0");
  });

  it("trusts no other scheme as the provider's return address", async () => {
    await start();

    const refused = await testAuth.request("/api/auth/sign-in/social", {
      body: { provider: "google", callbackURL: "otherapp:///connexion/fournisseur", disableRedirect: true },
      headers: { "expo-origin": "otherapp://" },
    });

    expect(refused.status).toBe(403);
  });
});
