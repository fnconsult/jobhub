import type { UsageEntry } from "@jobhub/ai";
import type { ExternalApiCall } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresExternalApiLog, createPostgresUsageLog, migrateAiUsage } from "../ai-usage";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { quotaStateOf, toolQuotaStates, type ToolQuotaState } from "./index";

const at = (time: string) => new Date(`2026-11-24T${time}:00Z`);
const now = at("12:00");

describe("a Tool quota state, from its refusals since its latest accepted call (#1114)", () => {
  it("is ok with none", () => {
    expect(quotaStateOf([], now)).toEqual({ state: "ok", since: null, renewsAt: null });
  });

  it("is quota_exhausted from the first refusal, with the renewal date the provider gave", () => {
    expect(quotaStateOf([{ at: at("09:00"), reason: "quota_exhausted", renewsAt: new Date("2026-12-01T00:00:00Z") }], now)).toEqual({
      state: "quota_exhausted",
      since: at("09:00"),
      renewsAt: new Date("2026-12-01T00:00:00Z"),
    });
  });

  it("is the latest refusal's, since the first of the same kind that came before it uninterrupted", () => {
    const refusals = [
      { at: at("08:00"), reason: "rate_limited" as const, renewsAt: null },
      { at: at("09:00"), reason: "quota_exhausted" as const, renewsAt: null },
      { at: at("10:00"), reason: "quota_exhausted" as const, renewsAt: null },
    ];
    expect(quotaStateOf(refusals, now)).toEqual({ state: "quota_exhausted", since: at("09:00"), renewsAt: null });
  });

  it("ends at the renewal date the provider gave, without waiting for a call", () => {
    expect(quotaStateOf([{ at: at("11:00"), reason: "rate_limited", renewsAt: at("11:30") }], now)).toEqual({ state: "ok", since: null, renewsAt: null });
    expect(quotaStateOf([{ at: at("11:00"), reason: "rate_limited", renewsAt: at("12:30") }], now)).toEqual({ state: "rate_limited", since: at("11:00"), renewsAt: at("12:30") });
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

  it("reads each Claude endpoint as its own Tool, and an AI Tool's other calls (its key's connection test) as its own", async () => {
    const usage = createPostgresUsageLog(database);
    await usage.record(refusedAiCall("quota_exhausted", { provider: "anthropic", endpoint: "api.anthropic.com", model: "claude-opus-5-5", at: at("09:00") }));
    await usage.record(refusedAiCall("rate_limited", { provider: "anthropic", endpoint: "bedrock eu-west-3", model: "claude-opus-5", at: at("09:00") }));
    // Bedrock's key tested and accepted since.
    await createPostgresExternalApiLog(database).record(externalCall({ provider: "anthropic_bedrock", operation: "connection test", at: at("10:00") }));

    const all = await states();

    expect(stateOf(all, "anthropic")).toMatchObject({ state: "quota_exhausted", since: at("09:00") });
    expect(stateOf(all, "anthropic-bedrock")).toMatchObject({ state: "ok" });
    expect(stateOf(all, "anthropic-vertex")).toMatchObject({ state: "ok" });
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
