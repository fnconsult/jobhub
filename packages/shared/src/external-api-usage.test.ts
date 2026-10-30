import { describe, expect, it } from "vitest";
import { recordingClient, recordingFetch, type ExternalApiCall } from "./external-api-usage";

/** An adapter's fetch: a URL and what to send. */
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

const answering =
  (status: number): Fetch =>
  async () =>
    new Response("{}", { status });

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
