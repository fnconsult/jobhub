import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./index";
import { BASE_URL, connectionString, cookiesFrom, signInWithMagicLink, startTestAuth, testProvider, testSignIn, type TestAuth } from "./test-support";

const google = testProvider({ id: "google", type: "google", displayName: "Google", clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-google-secret" });
const ISSUER = "https://sso.jobbbox.test";
const sso = testProvider({
  id: "jobbbox-sso",
  type: "oidc",
  displayName: "Jobbbox SSO",
  clientId: "jobbbox-web",
  clientSecret: "test-sso-secret",
  discoveryUrl: `${ISSUER}/.well-known/openid-configuration`,
  trustedForLinking: false,
});

const issuerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

/** An ID token as Google's token endpoint returns it (signature not checked on that trusted channel). */
const googleIdToken = (claims: Record<string, unknown>) =>
  `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: "https://accounts.google.com", aud: google.clientId, iat: now(), exp: now() + 3600, ...claims })}.signature`;

/** An ID token signed by the OIDC issuer, checked against its JWKS. */
function ssoIdToken(claims: Record<string, unknown>): string {
  const unsigned = `${encode({ alg: "RS256", typ: "JWT", kid: "issuer-key" })}.${encode({ iss: ISSUER, aud: sso.clientId, iat: now(), exp: now() + 3600, ...claims })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), issuerKeys.privateKey).toString("base64url")}`;
}

/** Who Google and the OIDC issuer say is signing in, and the nonce the issuer was asked to sign. */
const person: { google: Record<string, unknown>; sso: Record<string, unknown>; nonce?: string } = { google: {}, sso: {} };

/** Stands in for Google and for the OIDC issuer (discovery, JWKS, code exchange). */
function providersAnswer() {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "google-access-token", token_type: "Bearer", expires_in: 3600, scope: "openid email profile", id_token: googleIdToken(person.google) });
    }
    if (url === sso.discoveryUrl) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [{ ...issuerKeys.publicKey.export({ format: "jwk" }), kid: "issuer-key", alg: "RS256", use: "sig" }] });
    if (url === `${ISSUER}/token`) {
      return Response.json({ access_token: "sso-access-token", token_type: "Bearer", expires_in: 3600, id_token: ssoIdToken({ ...person.sso, nonce: person.nonce }) });
    }
    return realFetch(input, init);
  });
}

