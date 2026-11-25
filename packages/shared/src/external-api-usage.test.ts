import { describe, expect, it } from "vitest";
import { recordingClient, recordingFetch, type ExternalApiCall } from "./external-api-usage";

/** An adapter's fetch: a URL and what to send. */
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

const answering =
  (status: number): Fetch =>
  async () =>
    new Response("{}", { status });

/** Until a refused call is recorded: its body is read first, after the caller got its answer (#1123). */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("an external API's calls, as recorded", () => {
  it("records the provider, the operation (method and path), the HTTP status, how long it took and its cost", async () => {
    const calls: ExternalApiCall[] = [];
    let clock = 0;
    const slow: Fetch = async () => ((clock += 120), new Response("{}", { status: 200 }));
    const fetch = recordingFetch(
      slow,
      { record: (call) => void calls.push(call) },
      {
        provider: "france_travail",
        costEur: () => 0,
        clock: () => clock,
        now: () => new Date("2026-10-18T08:00:00Z"),
      },
    );

    const response = await fetch("https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?motsCles=DAF&commune=69123", {
      method: "GET",
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        provider: "france_travail",
        operation: "GET /partenaire/offresdemploi/v2/offres/search",
        at: new Date("2026-10-18T08:00:00Z"),
        durationMs: 120,
        ok: true,
        httpStatus: 200,
        costEur: 0,
      },
    ]);
  });

  it("records a refused call with its status, and a call that never got an answer without one; the caller still sees each", async () => {
    const calls: ExternalApiCall[] = [];
    const log = { record: (call: ExternalApiCall) => void calls.push(call) };

    await expect(
      recordingFetch(answering(429), log, { provider: "lusha" })("https://api.lusha.com/v2/person", {
        method: "POST",
        headers: {},
        body: '{"name":"Marie Dupont"}',
      }),
    ).resolves.toMatchObject({ status: 429 });
    await settled();
    await expect(
      recordingFetch<Fetch>(async () => Promise.reject(new Error("ECONNRESET")), log, { provider: "lusha" })("https://api.lusha.com/v2/person", {
        method: "POST",
        headers: {},
      }),
    ).rejects.toThrow("ECONNRESET");

    expect(calls).toEqual([
      expect.objectContaining({
        provider: "lusha",
        operation: "POST /v2/person",
        ok: false,
        httpStatus: 429,
        costEur: null,
      }),
      expect.objectContaining({
        provider: "lusha",
        operation: "POST /v2/person",
        ok: false,
        httpStatus: null,
        costEur: null,
      }),
    ]);
  });

  it("records a Tool's refusal for its quota with its Failure Reason and the renewal date it gave (#1114)", async () => {
    const calls: ExternalApiCall[] = [];
    const log = { record: (call: ExternalApiCall) => void calls.push(call) };
    const now = () => new Date("2026-11-24T10:00:00Z");
    const refusing =
      (status: number, headers: Record<string, string> = {}, body: unknown = { error: "out_of_credits" }): Fetch =>
      async () =>
        new Response(JSON.stringify(body), { status, headers });
    const call = async (fetch: Fetch) => {
      await fetch("https://api.example/v2/person", { method: "POST", headers: {} });
      await settled();
    };

    await call(recordingFetch(refusing(402), log, { provider: "lusha", now }));
    await call(recordingFetch(refusing(429, { "retry-after": "60" }, { error: "rate limit exceeded" }), log, { provider: "kaspr", now }));
    await call(recordingFetch(refusing(402, { "x-api-next-billing-date": "2026-12-01T00:00:00Z" }), log, { provider: "fantastic_jobs", now }));
    // Not a quota refusal: no reason, no renewal date.
    await call(recordingFetch(refusing(401, { "retry-after": "60" }, { error: "Unauthorized" }), log, { provider: "apollo", now }));
    await call(recordingFetch(refusing(200), log, { provider: "apollo", now }));
    // A Tool without a quota keeps none: Stripe's 402 is a card declined, a public API's 429 its own business.
    await call(recordingFetch(refusing(402), log, { provider: "stripe", now }));
    await call(recordingFetch(refusing(429, { "retry-after": "60" }), log, { provider: "greenhouse", now }));

    expect(calls.map(({ provider, reason, renewsAt }) => ({ provider, reason, renewsAt }))).toEqual([
      { provider: "lusha", reason: "quota_exhausted", renewsAt: undefined },
      { provider: "kaspr", reason: "rate_limited", renewsAt: new Date("2026-11-24T10:01:00Z") },
      { provider: "fantastic_jobs", reason: "quota_exhausted", renewsAt: new Date("2026-12-01T00:00:00Z") },
      { provider: "apollo", reason: undefined, renewsAt: undefined },
      { provider: "apollo", reason: undefined, renewsAt: undefined },
      { provider: "stripe", reason: undefined, renewsAt: undefined },
      { provider: "greenhouse", reason: undefined, renewsAt: undefined },
    ]);
    expect(calls[0]).not.toHaveProperty("renewsAt");
    expect(calls[3]).not.toHaveProperty("reason");
  });

  it("reads the provider's message of a refused call: Perplexity's 401 « insufficient_quota » is its credit spent, a connection test's too (#1123)", async () => {
    const calls: ExternalApiCall[] = [];
    const log = { record: (call: ExternalApiCall) => void calls.push(call) };
    const body =
      '{"error":{"message":"You exceeded your current quota, add credits at https://console.perplexity.ai/project/billing.","type":"insufficient_quota","code":401}}';
    const perplexity: Fetch = async () => new Response(body, { status: 401, headers: { "content-type": "application/json" } });

    const response = await recordingFetch(perplexity, log, { provider: "perplexity", operation: () => "connection_test" })("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {},
    });

    // The caller still reads the body the provider sent.
    expect(await response.text()).toBe(body);
    await settled();
    expect(calls).toEqual([expect.objectContaining({ provider: "perplexity", operation: "connection_test", ok: false, httpStatus: 401, reason: "quota_exhausted" })]);
  });

  it("keeps a refusal whose message says no quota for what it is, and reads no more of its body than the AI layer does", async () => {
    const calls: ExternalApiCall[] = [];
    const log = { record: (call: ExternalApiCall) => void calls.push(call) };
    const call = async (body: string, status: number) => {
      await recordingFetch<Fetch>(async () => new Response(body, { status }), log, { provider: "perplexity" })("https://api.perplexity.ai/search", { method: "POST", headers: {} });
      await settled();
    };

    await call('{"error":{"message":"Invalid API key","type":"invalid_api_key","code":401}}', 401);
    // Past the 300 characters read: the words come too late to count.
    await call(`${"x".repeat(300)} insufficient_quota`, 401);
    await call('{"error":{"message":"rate limit exceeded"}}', 429);

    expect(calls.map(({ reason }) => reason)).toEqual([undefined, undefined, "rate_limited"]);
  });

  it("records a refused call even when its body cannot be read or never ends, and answers at once", async () => {
    const calls: ExternalApiCall[] = [];
    const log = { record: (call: ExternalApiCall) => void calls.push(call) };
    // An adapter's response without clone, and a body that never ends.
    const bare: Fetch = async () => ({ ok: false, status: 402, headers: new Headers() }) as Response;
    const endless: Fetch = async () => new Response(new ReadableStream({ start: () => {} }), { status: 401 });

    await recordingFetch(bare, log, { provider: "lusha" })("https://api.lusha.com/v2/person", { method: "POST", headers: {} });
    await expect(recordingFetch(endless, log, { provider: "apollo" })("https://api.apollo.io/v1/people", { method: "POST", headers: {} })).resolves.toMatchObject({ status: 401 });
    await settled();
    expect(calls).toEqual([expect.objectContaining({ provider: "lusha", httpStatus: 402, reason: "quota_exhausted" })]);

    // Recorded without its message once it was waited for a second.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(calls).toEqual([
      expect.objectContaining({ provider: "lusha", httpStatus: 402, reason: "quota_exhausted" }),
      expect.objectContaining({ provider: "apollo", httpStatus: 401, ok: false }),
    ]);
    expect(calls[1]).not.toHaveProperty("reason");
  });

  it("never records a payload, a query string or a secret", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingFetch(answering(200), { record: (call) => void calls.push(call) }, { provider: "kaspr" });

    await fetch("https://api.kaspr.io/profile/sk_live_abcdefghijklmnop/linkedin?email=marie@example.com", {
      method: "POST",
      headers: { authorization: "Bearer secret-token-123" },
      body: '{"name":"Marie Dupont"}',
    });

    const recorded = JSON.stringify(calls);
    expect(recorded).not.toMatch(/marie|Dupont|sk_live|secret-token/i);
    expect(calls[0]!.operation).toBe("POST /profile/[redacted]/linkedin");
  });

  it("answers whatever the log does: it throws, rejects or never settles", async () => {
    for (const log of [
      {
        record: () => {
          throw new Error("down");
        },
      },
      { record: () => Promise.reject(new Error("insert failed")) },
      { record: () => new Promise<void>(() => {}) },
    ]) {
      await expect(
        recordingFetch(answering(200), log, {
          provider: "france_travail",
          warn: () => {},
        })("https://api.francetravail.io/x", { method: "GET", headers: {} }),
      ).resolves.toMatchObject({ status: 200 });
    }
  });
});

