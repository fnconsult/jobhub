import type { ExternalApiCall } from "@jobhub/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingSignInCalls, signInToolOf } from "./sign-in-calls";

const request = (path: string, method = "GET") => new Request(new URL(path, "http://localhost:3000"), { method });

describe("the sign-in Tool a request to Better Auth calls", () => {
  it.each([
    ["/api/auth/callback/google", "google"],
    ["/api/auth/callback/apple", "apple"],
    ["/api/auth/callback/microsoft", "microsoft"],
    ["/api/auth/oauth2/callback/okta-acme", "oidc"],
  ])("%s: %s", (path, tool) => {
    expect(signInToolOf(path)).toBe(tool);
  });

  it.each(["/api/auth/sign-in/magic-link", "/api/auth/get-session", "/api/auth/callback/unknown", "/api/auth/callback/google/extra"])("%s: none", (path) => {
    expect(signInToolOf(path)).toBeNull();
  });
});

describe("the calls a sign-in makes to its provider, as recorded (#234)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A provider answering every call: its token and keys endpoints, its user info. */
  function provider(status = 200) {
    const fetch = vi.fn(async () => Response.json({ access_token: "secret-access-token", email: "marie@example.com" }, { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const recorder = () => {
    const calls: ExternalApiCall[] = [];
    return { calls, log: { record: (call: ExternalApiCall) => void calls.push(call) } };
  };

  it("records each call of a provider's callback under its Tool, named by what it asks: never the URL, the code or the identity", async () => {
    provider();
    const { calls, log } = recorder();

    const response = await recordingSignInCalls(request("/api/auth/callback/google?code=google-code&state=s"), log, async () => {
      await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: "code=google-code&client_secret=gsecret" });
      await fetch("https://www.googleapis.com/oauth2/v3/certs");
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: "Bearer secret-access-token" } });
      return new Response(null, { status: 302 });
    });

    expect(response.status).toBe(302);
    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "google", operation: "token", ok: true, httpStatus: 200 },
      { provider: "google", operation: "keys", ok: true, httpStatus: 200 },
      { provider: "google", operation: "userinfo", ok: true, httpStatus: 200 },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/googleapis|google-code|secret|marie/);
  });

  it("names an OIDC issuer's and Microsoft's other calls without their address", async () => {
    provider(401);
    const { calls, log } = recorder();

    await recordingSignInCalls(request("/api/auth/oauth2/callback/okta-acme", "GET"), log, async () => {
      await fetch("https://acme.okta.com/oauth2/v1/token", { method: "POST" });
      await fetch("https://acme.okta.com/.well-known/openid-configuration");
      await fetch("https://graph.microsoft.com/v1.0/me/photos/48x48/$value");
      return new Response(null, { status: 302 });
    });

    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "oidc", operation: "token", ok: false, httpStatus: 401 },
      { provider: "oidc", operation: "discovery", ok: false, httpStatus: 401 },
      { provider: "oidc", operation: "other", ok: false, httpStatus: 401 },
    ]);
  });

  it("records nothing for a request that is not a provider's callback, nor for calls made outside one", async () => {
    provider();
    const { calls, log } = recorder();

    await recordingSignInCalls(request("/api/auth/sign-in/magic-link", "POST"), log, async () => {
      await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST" });
      return new Response(null);
    });
    await fetch("https://oauth2.googleapis.com/token", { method: "POST" });

    expect(calls).toEqual([]);
  });

  it("keeps two sign-ins at once apart", async () => {
    provider();
    const { calls, log } = recorder();

    await Promise.all([
      recordingSignInCalls(request("/api/auth/callback/apple", "POST"), log, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await fetch("https://appleid.apple.com/auth/token", { method: "POST" });
        return new Response(null);
      }),
      recordingSignInCalls(request("/api/auth/callback/microsoft"), log, async () => {
        await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST" });
        return new Response(null);
      }),
    ]);

    expect(calls.map(({ provider, operation }) => `${provider} ${operation}`).sort()).toEqual(["apple token", "microsoft token"]);
  });

  it("signs in even when its calls cannot be recorded", async () => {
    provider();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await recordingSignInCalls(request("/api/auth/callback/google"), { record: () => Promise.reject(new Error("insert failed")) }, async () => {
        const answer = await fetch("https://oauth2.googleapis.com/token", { method: "POST" });
        return new Response(null, { status: answer.ok ? 302 : 500 });
      });
      expect(response.status).toBe(302);
    } finally {
      warn.mockRestore();
    }
  });
});
