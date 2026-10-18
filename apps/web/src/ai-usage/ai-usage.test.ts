import { createAiLayer, type AiLayer, type UsageLog } from "@jobhub/ai";
import { createFakeProvider } from "@jobhub/ai/testing";
import { recordingFetch, type ExternalApiCall } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { aiUsagePeriod, aiUsageReport, createPostgresExternalApiLog, createPostgresUsageLog, knownSecrets, migrateAiUsage, purgeExpiredAiUsage } from "./index";

const MILLION = 1_000_000;

describe("aiUsagePeriod", () => {
  const now = new Date("2026-10-18T10:00:00Z");

  it("reads the last 7, 30 or 90 days up to today (Paris time), per day", () => {
    expect(aiUsagePeriod("7d", now)).toEqual({ key: "7d", from: "2026-10-12", to: "2026-10-19", per: "day" });
    expect(aiUsagePeriod("90d", now)).toMatchObject({ from: "2026-07-21", to: "2026-10-19", per: "day" });
  });

  it("reads one of the last 12 months per day, or all 12 per month", () => {
    expect(aiUsagePeriod("2026-09", now)).toEqual({ key: "2026-09", from: "2026-09-01", to: "2026-10-01", per: "day" });
    expect(aiUsagePeriod("12m", now)).toEqual({ key: "12m", from: "2025-11-01", to: "2026-11-01", per: "month" });
  });

  it("falls back to the last 30 days for anything else, a month out of reach included", () => {
    for (const key of [undefined, "", "1d", "2025-10", "2026-11", "2026-13", "x"]) expect(aiUsagePeriod(key, now).key).toBe("30d");
  });

  it("starts the day at midnight in Paris", () => {
    // 23:30 UTC on the 17th is already the 18th in Paris.
    expect(aiUsagePeriod("7d", new Date("2026-10-17T23:30:00Z")).to).toBe("2026-10-19");
  });
});

