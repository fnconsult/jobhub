import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permanentSuperAdminsFromEnv } from "../admin/access";
import { createAuth } from "./index";
import type { SignInProvider } from "../sign-in-providers/catalog";
import { BASE_URL, connectionString, cookiesFrom, signInWithMagicLink, startTestAuth, testProvider, testSignIn, type TestAuth } from "./test-support";

const google = testProvider({ id: "google", type: "google", displayName: "Google", clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-google-secret" });
const ISSUER = "https://sso.jobbbox.test";
/** The issuer's discovery document, as the Sign-in Providers fetched it when reading the configuration. */
const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/jwks`,
  id_token_signing_alg_values_supported: ["RS256"],
};
const sso = testProvider({
  id: "jobbbox-sso",
  type: "oidc",
  displayName: "Jobbbox SSO",
  clientId: "jobbbox-web",
  clientSecret: "test-sso-secret",
  discoveryUrl: `${ISSUER}/.well-known/openid-configuration`,
  discovery,
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

/** Microsoft on its multi-tenant directory: any tenant's admin may set any email on an account. */
const microsoft = testProvider({ id: "microsoft", type: "microsoft", displayName: "Microsoft", clientId: "jobbbox-microsoft", clientSecret: "test-microsoft-secret", tenantId: "common" });
const microsoftIdToken = (claims: Record<string, unknown>) =>
  `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: "https://login.microsoftonline.com/some-tenant/v2.0", tid: "some-tenant", aud: microsoft.clientId, iat: now(), exp: now() + 3600, ...claims })}.signature`;

/** Who Google, Microsoft and the OIDC issuer say is signing in, and the nonce the issuer was asked to sign. */
const person: { google: Record<string, unknown>; sso: Record<string, unknown>; microsoft: Record<string, unknown>; nonce?: string } = { google: {}, sso: {}, microsoft: {} };

/** How the OIDC issuer behaves in a test. */
const issuer = { hangs: false, discoveryRequests: 0 };

/** Stands in for Google and for the OIDC issuer (discovery, JWKS, code exchange). */
function providersAnswer() {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "google-access-token", token_type: "Bearer", expires_in: 3600, scope: "openid email profile", id_token: googleIdToken(person.google) });
    }
    if (url === sso.discoveryUrl) {
      issuer.discoveryRequests += 1;
      // An issuer that answered the Sign-in Providers' timed check, then hangs.
      if (issuer.hangs) return new Promise<Response>(() => {});
      return Response.json(discovery);
    }
    if (url.startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/token")) {
      return Response.json({ access_token: "microsoft-access-token", token_type: "Bearer", expires_in: 3600, id_token: microsoftIdToken(person.microsoft) });
    }
    if (url.startsWith("https://graph.microsoft.com/")) return new Response(null, { status: 404 });
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [{ ...issuerKeys.publicKey.export({ format: "jwk" }), kid: "issuer-key", alg: "RS256", use: "sig" }] });
    if (url === `${ISSUER}/token`) {
      return Response.json({ access_token: "sso-access-token", token_type: "Bearer", expires_in: 3600, id_token: ssoIdToken({ ...person.sso, nonce: person.nonce }) });
    }
    return realFetch(input, init);
  });
}

const configurationOf = (providers: SignInProvider[]) => testSignIn(providers).configuration;

describe.skipIf(!connectionString)("signing in through the Sign-in Providers (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  /** The test sign-in a super-admin started from Connexion, as the Sign-in Providers check it: this nonce only. */
  const completeTestSignIn = vi.fn(async (providerId: string, nonce: string) => providerId === "jobbbox-sso" && nonce === "nonce-issued-to-claire");

  async function start(providers = [google, sso]) {
    testAuth = await startTestAuth({ signIn: testSignIn(providers, { administrators: ["claire@jobbbox.fr"], completeTestSignIn }) });
  }

  beforeEach(() => {
    person.google = {};
    person.sso = {};
    person.microsoft = {};
    completeTestSignIn.mockClear();
    issuer.hangs = false;
    issuer.discoveryRequests = 0;
    // Before the instance is built: it reads the OIDC issuer's discovery document then.
    providersAnswer();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await testAuth.stop();
  });

  /** Starts a sign-in (or, with `link`, linking from Mon compte) through `providerId`, lets the provider approve, and returns the callback's answer. */
  async function through(providerId: string, options: { cookie?: string; link?: boolean; testNonce?: string; request?: TestAuth["request"] } = {}): Promise<Response> {
    const request = options.request ?? testAuth.request;
    const started = await request(options.link ? "/api/auth/link-social" : "/api/auth/sign-in/social", {
      body: {
        provider: providerId,
        callbackURL: "/compte",
        errorCallbackURL: "/connexion",
        ...(options.testNonce ? { additionalData: { testSignIn: options.testNonce } } : {}),
      },
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

    it("is linked from Mon compte through an untrusted provider that sends no email_verified (Microsoft common, many OIDC issuers), and only so", async () => {
      await start();
      const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      person.sso = { sub: "sso-marie", email: "marie.dupont@example.fr", name: "Marie" };

      // Signing in with it still asks for the magic link first.
      const refused = await through("jobbbox-sso");
      expect(locationOf(refused).searchParams.get("error")).toBe("account_not_linked");

      const linked = await through("jobbbox-sso", { cookie: magic, link: true });
      expect(locationOf(linked).pathname).toBe("/compte");
      expect(locationOf(linked).searchParams.get("error")).toBeNull();

      const viaSso = cookiesFrom(await through("jobbbox-sso"));
      expect((await sessionOf(viaSso)).user.id).toBe((await sessionOf(magic)).user.id);
    });

    it("is not linked from Mon compte when the provider's account has another email", async () => {
      await start();
      const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      person.sso = { sub: "sso-other", email: "someone.else@example.fr", name: "Other" };

      const linked = await through("jobbbox-sso", { cookie: magic, link: true });

      expect(locationOf(linked).searchParams.get("error")).not.toBeNull();
      expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" = 'jobbbox-sso'")).rows[0].count).toBe("0");
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
    const testing = { ...sso, enabled: false, testPending: true };

    it("is tested by the sign-in a super-admin started from Connexion: it passes, nothing is created, nobody is signed in", async () => {
      await start([google, testing]);
      person.sso = { sub: "sso-claire", email: "claire@jobbbox.fr", email_verified: true, name: "Claire" };

      const callback = await through("jobbbox-sso", { testNonce: "nonce-issued-to-claire" });

      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(`${BASE_URL}/admin/connexion?tested=jobbbox-sso`);
      expect(callback.headers.getSetCookie().join()).not.toContain("session_token");
      expect(completeTestSignIn).toHaveBeenCalledWith("jobbbox-sso", "nonce-issued-to-claire");
      expect(await candidates()).toBe(0);
    });

    it("refuses a callback no super-admin started, or with another nonce: not marked tested, nothing created", async () => {
      await start([google, testing]);
      person.sso = { sub: "sso-paul", email: "paul@example.fr", email_verified: true, name: "Paul" };

      for (const testNonce of [undefined, "a-nonce-nobody-issued"]) {
        const refused = await through("jobbbox-sso", testNonce ? { testNonce } : {});
        expect(locationOf(refused).pathname).toBe("/connexion");
        expect(locationOf(refused).searchParams.get("error")).toBe("provider_disabled");
        expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
      }
      expect(await Promise.all(completeTestSignIn.mock.results.map((result) => result.value))).not.toContain(true);
      expect(await candidates()).toBe(0);
    });

    it("signs in no Candidate linked to it before it was disabled, neither sends them to Connexion nor marks it tested", async () => {
      await start();
      const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      person.sso = { sub: "sso-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" };
      await through("jobbbox-sso", { cookie: magic, link: true });

      const disabled = testAuth.requestTo(createAuth({ ...testAuth.config, signIn: testSignIn([google, testing], { completeTestSignIn }) }));
      const refused = await through("jobbbox-sso", { request: disabled });

      expect(locationOf(refused).pathname).toBe("/connexion");
      expect(locationOf(refused).searchParams.get("error")).toBe("provider_disabled");
      expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
      expect(completeTestSignIn).not.toHaveBeenCalled();
    });

    it("is not linked from Mon compte either", async () => {
      await start([google, testing]);
      const magic = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      person.sso = { sub: "sso-claire", email: "claire@jobbbox.fr", email_verified: true, name: "Claire" };

      const linked = await through("jobbbox-sso", { cookie: magic, link: true });

      expect(locationOf(linked).pathname).toBe("/connexion");
      expect(locationOf(linked).searchParams.get("error")).toBe("provider_disabled");
      expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" = 'jobbbox-sso'")).rows[0].count).toBe("0");
    });

    it("is not registered at all without a test sign-in pending", async () => {
      await start([google, { ...sso, enabled: false }]);

      const started = await testAuth.request("/api/auth/sign-in/social", { body: { provider: "jobbbox-sso", callbackURL: "/compte" } });

      expect(started.status).toBe(404);
    });
  });

  describe("an account signed up through a provider not trusted for linking", () => {
    const ADMIN_EMAIL = "office@jobbbox.fr";
    const isPermanentSuperAdmin = permanentSuperAdminsFromEnv({ ADMIN_EMAILS: ADMIN_EMAIL });
    const candidate = async (email: string) => (await testAuth.database.query('SELECT id, email, "emailVerified" FROM candidate WHERE email = $1', [email])).rows[0];

    it("starts with its email not verified, whatever the OIDC issuer claims: an ADMIN_EMAILS address gets no Back Office", async () => {
      await start();
      person.sso = { sub: "sso-office", email: ADMIN_EMAIL, email_verified: true, name: "Office" };

      const session = await sessionOf(cookiesFrom(await through("jobbbox-sso")));

      expect(session.user).toMatchObject({ email: ADMIN_EMAIL, emailVerified: false });
      expect((await candidate(ADMIN_EMAIL)).emailVerified).toBe(false);
      expect(isPermanentSuperAdmin(await candidate(ADMIN_EMAIL))).toBe(false);
    });

    it("starts with its email not verified through Microsoft on a multi-tenant directory, though Microsoft is trusted otherwise", async () => {
      await start([google, microsoft]);
      person.microsoft = { oid: "microsoft-office", sub: "microsoft-office", email: ADMIN_EMAIL, email_verified: true, name: "Office" };

      const session = await sessionOf(cookiesFrom(await through("microsoft")));

      expect(session.user).toMatchObject({ email: ADMIN_EMAIL, emailVerified: false });
      expect(isPermanentSuperAdmin(await candidate(ADMIN_EMAIL))).toBe(false);
    });

    it("is never made verified by a later sign-in through it; only the magic link verifies it", async () => {
      await start();
      person.sso = { sub: "sso-office", email: ADMIN_EMAIL, email_verified: true, name: "Office" };
      await through("jobbbox-sso");
      await through("jobbbox-sso");

      expect((await candidate(ADMIN_EMAIL)).emailVerified).toBe(false);

      await signInWithMagicLink(testAuth, ADMIN_EMAIL);
      expect((await candidate(ADMIN_EMAIL)).emailVerified).toBe(true);
    });

    it("through a trusted provider, keeps the email the provider verified", async () => {
      await start();
      person.google = { sub: "google-paul", email: "paul@gmail.com", email_verified: true, name: "Paul" };

      await through("google");

      expect((await candidate("paul@gmail.com")).emailVerified).toBe(true);
    });
  });

  describe("a sign-in with an ID token instead of the redirect (POST /sign-in/social with idToken)", () => {
    // No client of ours signs in this way: refused outright, so the provider policy cannot be skipped.
    it("is refused from an untrusted provider whose token says the email is verified: no account is taken over", async () => {
      await start();
      await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      const token = ssoIdToken({ sub: "sso-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" });

      const refused = await testAuth.request("/api/auth/sign-in/social", { body: { provider: "jobbbox-sso", idToken: { token } } });

      expect(refused.status).toBe(400);
      expect((await refused.json()).code).toBe("ID_TOKEN_SIGN_IN_NOT_SUPPORTED");
      expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
      expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" = 'jobbbox-sso'")).rows[0].count).toBe("0");
    });

    it("is refused through a provider allowed for Administrators only, to anyone", async () => {
      await start([{ ...google, shownToCandidates: false }]);
      const token = googleIdToken({ sub: "google-paul", email: "paul@gmail.com", email_verified: true, name: "Paul" });

      const refused = await testAuth.request("/api/auth/sign-in/social", { body: { provider: "google", idToken: { token } } });

      expect(refused.status).toBe(400);
      expect(await candidates()).toBe(0);
    });

    it("is refused for linking too", async () => {
      await start();
      const magic = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      const token = ssoIdToken({ sub: "sso-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" });

      const refused = await testAuth.request("/api/auth/link-social", { cookie: magic, body: { provider: "jobbbox-sso", idToken: { token } } });

      expect(refused.status).toBe(400);
      expect((await testAuth.database.query("SELECT count(*) FROM account WHERE \"providerId\" = 'jobbbox-sso'")).rows[0].count).toBe("0");
    });
  });

  describe("rebuilt from another configuration", () => {
    it("starts without asking the OIDC issuer anything: its discovery document is the one read with the configuration", async () => {
      issuer.hangs = true;
      await start();
      person.sso = { sub: "sso-paul", email: "paul@example.fr", email_verified: true, name: "Paul" };

      const callback = await through("jobbbox-sso");

      expect(locationOf(callback).pathname).toBe("/compte");
      expect(issuer.discoveryRequests).toBe(0);
    }, 10_000);

    it("decides with the configuration in use now, not the one it was built with: a provider disabled since is refused", async () => {
      let live = configurationOf([google, sso]);
      await start();
      const stale = testAuth.requestTo(createAuth({ ...testAuth.config, signIn: { ...testSignIn([google, sso]), current: () => live } }));
      live = configurationOf([google, { ...sso, enabled: false }]);
      person.sso = { sub: "sso-paul", email: "paul@example.fr", email_verified: true, name: "Paul" };

      const refused = await through("jobbbox-sso", { request: stale });

      expect(locationOf(refused).searchParams.get("error")).toBe("provider_disabled");
      expect(await candidates()).toBe(0);
    });

    it("decides with the configuration in use now: a provider no longer trusted for linking takes over no account", async () => {
      let live = configurationOf([google, { ...sso, trustedForLinking: true }]);
      await start([google, { ...sso, trustedForLinking: true }]);
      const stale = testAuth.requestTo(createAuth({ ...testAuth.config, signIn: { ...testSignIn([google, { ...sso, trustedForLinking: true }]), current: () => live } }));
      await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      live = configurationOf([google, sso]);
      person.sso = { sub: "sso-marie", email: "marie.dupont@example.fr", email_verified: true, name: "Marie" };

      const refused = await through("jobbbox-sso", { request: stale });

      expect(locationOf(refused).searchParams.get("error")).toBe("account_not_linked");
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
