import { describe, expect, it, vi } from "vitest";
import type { ExternalApiCall } from "@jobhub/shared";
import type { SecretProvider } from "./catalog";
import { createConnectionTester } from "./connection-tests";

/** A fetch that records each request and answers `status` with `body`. Nothing reaches a real provider. */
function fakeFetch(status = 200, body: unknown = {}) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

describe("testing a provider's keys with its cheapest authenticated call", () => {
  it.each<[SecretProvider, Record<string, string>, string, string, Record<string, string>]>([
    ["mistral", { MISTRAL_API_KEY: "mk" }, "GET", "https://api.eu.mistral.ai/v1/models", { authorization: "Bearer mk" }],
    ["perplexity", { PERPLEXITY_API_KEY: "pk" }, "GET", "https://api.perplexity.ai/v1/models", { authorization: "Bearer pk" }],
    ["anthropic", { ANTHROPIC_API_KEY: "ak" }, "GET", "https://api.anthropic.com/v1/models", { "x-api-key": "ak", "anthropic-version": "2023-06-01" }],
    ["bedrock", { AWS_BEARER_TOKEN_BEDROCK: "bk", BEDROCK_REGION: "eu-central-1" }, "GET", "https://bedrock-mantle.eu-central-1.api.aws/v1/models", { authorization: "Bearer bk" }],
    ["stripe", { STRIPE_SECRET_KEY: "sk_test_1" }, "GET", "https://api.stripe.com/v1/balance", { authorization: "Bearer sk_test_1" }],
    ["lusha", { LUSHA_API_KEY: "lk" }, "GET", "https://api.lusha.com/account/usage", { api_key: "lk" }],
    ["apollo", { APOLLO_API_KEY: "ak" }, "GET", "https://api.apollo.io/api/v1/auth/health", { "x-api-key": "ak" }],
    ["kaspr", { KASPR_API_KEY: "kk" }, "GET", "https://api.developers.kaspr.io/keys/remaining", { authorization: "Bearer kk" }],
  ])("%s: %s %s", async (provider, env, method, url, headers) => {
    const { fetch, requests } = fakeFetch(200, provider === "apollo" ? { is_logged_in: true } : {});

    expect(await createConnectionTester({ fetch })(provider, env)).toEqual({ ok: true });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe(method);
    expect(requests[0]!.url).toBe(url);
    for (const [header, value] of Object.entries(headers)) expect(requests[0]!.headers.get(header)).toBe(value);
  });

  it("Brave: one web search of a single result, the key in its X-Subscription-Token header (#399)", async () => {
    const { fetch, requests } = fakeFetch(200, { web: { results: [] } });

    expect(await createConnectionTester({ fetch })("brave", { BRAVE_SEARCH_API_KEY: "bsa-key" })).toEqual({ ok: true });

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(requests[0]!.method).toBe("GET");
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("count")).toBe("1");
    expect(url.searchParams.get("q")).toBeTruthy();
    expect(requests[0]!.headers.get("x-subscription-token")).toBe("bsa-key");
  });

  it("Tavily: reads its usage (no credit spent) with the key as a bearer token (#399)", async () => {
    const { fetch, requests } = fakeFetch(200, { key: { usage: 3, limit: 1000 } });

    expect(await createConnectionTester({ fetch })("tavily", { TAVILY_API_KEY: "tvly-key" })).toEqual({ ok: true });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url).toBe("https://api.tavily.com/usage");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer tvly-key");
  });

  it.each<[SecretProvider, string, number]>([
    ["brave", "BRAVE_SEARCH_API_KEY", 401],
    ["brave", "BRAVE_SEARCH_API_KEY", 429],
    ["tavily", "TAVILY_API_KEY", 401],
    ["tavily", "TAVILY_API_KEY", 432],
  ])("%s: a key refused (%s, HTTP %i) fails, a missing one fails without a call", async (provider, name, status) => {
    const refused = fakeFetch(status, { detail: "nope" });
    const none = fakeFetch();

    expect(await createConnectionTester({ fetch: refused.fetch })(provider, { [name]: "bad" })).toEqual({ ok: false, detail: expect.stringContaining(`HTTP ${status}`) });
    expect(await createConnectionTester({ fetch: none.fetch })(provider, {})).toEqual({ ok: false, detail: `missing ${name}` });
    expect(none.requests).toEqual([]);
  });

  it("France Travail: asks for an OAuth token with both client credentials", async () => {
    const { fetch, requests } = fakeFetch(200, { access_token: "t", expires_in: 1500 });

    expect(await createConnectionTester({ fetch })("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" })).toEqual({
      ok: true,
      apis: { la_bonne_boite: "ok", offres_emploi: "ok", romeo: "ok" },
    });

    expect(requests[0]!.url).toContain("francetravail.fr/connexion/oauth2/access_token");
    const form = new URLSearchParams(await requests[0]!.text());
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: "client_credentials", client_id: "id", client_secret: "secret" });
  });

  it("France Travail: a client lacking Offres d'emploi passes, with each API's state", async () => {
    const scopes: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const scope = new URLSearchParams(await new Request(input, init).text()).get("scope") ?? "";
      scopes.push(scope);
      return scope.startsWith("api_offresdemploiv2")
        ? Response.json({ error: "invalid_scope", error_description: "Unknown/invalid scope(s): [api_offresdemploiv2]" }, { status: 400 })
        : Response.json({ access_token: "t", expires_in: 1499 });
    }) as typeof globalThis.fetch;

    expect(await createConnectionTester({ fetch })("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" })).toEqual({
      ok: true,
      apis: { la_bonne_boite: "ok", offres_emploi: "refused", romeo: "ok" },
    });
    // The client is validated with La Bonne Boite, then each API asks its own token.
    expect(scopes).toEqual(["api_labonneboitev2 search office", "api_offresdemploiv2 o2dsoffre", "api_romeov2"]);
  });

  it("France Travail: a client its endpoint does not know fails, with the status", async () => {
    const { fetch, requests } = fakeFetch(400, { error: "invalid_client", error_description: "Client authentication failed" });

    expect(await createConnectionTester({ fetch })("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "bad" })).toEqual({
      ok: false,
      detail: expect.stringContaining("HTTP 400 invalid_client"),
      apis: { la_bonne_boite: "error", offres_emploi: "error", romeo: "error" },
    });
    expect(requests).toHaveLength(1);
  });

  it("Fantastic.jobs: asks active-ats for no job (none charged) with the API key as a bearer token", async () => {
    const { fetch, requests } = fakeFetch(200, []);

    expect(await createConnectionTester({ fetch })("fantastic-jobs", { FANTASTIC_JOBS_API_KEY: "fj-key" })).toEqual({ ok: true });

    const url = new URL(requests[0]!.url);
    expect(url.origin + url.pathname).toBe("https://data.fantastic.jobs/v1/active-ats");
    // No job has id 0, and at most 1 could come: the test spends one API request, no Jobs credit.
    expect(Object.fromEntries(url.searchParams)).toEqual({ id: "0", limit: "1", time_frame: "1h" });
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer fj-key");
  });

  it("Fantastic.jobs: a key it rejects fails, a missing one fails without a call, the e2e fake is used when named", async () => {
    const rejected = fakeFetch(401, { message: "Invalid API key" });
    const none = fakeFetch();
    const fake = fakeFetch(200, []);

    expect(await createConnectionTester({ fetch: rejected.fetch })("fantastic-jobs", { FANTASTIC_JOBS_API_KEY: "bad" })).toEqual({ ok: false, detail: expect.stringContaining("HTTP 401") });
    expect(await createConnectionTester({ fetch: none.fetch })("fantastic-jobs", {})).toEqual({ ok: false, detail: "missing FANTASTIC_JOBS_API_KEY" });
    expect(none.requests).toEqual([]);
    await createConnectionTester({ fetch: fake.fetch })("fantastic-jobs", { FANTASTIC_JOBS_API_KEY: "fj-key", FANTASTIC_JOBS_API_URL: "http://127.0.0.1:9997/v1/" });
    expect(fake.requests[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:9997\/v1\/active-ats\?/);
  });

  it("a refusal is a failed test, with the status", async () => {
    const { fetch } = fakeFetch(401, { message: "Unauthorized" });

    expect(await createConnectionTester({ fetch })("mistral", { MISTRAL_API_KEY: "mk" })).toEqual({ ok: false, detail: expect.stringContaining("HTTP 401") });
  });

  it("a network failure is a failed test", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    expect(await createConnectionTester({ fetch })("stripe", { STRIPE_SECRET_KEY: "sk_test_1" })).toEqual({ ok: false, detail: expect.stringContaining("fetch failed") });
  });

  it("a key missing for the provider fails without a call", async () => {
    const { fetch } = fakeFetch();

    expect(await createConnectionTester({ fetch })("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "id" })).toEqual({ ok: false, detail: "missing FRANCE_TRAVAIL_CLIENT_SECRET" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("goes to the e2e fakes' origins when the env names them", async () => {
    const { fetch, requests } = fakeFetch(200, { is_logged_in: true });
    const tester = createConnectionTester({ fetch });

    await tester("stripe", { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_API_URL: "http://127.0.0.1:9999" });
    await tester("apollo", { APOLLO_API_KEY: "ak", CONTACT_ENRICHMENT_PROVIDER: "apollo", CONTACT_ENRICHMENT_API_URL: "http://127.0.0.1:9998/api/v1" });

    expect(requests.map((request) => request.url)).toEqual(["http://127.0.0.1:9999/v1/balance", "http://127.0.0.1:9998/api/v1/auth/health"]);
  });

  it("Stripe: refuses a live key outside production, as billing does", async () => {
    const { fetch } = fakeFetch();

    expect(await createConnectionTester({ fetch })("stripe", { STRIPE_SECRET_KEY: "sk_live_1" })).toEqual({ ok: false, detail: expect.stringContaining("live") });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Apollo: a key it does not log in with fails", async () => {
    const { fetch } = fakeFetch(200, { is_logged_in: false });

    expect(await createConnectionTester({ fetch })("apollo", { APOLLO_API_KEY: "ak" })).toEqual({ ok: false, detail: expect.stringContaining("not logged in") });
  });

  it("Stripe's webhook secret cannot be called: its shape is checked", async () => {
    const { fetch } = fakeFetch();
    const tester = createConnectionTester({ fetch });

    expect(await tester("stripe", { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "nope" })).toEqual({ ok: false, detail: expect.stringContaining("whsec_") });
    expect(await tester("stripe", { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_abc" })).toEqual({ ok: true });
  });

  it("Brevo: reads the account with the API key, over the SMTP relay", async () => {
    const verifySmtp = vi.fn(async () => {});
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}", { status: (init?.headers as Record<string, string>)["api-key"] === "xkeysib-good" ? 200 : 401 });
    }) as typeof globalThis.fetch;
    const tester = createConnectionTester({ fetch, verifySmtp });

    expect(await tester("brevo", { BREVO_API_KEY: "xkeysib-good", SMTP_URL: "smtps://user:pass@smtp-relay.brevo.com:465" })).toEqual({ ok: true });
    expect(calls[0]?.[0]).toBe("https://api.brevo.com/v3/account");
    expect(verifySmtp).not.toHaveBeenCalled();
    expect(await tester("brevo", { BREVO_API_KEY: "xkeysib-bad" })).toEqual({ ok: false, detail: expect.stringContaining("401") });
    expect(await tester("brevo", {})).toEqual({ ok: false, detail: "missing BREVO_API_KEY or SMTP_URL" });
  });

  it("Brevo: verifies the SMTP relay with the URL's credentials", async () => {
    const verifySmtp = vi.fn(async () => {});
    const tester = createConnectionTester({ verifySmtp });

    expect(await tester("brevo", { SMTP_URL: "smtps://user:pass@smtp-relay.brevo.com:465" })).toEqual({ ok: true });
    expect(verifySmtp).toHaveBeenCalledWith("smtps://user:pass@smtp-relay.brevo.com:465");

    verifySmtp.mockRejectedValueOnce(new Error("Invalid login: 535 Authentication failed"));
    expect(await tester("brevo", { SMTP_URL: "smtps://user:pass@smtp-relay.brevo.com:465" })).toEqual({ ok: false, detail: expect.stringContaining("535") });
  });
});