describe.skipIf(!connectionString)("signing in through the Sign-in Providers (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  const testPassed = vi.fn(async (providerId: string) => void providerId);

  async function start(providers = [google, sso]) {
    testAuth = await startTestAuth({ signIn: testSignIn(providers, { administrators: ["claire@jobbbox.fr"], onTestPassed: testPassed }) });
  }

  beforeEach(() => {
    person.google = {};
    person.sso = {};
    testPassed.mockClear();
    // Before the instance is built: it reads the OIDC issuer's discovery document then.
    providersAnswer();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await testAuth.stop();
  });

  /** Starts a sign-in (or, with `link`, linking from Mon compte) through `providerId`, lets the provider approve, and returns the callback's answer. */
  async function through(providerId: string, options: { cookie?: string; link?: boolean; request?: TestAuth["request"] } = {}): Promise<Response> {
    const request = options.request ?? testAuth.request;
    const started = await request(options.link ? "/api/auth/link-social" : "/api/auth/sign-in/social", {
      body: { provider: providerId, callbackURL: "/compte", errorCallbackURL: "/connexion" },
      ...(options.cookie ? { cookie: options.cookie } : {}),
    });
    expect(started.status).toBe(200);
    const authorize = new URL((await started.json()).url);
    person.nonce = authorize.searchParams.get("nonce") ?? undefined;
    const cookie = [options.cookie, cookiesFrom(started)].filter(Boolean).join("; ");
    return request(`/api/auth/callback/${providerId}?code=provider-code&state=${authorize.searchParams.get("state")}`, { cookie });
  }

  const sessionOf = async (cookie: string, request = testAuth.request) => (await request("/api/auth/get-session", { cookie })).json();
  const candidates = async () => Number((await testAuth.database.query("SELECT count(*) FROM candidate")).rows[0].count);
  const locationOf = (response: Response) => new URL(response.headers.get("location")!, BASE_URL);

  describe("a provider allowed for Administrators but not shown to Candidates", () => {
    const staffOnly = { ...google, shownToCandidates: false };

    it("signs no Candidate in, nor up", async () => {
      await start([staffOnly]);
      await signInWithMagicLink(testAuth, "jean.martin@gmail.com");
      person.google = { sub: "google-jean", email: "jean.martin@gmail.com", email_verified: true, name: "Jean Martin" };

      const callback = await through("google");

      expect(callback.status).toBe(302);
      expect(locationOf(callback).pathname).toBe("/connexion");
      expect(locationOf(callback).searchParams.get("error")).toBe("provider_not_allowed");
      expect(callback.headers.getSetCookie().join()).not.toContain("session_token");

      person.google = { sub: "google-paul", email: "paul@gmail.com", email_verified: true, name: "Paul" };
      const newcomer = await through("google");
      expect(locationOf(newcomer).searchParams.get("error")).toBe("provider_not_allowed");
      expect(await candidates()).toBe(1);
    });

    it("signs an Administrator in", async () => {
      await start([staffOnly]);
      person.google = { sub: "google-claire", email: "claire@jobbbox.fr", email_verified: true, name: "Claire" };

      const callback = await through("google");

      expect(locationOf(callback).pathname).toBe("/compte");
      const session = await sessionOf(cookiesFrom(callback));
      expect(session.user.email).toBe("claire@jobbbox.fr");
    });
  });

  describe("an account with the same email", () => {
    it("is signed into through a provider trusted for linking", async () => {
      await start();
      const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      person.google = { sub: "google-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" };

      const viaGoogle = cookiesFrom(await through("google"));

      expect((await sessionOf(viaGoogle)).user.id).toBe((await sessionOf(magic)).user.id);
    });

    it("is not linked through an untrusted provider: the Candidate signs in by magic link and links it from Mon compte", async () => {
      await start();
      const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      person.sso = { sub: "sso-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" };

      const refused = await through("jobbbox-sso");

      expect(locationOf(refused).pathname).toBe("/connexion");
      expect(locationOf(refused).searchParams.get("error")).toBe("account_not_linked");
      expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
      expect(await candidates()).toBe(1);

      const linked = await through("jobbbox-sso", { cookie: magic, link: true });
      expect(locationOf(linked).pathname).toBe("/compte");

      const viaSso = cookiesFrom(await through("jobbbox-sso"));
      expect((await sessionOf(viaSso)).user.id).toBe((await sessionOf(magic)).user.id);
    });

    it("of an Apple private relay address never matches: it is always a separate account", async () => {
      await start();
      await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      person.sso = { sub: "sso-relay", email: "x7k2p9@privaterelay.appleid.com", email_verified: true, name: "Marie" };

      const callback = await through("jobbbox-sso");

      expect((await sessionOf(cookiesFrom(callback))).user.email).toBe("x7k2p9@privaterelay.appleid.com");
      expect(await candidates()).toBe(2);
    });
  });

  describe("a provider not enabled yet", () => {
    it("is tested by a sign-in that creates nothing and signs nobody in", async () => {
      await start([google, { ...sso, enabled: false }]);
      person.sso = { sub: "sso-claire", email: "claire@jobbbox.fr", email_verified: true, name: "Claire" };

      const callback = await through("jobbbox-sso");

      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(`${BASE_URL}/admin/connexion?tested=jobbbox-sso`);
      expect(callback.headers.getSetCookie().join()).not.toContain("session_token");
      expect(testPassed).toHaveBeenCalledWith("jobbbox-sso");
      expect(await candidates()).toBe(0);
    });

    it("signs no existing Candidate in either", async () => {
      await start([google, { ...sso, enabled: false }]);
      const magic = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      person.sso = { sub: "sso-claire", email: "claire@jobbbox.fr", email_verified: true, name: "Claire" };

      const linked = await through("jobbbox-sso", { cookie: magic, link: true });

      expect(locationOf(linked).pathname).toBe("/admin/connexion");
      expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" = 'jobbbox-sso'")).rows[0].count).toBe("0");
    });
  });

  it("records on each session how it was signed in", async () => {
    await start();
    const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    person.google = { sub: "google-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" };
    const viaGoogle = cookiesFrom(await through("google"));

    expect((await sessionOf(magic)).session.signInMethod).toBe("magic-link");
    expect((await sessionOf(viaGoogle)).session.signInMethod).toBe("google");
  });

  it("refuses a sign-in method set by the client", async () => {
    await start();
    const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");

    await testAuth.request("/api/auth/update-session", { cookie: magic, body: { signInMethod: "jobbbox-sso" } });

    expect((await sessionOf(magic)).session.signInMethod).toBe("magic-link");
  });

  it("signs nobody out when it is rebuilt with another configuration", async () => {
    await start([google]);
    const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    person.google = { sub: "google-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" };
    const viaGoogle = cookiesFrom(await through("google"));

    const rebuilt = testAuth.requestTo(createAuth({ ...testAuth.config, signIn: testSignIn([google, sso]) }));

    expect((await sessionOf(magic, rebuilt)).user.email).toBe("marie.dupont@example.fr");
    expect((await sessionOf(viaGoogle, rebuilt)).user.email).toBe("marie.dupont@example.fr");
    person.sso = { sub: "sso-paul", email: "paul@example.fr", email_verified: true, name: "Paul" };
    expect((await sessionOf(cookiesFrom(await through("jobbbox-sso", { request: rebuilt })), rebuilt)).user.email).toBe("paul@example.fr");
  });
});