describe("an external API's calls, recorded whatever happens while recording", () => {
  it("records a path with a malformed escape as it is, and answers", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingFetch(answering(200), { record: (call) => void calls.push(call) }, { provider: "apec" });

    await expect(fetch("https://www.apec.fr/offres/100%zz", { method: "GET", headers: {} })).resolves.toMatchObject({ status: 200 });

    expect(calls[0]!.operation).toBe("GET /offres/100%zz");
  });

  it("answers even when pricing the call throws", async () => {
    const warnings: string[] = [];
    const fetch = recordingFetch(
      answering(200),
      { record: () => {} },
      {
        provider: "lusha",
        costEur: () => {
          throw new Error("no price");
        },
        warn: (message) => void warnings.push(message),
      },
    );

    await expect(fetch("https://api.lusha.com/v2/person", { method: "POST", headers: {} })).resolves.toMatchObject({ status: 200 });
    expect(warnings).toHaveLength(1);
  });

  it("prices a call by its status and operation", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingFetch(
      answering(200),
      { record: (call) => void calls.push(call) },
      { provider: "apollo", costEur: (status, operation) => (status === 200 && operation === "POST /people/match" ? 0.17 : 0) },
    );

    await fetch("https://api.apollo.io/people/match", { method: "POST", headers: {} });
    await fetch("https://api.apollo.io/mixed_people/search", { method: "POST", headers: {} });

    expect(calls.map((call) => call.costEur)).toEqual([0.17, 0]);
  });

  it("prices a call by what its answer's headers say was charged, unknown when no answer came", async () => {
    const calls: ExternalApiCall[] = [];
    const charged: Fetch = async () => new Response("[]", { headers: { "x-api-jobs-this-request": "3" } });
    const costEur = (_status: number | null, _operation: string, response: Response | null) =>
      response?.headers.has("x-api-jobs-this-request") ? Number(response.headers.get("x-api-jobs-this-request")) * 0.01 : null;
    const fetch = recordingFetch(charged, { record: (call) => void calls.push(call) }, { provider: "fantastic_jobs", costEur });
    const failing: Fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const down = recordingFetch(
      failing,
      { record: (call) => void calls.push(call) },
      { provider: "fantastic_jobs", costEur },
    );

    await fetch("https://data.fantastic.jobs/v1/active-ats?title=DAF", { method: "GET", headers: {} });
    await down("https://data.fantastic.jobs/v1/active-ats", { method: "GET", headers: {} }).catch(() => {});

    expect(calls.map((call) => call.costEur)).toEqual([0.03, null]);
  });
});