describe("Email intake's inbound secret", () => {
  it("calls no one: it only checks the secret is long enough to share with the MTA, and records nothing", async () => {
    const calls: ExternalApiCall[] = [];
    const tester = createConnectionTester({ fetch: fakeFetch(500).fetch, externalApis: { record: (call: ExternalApiCall) => void calls.push(call) } });

    expect(await tester("email-intake", { EMAIL_INTAKE_INBOUND_SECRET: "x".repeat(32) })).toEqual({ ok: true });
    expect(await tester("email-intake", { EMAIL_INTAKE_INBOUND_SECRET: "too-short" })).toEqual({ ok: false, detail: "EMAIL_INTAKE_INBOUND_SECRET must be at least 32 characters" });
    expect(await tester("email-intake", {})).toEqual({ ok: false, detail: "missing EMAIL_INTAKE_INBOUND_SECRET" });
    expect(calls).toEqual([]);
  });
});

describe("a connection test, as recorded", () => {
  const recorder = () => {
    const calls: ExternalApiCall[] = [];
    return { calls, externalApis: { record: (call: ExternalApiCall) => void calls.push(call) } };
  };

  it.each<[SecretProvider, Record<string, string>, string]>([
    ["mistral", { MISTRAL_API_KEY: "mk-abcdefgh" }, "mistral"],
    ["perplexity", { PERPLEXITY_API_KEY: "pplx-abcdefgh" }, "perplexity"],
    ["brave", { BRAVE_SEARCH_API_KEY: "bsa-abcdefgh" }, "brave"],
    ["tavily", { TAVILY_API_KEY: "tvly-abcdefgh" }, "tavily"],
    ["anthropic", { ANTHROPIC_API_KEY: "sk-ant-abcdefgh" }, "anthropic"],
    ["bedrock", { AWS_BEARER_TOKEN_BEDROCK: "bk-abcdefgh" }, "anthropic_bedrock"],
    ["france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "id-abcdefgh", FRANCE_TRAVAIL_CLIENT_SECRET: "secret-abcdefgh" }, "france_travail"],
    ["lusha", { LUSHA_API_KEY: "lk-abcdefgh" }, "lusha"],
    ["kaspr", { KASPR_API_KEY: "kk-abcdefgh" }, "kaspr"],
    ["apollo", { APOLLO_API_KEY: "ak-abcdefgh" }, "apollo"],
    ["stripe", { STRIPE_SECRET_KEY: "sk_test_abcdefgh" }, "stripe"],
    ["brevo", { BREVO_API_KEY: "xkeysib-abcdefgh" }, "brevo"],
  ])("%s: one connection_test call to its Tool, never the key", async (provider, env, tool) => {
    const { calls, externalApis } = recorder();
    const { fetch } = fakeFetch(401);

    await createConnectionTester({ fetch, externalApis })(provider, env);

    expect(calls).toEqual([expect.objectContaining({ provider: tool, operation: "connection_test", ok: false, httpStatus: 401 })]);
    expect(calls[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(calls)).not.toMatch(/abcdefgh/);
  });

  it("Brevo's SMTP relay: its verification, recorded under the relay", async () => {
    const { calls, externalApis } = recorder();

    await createConnectionTester({ externalApis, verifySmtp: async () => {} })("brevo", { SMTP_URL: "smtp://user:secret@smtp-relay.brevo.com:587" });
    await createConnectionTester({ externalApis, verifySmtp: async () => Promise.reject(new Error("Invalid login")) })("brevo", { SMTP_URL: "smtp://user:secret@smtp-relay.brevo.com:587" });

    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "brevo_smtp", operation: "connection_test", ok: true, httpStatus: null },
      { provider: "brevo_smtp", operation: "connection_test", ok: false, httpStatus: null },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/secret|user/);
  });

  it("records nothing when a key is missing: no call was made", async () => {
    const { calls, externalApis } = recorder();

    await createConnectionTester({ fetch: fakeFetch().fetch, externalApis })("mistral", {});

    expect(calls).toEqual([]);
  });

  it("answers even when the call cannot be recorded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tester = createConnectionTester({ fetch: fakeFetch().fetch, externalApis: { record: () => Promise.reject(new Error("insert failed")) } });
      expect(await tester("mistral", { MISTRAL_API_KEY: "mk" })).toEqual({ ok: true });
    } finally {
      warn.mockRestore();
    }
  });
});
