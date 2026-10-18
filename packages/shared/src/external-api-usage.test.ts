import { describe, expect, it } from "vitest";
import { recordingFetch, type ExternalApiCall } from "./external-api-usage";

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
});