describe("an external API's calls, named by the caller", () => {
  it("records the operation the caller names instead of the method and path", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingFetch(answering(200), { record: (call) => void calls.push(call) }, { provider: "mistral", operation: () => "connection_test" });

    await fetch("https://api.eu.mistral.ai/v1/models", { method: "GET", headers: {} });

    expect(calls).toEqual([expect.objectContaining({ provider: "mistral", operation: "connection_test", ok: true, httpStatus: 200 })]);
  });

  it("gives the caller the method and URL to name it from, and scrubs what it names", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingFetch(answering(200), { record: (call) => void calls.push(call) }, {
      provider: "job_site",
      operation: (method, url) => `${method} ${url.hostname} sk_live_abcdefghijklmnop`,
    });

    await fetch("https://jobs.example.com/offre/42?email=marie@example.com", { method: "GET", headers: {} });

    expect(calls[0]!.operation).toBe("GET jobs.example.com [redacted]");
  });
});

/** A client shaped like an SDK's: resources holding methods, nested, some synchronous. */
function fakeSdk(clock: { now: number }) {
  return {
    apiKey: "sk_live_abcdefghijklmnop",
    checkout: {
      sessions: {
        prefix: "cs_",
        async create(params: { customer: string }) {
          clock.now += 80;
          return { id: `${this.prefix}1`, customer: params.customer };
        },
      },
    },
    customers: {
      async retrieve(id: string) {
        throw Object.assign(new Error(`No such customer: ${id}`), { statusCode: 404 });
      },
    },
    webhooks: {
      constructEvent(payload: string, signature: string) {
        if (signature !== "good") throw new Error("No signatures found matching the expected signature");
        return { type: "checkout.session.completed", payload };
      },
    },
    list() {
      const promise = Promise.resolve([1, 2]) as Promise<number[]> & { autoPagingToArray(): Promise<number[]> };
      promise.autoPagingToArray = async () => [1, 2, 3];
      return promise;
    },
  };
}

