import type { UsageEntry } from "@jobhub/ai";
import { CONNECTION_TEST_OPERATION, toolById, type ExternalApiCall, type Tool } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresExternalApiLog, createPostgresUsageLog, migrateAiUsage } from "../ai-usage";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { cachedToolQuotaStates, LOOKBACK_DAYS, quotaStatesQuery, toolQuotaStates, type ToolQuotaState } from "./index";

const at = (time: string) => new Date(`2026-11-24T${time.length === 5 ? `${time}:00` : time}Z`);
const now = at("12:00");

describe("the Tool quota states, served from a short cache (#1115)", () => {
  const state = (overrides: Partial<ToolQuotaState>): ToolQuotaState => ({ tool: toolById("mistral") as Tool, state: "ok", since: null, renewsAt: null, ...overrides });

  it("reads the database once in its TTL however many pages ask, then again once it is older", async () => {
    let clock = now.getTime();
    const read = vi.fn(async () => [state({})]);
    const states = cachedToolQuotaStates(read, { ttlMs: 30_000, clock: () => new Date(clock) });

    await Promise.all([states(), states()]);
    clock += 29_999;
    await states();
    expect(read).toHaveBeenCalledTimes(1);

    clock += 1;
    await states();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(new Date(clock));
  });

  it("keeps no failed read: the next page reads again", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue([state({})]);
    const states = cachedToolQuotaStates(read, { ttlMs: 30_000, clock: () => now });

    await expect(states()).rejects.toThrow("connection lost");
    await expect(states()).resolves.toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("serves a state as ok once the renewal date its provider gave has passed, cache or not", async () => {
    let clock = at("12:00").getTime();
    const read = async () => [state({ state: "rate_limited", since: at("11:59"), renewsAt: at("12:00:20") })];
    const states = cachedToolQuotaStates(read, { ttlMs: 30_000, clock: () => new Date(clock) });

    expect((await states())[0]).toMatchObject({ state: "rate_limited" });
    clock = at("12:00:20").getTime();
    expect((await states())[0]).toMatchObject({ state: "ok", since: null, renewsAt: null });
  });

  it("reads every time with no TTL", async () => {
    const read = vi.fn(async () => [state({})]);
    const states = cachedToolQuotaStates(read, { ttlMs: 0, clock: () => now });
    await states();
    await states();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(!connectionString)("each Tool's quota state, read from its recorded calls (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateAiUsage(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  const aiCall = (overrides: Partial<UsageEntry>): UsageEntry => ({
    candidateId: null,
    task: "scoring",
    provider: "openai",
    endpoint: "eu.api.openai.com",
    model: "gpt-5.5",
    outcome: "ok",
    sent: true,
    durationMs: 900,
    costEur: 0.01,
    inputTokens: 100,
    outputTokens: 10,
    tools: [],
    transcript: { messages: [{ role: "user", content: "Score this" }], reply: null },
    at: at("08:00"),
    ...overrides,
  });
  const refusedAiCall = (reason: "rate_limited" | "quota_exhausted", overrides: Partial<UsageEntry> = {}) =>
    aiCall({ outcome: "failed", reason, costEur: 0, inputTokens: 0, outputTokens: 0, ...overrides });
  const externalCall = (overrides: Partial<ExternalApiCall>): ExternalApiCall => ({
    provider: "lusha",
    operation: "POST /v2/person",
    at: at("08:00"),
    durationMs: 300,
    ok: true,
    httpStatus: 200,
    costEur: null,
    ...overrides,
  });

  const states = async () => toolQuotaStates(database, now);
  const stateOf = (all: ToolQuotaState[], id: string) => {
    const found = all.find((state) => state.tool.id === id);
    return found && { state: found.state, since: found.since, renewsAt: found.renewsAt };
  };

  it("lists every Tool with a quota, ok without a refusal; never a Tool without a quota", async () => {
    // A public API's 429 is no Tool quota state.
    await createPostgresExternalApiLog(database).record(externalCall({ provider: "france_travail", operation: "GET /v2/offres", ok: false, httpStatus: 429 }));

    const all = await states();

    expect(all.map((state) => state.tool.id)).toEqual(["anthropic", "anthropic-bedrock", "anthropic-vertex", "mistral", "openai", "perplexity", "brave", "tavily", "fantastic-jobs", "lusha", "kaspr", "apollo"]);
    expect(all.every((state) => state.state === "ok" && state.since === null && state.renewsAt === null)).toBe(true);
  });

  it("is quota_exhausted after a single refusal, then ok after an accepted call of that same Tool", async () => {
    const usage = createPostgresUsageLog(database);
    await usage.record(aiCall({ at: at("08:00") }));
    await usage.record(refusedAiCall("quota_exhausted", { at: at("09:00") }));

    expect(stateOf(await states(), "openai")).toEqual({ state: "quota_exhausted", since: at("09:00"), renewsAt: null });

    // Another Tool's accepted call ends nothing.
    await usage.record(aiCall({ provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-large", at: at("10:00") }));
    expect(stateOf(await states(), "openai")).toMatchObject({ state: "quota_exhausted" });

    await usage.record(aiCall({ at: at("11:00") }));
    expect(stateOf(await states(), "openai")).toEqual({ state: "ok", since: null, renewsAt: null });
  });

  it("gives the renewal date the provider gave, and is ok once it has passed", async () => {
    const usage = createPostgresUsageLog(database);
    await usage.record(refusedAiCall("rate_limited", { provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-large", at: at("11:50"), renewsAt: at("12:05") }));
    await usage.record(refusedAiCall("rate_limited", { provider: "brave", endpoint: "api.search.brave.com", model: "web", task: "web_search", at: at("11:00"), renewsAt: at("11:01") }));
    const external = createPostgresExternalApiLog(database);
    await external.record(externalCall({ provider: "fantastic_jobs", operation: "GET /v1/active-ats", ok: false, httpStatus: 402, reason: "quota_exhausted", renewsAt: new Date("2026-12-01T00:00:00Z"), at: at("07:00") }));
    // Its quota guard holding the next search back (ADR-0031): no answer, the same reason and renewal date.
    await external.record(externalCall({ provider: "fantastic_jobs", operation: "GET /v1/active-ats", ok: false, httpStatus: null, durationMs: 0, reason: "quota_exhausted", renewsAt: new Date("2026-12-01T00:00:00Z"), at: at("10:00") }));

    const all = await states();

    expect(stateOf(all, "mistral")).toEqual({ state: "rate_limited", since: at("11:50"), renewsAt: at("12:05") });
    expect(stateOf(all, "brave")).toEqual({ state: "ok", since: null, renewsAt: null });
    expect(stateOf(all, "fantastic-jobs")).toEqual({ state: "quota_exhausted", since: at("07:00"), renewsAt: new Date("2026-12-01T00:00:00Z") });
  });

  it("reads each Claude endpoint as its own Tool, and an AI Tool's other calls as its own", async () => {
    const usage = createPostgresUsageLog(database);
    await usage.record(refusedAiCall("quota_exhausted", { provider: "anthropic", endpoint: "api.anthropic.com", model: "claude-opus-5-5", at: at("09:00") }));
    await usage.record(refusedAiCall("rate_limited", { provider: "anthropic", endpoint: "bedrock eu-west-3", model: "claude-opus-5", at: at("09:00") }));
    await usage.record(aiCall({ provider: "anthropic", endpoint: "vertex europe-west1", model: "claude-opus-5", at: at("10:00") }));
    // Bedrock refused its key's connection test for its rate limit since.
    await createPostgresExternalApiLog(database).record(externalCall({ provider: "anthropic_bedrock", operation: CONNECTION_TEST_OPERATION, ok: false, httpStatus: 429, reason: "rate_limited", at: at("10:00") }));

    const all = await states();

    expect(stateOf(all, "anthropic")).toMatchObject({ state: "quota_exhausted", since: at("09:00") });
    expect(stateOf(all, "anthropic-bedrock")).toMatchObject({ state: "rate_limited", since: at("09:00") });
    expect(stateOf(all, "anthropic-vertex")).toMatchObject({ state: "ok" });
  });

  it("is not ended by a connection test its provider passed: listing its models works with no credit left (#1115)", async () => {
    await createPostgresUsageLog(database).record(refusedAiCall("quota_exhausted", { provider: "anthropic", endpoint: "api.anthropic.com", model: "claude-opus-5-5", at: at("09:00") }));
    // The Test button on Claude's sheet: GET /v1/models, answered 200.
    await createPostgresExternalApiLog(database).record(externalCall({ provider: "anthropic", operation: CONNECTION_TEST_OPERATION, at: at("10:00") }));

    expect(stateOf(await states(), "anthropic")).toEqual({ state: "quota_exhausted", since: at("09:00"), renewsAt: null });
  });

  it("starts again after a renewal date that had passed: since never walks back over it (#1115)", async () => {
    const external = createPostgresExternalApiLog(database);
    // Refused at 08:00 until 09:00; refused again at 10:00, with no accepted call in between: a new state, since 10:00.
    await external.record(externalCall({ provider: "lusha", ok: false, httpStatus: 402, reason: "quota_exhausted", renewsAt: at("09:00"), at: at("08:00") }));
    await external.record(externalCall({ provider: "lusha", ok: false, httpStatus: 402, reason: "quota_exhausted", at: at("10:00") }));
    await external.record(externalCall({ provider: "lusha", ok: false, httpStatus: 402, reason: "quota_exhausted", at: at("11:00") }));
    // Refused at 08:00 until 10:30, again at 10:00 (before it passed) until 13:00: one state, since 08:00.
    await external.record(externalCall({ provider: "kaspr", ok: false, httpStatus: 429, reason: "rate_limited", renewsAt: at("10:30"), at: at("08:00") }));
    await external.record(externalCall({ provider: "kaspr", ok: false, httpStatus: 429, reason: "rate_limited", renewsAt: at("13:00"), at: at("10:00") }));

    const all = await states();

    expect(stateOf(all, "lusha")).toEqual({ state: "quota_exhausted", since: at("10:00"), renewsAt: null });
    expect(stateOf(all, "kaspr")).toEqual({ state: "rate_limited", since: at("08:00"), renewsAt: at("13:00") });
  });

  it("is the latest refusal's, since the first of the same kind that came before it uninterrupted", async () => {
    const external = createPostgresExternalApiLog(database);
    await external.record(externalCall({ provider: "apollo", ok: false, httpStatus: 429, reason: "rate_limited", at: at("08:00") }));
    await external.record(externalCall({ provider: "apollo", ok: false, httpStatus: 402, reason: "quota_exhausted", at: at("09:00") }));
    await external.record(externalCall({ provider: "apollo", ok: false, httpStatus: 402, reason: "quota_exhausted", at: at("10:00") }));

    expect(stateOf(await states(), "apollo")).toEqual({ state: "quota_exhausted", since: at("09:00"), renewsAt: null });
  });

  it(`reads only the last ${LOOKBACK_DAYS} days of calls: an older refusal, with no call since, is no state; since is never older (#1115)`, async () => {
    const external = createPostgresExternalApiLog(database);
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600_000);
    await external.record(externalCall({ provider: "lusha", ok: false, httpStatus: 402, reason: "quota_exhausted", at: daysAgo(LOOKBACK_DAYS + 1) }));
    await external.record(externalCall({ provider: "kaspr", ok: false, httpStatus: 402, reason: "quota_exhausted", at: daysAgo(LOOKBACK_DAYS + 1) }));
    await external.record(externalCall({ provider: "kaspr", ok: false, httpStatus: 402, reason: "quota_exhausted", at: daysAgo(2) }));

    const all = await states();

    expect(stateOf(all, "lusha")).toMatchObject({ state: "ok" });
    expect(stateOf(all, "kaspr")).toEqual({ state: "quota_exhausted", since: daysAgo(2), renewsAt: null });
  });

  it("finds the refusals through the indexes of each provider's refusals and latest calls, never a scan of a whole table (#1115)", async () => {
    const { text, values } = quotaStatesQuery(now);
    const client = await database.connect();
    try {
      // Whatever the tables hold: the plan the query can take, scans of the tables themselves forbidden.
      await client.query("SET enable_seqscan = off");
      const { rows } = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${text}`, values);
      const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).not.toMatch(/Seq Scan on (ai_usage|external_api_usage)/);
      expect(plan).not.toMatch(/Index Scan( Backward)? using (ai_usage|external_api_usage)_at_idx/);
      expect(plan).toMatch(/ai_usage_quota_refusal_idx/);
      expect(plan).toMatch(/external_api_usage_quota_refusal_idx/);
    } finally {
      client.release();
    }
  });

  it("reads a contact enrichment provider's refusals from its external API calls; any other failure is no quota state", async () => {
    const external = createPostgresExternalApiLog(database);
    await external.record(externalCall({ provider: "kaspr", ok: false, httpStatus: 429, reason: "rate_limited", renewsAt: at("12:10"), at: at("11:30") }));
    await external.record(externalCall({ provider: "apollo", ok: false, httpStatus: 500, at: at("11:30") }));
    await createPostgresUsageLog(database).record(aiCall({ outcome: "failed", reason: "provider_unavailable", costEur: 0, at: at("11:00") }));

    const all = await states();

    expect(stateOf(all, "kaspr")).toEqual({ state: "rate_limited", since: at("11:30"), renewsAt: at("12:10") });
    expect(stateOf(all, "apollo")).toMatchObject({ state: "ok" });
    expect(stateOf(all, "openai")).toMatchObject({ state: "ok" });
  });
});