describe.skipIf(!connectionString)("AI Usage (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let now: Date;
  let ai: AiLayer;
  /** The fire-and-forget inserts of the calls made, to wait for before reading the report. */
  let pending: Promise<unknown>[];
  const awaited = (log: UsageLog): UsageLog => ({
    record(entry) {
      const recording = Promise.resolve(log.record(entry));
      pending.push(recording);
      return recording;
    },
  });
  const settled = () => Promise.all(pending);

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateAiUsage(database);
    await migrateAiUsage(database); // safe to run twice
    now = new Date("2026-10-18T10:00:00Z");
    pending = [];
    const usage = awaited(createPostgresUsageLog(database));
    ai = createAiLayer({
      providers: [
        createFakeProvider({ id: "anthropic", usage: { inputTokens: MILLION, outputTokens: MILLION / 10 } }),
        createFakeProvider({ id: "mistral", usage: { inputTokens: MILLION, outputTokens: MILLION / 10, cachedInputTokens: 2_000 } }),
        createFakeProvider({ id: "brave", residency: "outside_eu", usage: { inputTokens: 0, outputTokens: 0 } }),
      ],
      routes: { coaching: "anthropic", scoring: { provider: "mistral", model: "mistral-small-latest" }, web_search: "brave" },
      usage,
      now: () => now,
    });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  async function seed() {
    now = new Date("2026-10-18T09:00:00Z");
    await ai.generate({ task: "coaching", candidateId: null, prompt: "Bonjour" });
    now = new Date("2026-10-17T08:00:00Z");
    await ai.generate({ task: "scoring", candidateId: null, prompt: "Score" });
    await ai.searchCompany({ candidateId: null, employer: "Acme" });
    // Paris time: 30 September, 23:30.
    now = new Date("2026-09-30T21:30:00Z");
    await ai.generate({ task: "coaching", candidateId: null, prompt: "Bonsoir" });
    const failing = createAiLayer({
      providers: [{ ...createFakeProvider({ id: "mistral" }), generate: () => Promise.reject(new Error("HTTP 503")) }],
      routes: { scoring: { provider: "mistral", model: "mistral-small-latest" } },
      usage: awaited(createPostgresUsageLog(database)),
      now: () => new Date("2026-10-17T08:30:00Z"),
    });
    await expect(failing.generate({ task: "scoring", candidateId: null, prompt: "Score" })).rejects.toThrow();

    const external = createPostgresExternalApiLog(database);
    const at = () => new Date("2026-10-17T07:00:00Z");
    const recorded = { record: (call: ExternalApiCall) => void pending.push(Promise.resolve(external.record(call))) };
    const answer = (status: number): ((url: string, init: RequestInit) => Promise<Response>) => async () => new Response("{}", { status });
    await recordingFetch(answer(200), recorded, { provider: "france_travail", costEur: () => 0, now: at })("https://api.francetravail.io/offres?q=DAF", {});
    await recordingFetch(answer(429), recorded, { provider: "lusha", now: at })("https://api.lusha.com/v2/person", { method: "POST" });
    await settled();
    now = new Date("2026-10-18T10:00:00Z");
  }

  // Costs by hand, at €0.86 per $: Claude Opus 5 by default ($5 in, $25 out per million tokens),
  // mistral-small ($0.1 in, $0.3 out, cached input at 10%), Brave ($5 per 1,000 searches).
  const claude = (5 + 2.5) * 0.86;
  const mistral = (0.1 + 0.03 + 0.002 * 0.1 * 0.1) * 0.86;
  const braveSearch = 0.005 * 0.86;

  it("adds up the period's calls: how many, failed, tokens and cost, AI calls, their tools and external APIs together", async () => {
    await seed();

    const report = await aiUsageReport(database, aiUsagePeriod("7d", now));

    expect(report.totals).toEqual({
      calls: 4,
      failures: 1,
      inputTokens: 2 * MILLION,
      outputTokens: (2 * MILLION) / 10,
      cachedInputTokens: 2_000,
      callsCostEur: expect.closeTo(claude + mistral + braveSearch, 9),
      toolCalls: 1,
      toolsCostEur: expect.closeTo(braveSearch, 9),
      externalCalls: 2,
      externalFailures: 1,
      externalCostEur: 0,
      costEur: expect.closeTo(claude + mistral + braveSearch, 9),
    });
  });

  it("breaks the calls down by provider and model, by task and per day, newest day first", async () => {
    await seed();

    const report = await aiUsageReport(database, aiUsagePeriod("7d", now));

    const row = (calls: number, failures: number, costEur: number) => ({ calls, failures, costEur: expect.closeTo(costEur, 9) });
    expect(report.byModel).toMatchObject([
      { provider: "mistral", model: "mistral-small-latest", ...row(2, 1, mistral) },
      { provider: "anthropic", model: "fake-anthropic", ...row(1, 0, claude) },
      { provider: "brave", model: "fake-brave", ...row(1, 0, braveSearch) },
    ]);
    expect(report.byTask).toMatchObject([
      { task: "scoring", ...row(2, 1, mistral) },
      { task: "coaching", ...row(1, 0, claude) },
      { task: "web_search", ...row(1, 0, braveSearch) },
    ]);
    expect(report.byTime).toMatchObject([
      { bucket: "2026-10-18", ...row(1, 0, claude) },
      { bucket: "2026-10-17", ...row(3, 1, mistral + braveSearch) },
    ]);
    expect(report.byTime[1]).toMatchObject({ inputTokens: MILLION, outputTokens: MILLION / 10, cachedInputTokens: 2_000 });
  });

  it("lists the tools the models used and the external APIs called, with failures and cost when known", async () => {
    await seed();

    const report = await aiUsageReport(database, aiUsagePeriod("7d", now));

    expect(report.tools).toEqual([{ provider: "brave", name: "web_search", calls: 1, failures: 0, costEur: expect.closeTo(braveSearch, 9) }]);
    expect(report.externalApis).toEqual([
      { provider: "france_travail", operation: "GET /offres", calls: 1, failures: 0, costEur: 0 },
      { provider: "lusha", operation: "POST /v2/person", calls: 1, failures: 1, costEur: null },
    ]);
  });

  it("reads a past month per day, and the last 12 months per month", async () => {
    await seed();

    expect((await aiUsageReport(database, aiUsagePeriod("2026-09", now))).byTime).toEqual([expect.objectContaining({ bucket: "2026-09-30", calls: 1 })]);
    expect((await aiUsageReport(database, aiUsagePeriod("12m", now))).byTime.map(({ bucket, calls }) => [bucket, calls])).toEqual([
      ["2026-10", 4],
      ["2026-09", 1],
    ]);
  });

  it("reports an empty period with zeros", async () => {
    const report = await aiUsageReport(database, aiUsagePeriod("7d", now));

    expect(report.totals).toMatchObject({ calls: 0, failures: 0, costEur: 0, externalCalls: 0 });
    expect(report).toMatchObject({ byModel: [], byTask: [], byTime: [], tools: [], externalApis: [] });
  });

  it("never fails the AI call when its usage cannot be recorded, and says so", async () => {
    const warnings: string[] = [];
    await database.query("DROP TABLE ai_usage CASCADE");
    const usage = createPostgresUsageLog(database, { warn: (message) => warnings.push(message) });

    await expect(usage.record({ ...entry(), at: now })).resolves.toBeUndefined();

    expect(warnings).toEqual([expect.stringMatching(/AI usage not recorded/)]);
  });

  it("purges the usage, tools and external API calls 24 months old", async () => {
    await seed();

    // 24 months before: 17 October 2026, 08:15 UTC. The failed call (08:30) and the next day's stay.
    expect(await purgeExpiredAiUsage(database, new Date("2028-10-17T08:15:00Z"))).toMatchObject({ usage: 3, externalApis: 2 });
    expect((await aiUsageReport(database, aiUsagePeriod("12m", now))).totals).toMatchObject({ calls: 2, failures: 1, toolCalls: 0, externalCalls: 0 });
    expect(await purgeExpiredAiUsage(database, new Date("2028-10-17T08:15:00Z"))).toMatchObject({ usage: 0, externalApis: 0 });
  });
});

function entry() {
  return {
    candidateId: null,
    task: "scoring" as const,
    provider: "mistral" as const,
    endpoint: "fake mistral",
    model: "mistral-small-latest",
    inputTokens: 10,
    outputTokens: 5,
    ok: true,
    durationMs: 12,
    costEur: 0.001,
    tools: [],
    transcript: { messages: [{ role: "user" as const, content: "Score" }], reply: "82" },
  };
}

describe("knownSecrets", () => {
  it("lists the values of every key, token, secret and password the environment holds, and nothing else", () => {
    expect(
      knownSecrets({
        MISTRAL_API_KEY: "mk-1",
        AWS_BEARER_TOKEN_BEDROCK: "tok",
        FRANCE_TRAVAIL_CLIENT_SECRET: "fts",
        SECRETS_MASTER_KEYS: "k1,k2",
        SMTP_PASSWORD: "pw",
        AI_SCORING_MODEL: "mistral-small",
        APP_URL: "https://jobbbox.fr",
        EMPTY_API_KEY: "",
      }).sort(),
    ).toEqual(["fts", "k1,k2", "mk-1", "pw", "tok"]);
  });
});