describe("an SDK's calls, as recorded", () => {
  it("records each method called by its path, with its outcome and duration; it answers as the SDK does", async () => {
    const calls: ExternalApiCall[] = [];
    const clock = { now: 0 };
    const sdk = recordingClient(fakeSdk(clock), { record: (call) => void calls.push(call) }, {
      provider: "stripe",
      clock: () => clock.now,
      now: () => new Date("2026-10-20T08:00:00Z"),
    });

    await expect(sdk.checkout.sessions.create({ customer: "cus_123" })).resolves.toEqual({ id: "cs_1", customer: "cus_123" });
    await expect(sdk.customers.retrieve("cus_123")).rejects.toThrow("No such customer");

    expect(calls).toEqual([
      { provider: "stripe", operation: "checkout.sessions.create", at: new Date("2026-10-20T08:00:00Z"), durationMs: 80, ok: true, httpStatus: 200, costEur: null },
      { provider: "stripe", operation: "customers.retrieve", at: new Date("2026-10-20T08:00:00Z"), durationMs: 0, ok: false, httpStatus: 404, costEur: null },
    ]);
  });

  it("records a synchronous method too, and one that fails without a status", () => {
    const calls: ExternalApiCall[] = [];
    const sdk = recordingClient(fakeSdk({ now: 0 }), { record: (call) => void calls.push(call) }, { provider: "stripe" });

    expect(sdk.webhooks.constructEvent("{}", "good")).toEqual({ type: "checkout.session.completed", payload: "{}" });
    expect(() => sdk.webhooks.constructEvent("{}", "forged")).toThrow("No signatures");

    expect(calls.map(({ operation, ok, httpStatus }) => ({ operation, ok, httpStatus }))).toEqual([
      { operation: "webhooks.constructEvent", ok: true, httpStatus: 200 },
      { operation: "webhooks.constructEvent", ok: false, httpStatus: null },
    ]);
  });

  it("gives back what a method returns, its own extra methods included", async () => {
    const sdk = recordingClient(fakeSdk({ now: 0 }), { record: () => {} }, { provider: "stripe" });

    await expect(sdk.list().autoPagingToArray()).resolves.toEqual([1, 2, 3]);
    expect(sdk.apiKey).toBe("sk_live_abcdefghijklmnop");
  });

  it("never records the arguments, the answer or the error's message", async () => {
    const calls: ExternalApiCall[] = [];
    const sdk = recordingClient(fakeSdk({ now: 0 }), { record: (call) => void calls.push(call) }, { provider: "stripe" });

    await sdk.checkout.sessions.create({ customer: "cus_marie" });
    await sdk.customers.retrieve("cus_marie").catch(() => {});

    expect(JSON.stringify(calls)).not.toMatch(/marie|cs_1|No such/);
  });

  it("answers whatever the log does: it throws, rejects or never settles", async () => {
    for (const log of [
      {
        record: () => {
          throw new Error("down");
        },
      },
      { record: () => Promise.reject(new Error("insert failed")) },
      { record: () => new Promise<void>(() => {}) },
    ]) {
      const sdk = recordingClient(fakeSdk({ now: 0 }), log, { provider: "stripe", warn: () => {} });
      await expect(sdk.checkout.sessions.create({ customer: "cus_1" })).resolves.toMatchObject({ id: "cs_1" });
      expect(sdk.webhooks.constructEvent("{}", "good")).toMatchObject({ type: "checkout.session.completed" });
    }
  });
});

describe("a client that does not speak HTTP, as recorded", () => {
  it("records a call that returns as ok without an HTTP status when told so", async () => {
    const calls: ExternalApiCall[] = [];
    const smtp = recordingClient({ async send() {} }, { record: (call) => void calls.push(call) }, { provider: "brevo_smtp", answeredStatus: null });

    await smtp.send();

    expect(calls).toEqual([expect.objectContaining({ provider: "brevo_smtp", operation: "send", ok: true, httpStatus: null })]);
  });
});

describe("what a recorded call is named", () => {
  it("never holds an email address or an id shaped like a Candidate's, whatever the path or the name", async () => {
    const calls: ExternalApiCall[] = [];
    const log = { record: (call: ExternalApiCall) => void calls.push(call) };

    await recordingFetch(answering(200), log, { provider: "kaspr" })("https://api.kaspr.io/people/marie.dupont%40example.fr/3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b", {
      method: "GET",
      headers: {},
    });
    await recordingFetch(answering(200), log, { provider: "job_site", operation: () => "page_read jean@acme.fr" })("https://acme.fr/x", { method: "GET", headers: {} });

    expect(calls.map((call) => call.operation)).toEqual(["GET /people/[email]/[id]", "page_read [email]"]);
  });
});
