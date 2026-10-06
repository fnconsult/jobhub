import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionString, cookiesFrom, signInWithMagicLink, startTestAuth, type TestAuth } from "./test-support";

const google = { clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-client-secret" };

/** An ID token as Google's token endpoint returns it (signature not checked on that trusted channel). */
function idToken(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: "https://accounts.google.com",
    aud: google.clientId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.signature`;
}

/** Stands in for Google: answers the authorization-code exchange with `claims`. */
function googleAnswers(claims: Record<string, unknown>) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({
        access_token: "google-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email profile",
        id_token: idToken(claims),
      });
    }
    return realFetch(input, init);
  });
}

describe.skipIf(!connectionString)("Google sign-in (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  beforeEach(async () => {
    testAuth = await startTestAuth({ google });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await testAuth.stop();
  });

  /** Clicks "Continue with Google", lets Google approve, and returns the session cookie. */
  async function signInWithGoogle(): Promise<string> {
    const started = await testAuth.request("/api/auth/sign-in/social", {
      body: { provider: "google", callbackURL: "/" },
    });
    const { url } = await started.json();
    const authorize = new URL(url);
    expect(authorize.origin).toBe("https://accounts.google.com");
    expect(authorize.searchParams.get("client_id")).toBe(google.clientId);

    const callback = await testAuth.request(
      `/api/auth/callback/google?code=google-code&state=${authorize.searchParams.get("state")}`,
      { cookie: cookiesFrom(started) },
    );
    return cookiesFrom(callback);
  }

  it("signs a new person up as a Candidate with their Google identity", async () => {
    googleAnswers({ sub: "google-123", email: "jean.martin@gmail.com", email_verified: true, name: "Jean Martin" });

    const cookie = await signInWithGoogle();

    const session = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    expect(session.user).toMatchObject({ email: "jean.martin@gmail.com", name: "Jean Martin", interfaceLanguage: "fr" });
  });

  it("signs a Candidate who first used a magic link into the same account", async () => {
    const magic = await signInWithMagicLink(testAuth, "jean.martin@gmail.com");
    googleAnswers({ sub: "google-123", email: "jean.martin@gmail.com", email_verified: true, name: "Jean Martin" });

    const viaGoogle = await signInWithGoogle();

    const [a, b] = await Promise.all(
      [magic, viaGoogle].map(async (cookie) => (await testAuth.request("/api/auth/get-session", { cookie })).json()),
    );
    expect(b.user.id).toBe(a.user.id);
  });
});
