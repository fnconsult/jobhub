import type { UsageEntry } from "@jobhub/ai";
import { toolById, type ExternalApiCall, type Tool } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresExternalApiLog, createPostgresUsageLog, migrateAiUsage } from "../ai-usage";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { toolCalls, toolStatus, toolsOverview } from "./index";

const tool = (id: string): Tool => toolById(id)!;

describe("a Tool's status", () => {
  const nothingEnabled = { env: {}, signInTypes: [] };

  it("is configured when every key it needs has a value, from env or the Provider Secrets", () => {
    expect(toolStatus(tool("france-travail"), { ...nothingEnabled, env: { FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" } })).toEqual({
      status: "configured",
      missingKeys: [],
    });
  });

  it("is a key missing when one is empty or absent, naming it", () => {
    expect(toolStatus(tool("france-travail"), { ...nothingEnabled, env: { FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: " " } })).toEqual({
      status: "key_missing",
      missingKeys: ["FRANCE_TRAVAIL_CLIENT_SECRET"],
    });
    expect(toolStatus(tool("brave"), nothingEnabled)).toEqual({ status: "key_missing", missingKeys: ["BRAVE_SEARCH_API_KEY"] });
  });

  it("needs no key for a public API", () => {
    expect(toolStatus(tool("greenhouse"), nothingEnabled)).toEqual({ status: "no_key_needed", missingKeys: [] });
  });

  it("is, for a sign-in Tool, whether a Sign-in Provider of its type is enabled", () => {
    expect(toolStatus(tool("google"), { env: {}, signInTypes: ["google"] })).toEqual({ status: "configured", missingKeys: [] });
    expect(toolStatus(tool("apple"), { env: {}, signInTypes: ["google"] })).toEqual({ status: "not_configured", missingKeys: [] });
  });
});

describe.skipIf(!connectionString)("the Tools' calls (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  const now = new Date("2026-10-20T10:00:00Z");

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
    task: "coaching",
    provider: "anthropic",
    endpoint: "bedrock eu-west-3",
    model: "claude-opus-5",
    ok: true,
    durationMs: 900,
    costEur: 0.5,
    inputTokens: 1000,
    outputTokens: 100,
    tools: [],
    transcript: { system: "Secret system text", messages: [{ role: "user", content: "Bonjour, je suis Jeanne" }], reply: "Bonjour Jeanne" },
    at: new Date("2026-10-19T08:00:00Z"),
    ...overrides,
  });
  const externalCall = (overrides: Partial<ExternalApiCall>): ExternalApiCall => ({
    provider: "france_travail",
    operation: "GET /partenaire/offresdemploi/v2/offres/search",
    at: new Date("2026-10-19T07:00:00Z"),
    durationMs: 300,
    ok: true,
    httpStatus: 200,
    costEur: 0,
    ...overrides,
  });

  async function seed() {
    const ai = createPostgresUsageLog(database);
    await ai.record(aiCall({}));
    await ai.record(aiCall({ ok: false, costEur: 0, at: new Date("2026-10-19T09:00:00Z") }));
    // A web search tool's fee counts in its call's cost.
    await ai.record(aiCall({ costEur: 0.25, tools: [{ name: "web_search", count: 2, ok: true, durationMs: 400, costEur: 0.02 }], at: new Date("2026-10-18T09:00:00Z") }));
    await ai.record(aiCall({ endpoint: "api.anthropic.com", task: "offer_analysis", costEur: 0.1 }));
    // Older than 30 days: on its Tool's page, not in its figures.
    await ai.record(aiCall({ at: new Date("2026-09-19T09:00:00Z") }));
    const external = createPostgresExternalApiLog(database);
    await external.record(externalCall({}));
    await external.record(externalCall({ ok: false, httpStatus: 429, at: new Date("2026-10-19T07:05:00Z") }));
    await external.record(externalCall({ provider: "lusha", operation: "POST /v2/person", costEur: null }));
  }

  it("adds up each Tool's calls, failures and cost over the last 30 days, Claude per endpoint", async () => {
    await seed();

    const overview = await toolsOverview(database, { env: { AWS_BEARER_TOKEN_BEDROCK: "token" }, signInTypes: [] }, now);
    const row = (id: string) => overview.flatMap((group) => group.rows).find((candidate) => candidate.tool.id === id)!;

    expect(row("anthropic-bedrock").figures).toEqual({ calls: 3, failures: 1, costEur: expect.closeTo(0.77, 9) });
    expect(row("anthropic-bedrock").status).toBe("configured");
    expect(row("anthropic").figures).toEqual({ calls: 1, failures: 0, costEur: expect.closeTo(0.1, 9) });
    expect(row("anthropic").status).toBe("key_missing");
    expect(row("france-travail").figures).toEqual({ calls: 2, failures: 1, costEur: 0 });
    // No call's cost known: not a cost of 0.
    expect(row("lusha").figures).toEqual({ calls: 1, failures: 0, costEur: null });
    expect(row("mistral").figures).toEqual({ calls: 0, failures: 0, costEur: null });
  });

  it("groups the Tools by category, in the catalog's order", async () => {
    const overview = await toolsOverview(database, { env: {}, signInTypes: [] }, now);

    expect(overview.map((group) => group.category)).toEqual(["ai_model", "web_search", "job_discovery", "company_data", "contact_enrichment", "billing", "mail", "sign_in", "geolocation"]);
    expect(overview[0]!.rows.map((row) => row.tool.id)).toEqual(["anthropic", "anthropic-bedrock", "anthropic-vertex", "mistral", "openai"]);
  });

  it("lists a Tool's latest calls, newest first: when, what, its outcome, duration and cost, never what was said", async () => {
    await seed();

    expect(await toolCalls(database, tool("france-travail"))).toEqual([
      { at: new Date("2026-10-19T07:05:00Z"), operation: "GET /partenaire/offresdemploi/v2/offres/search", ok: false, httpStatus: 429, durationMs: 300, costEur: 0 },
      { at: new Date("2026-10-19T07:00:00Z"), operation: "GET /partenaire/offresdemploi/v2/offres/search", ok: true, httpStatus: 200, durationMs: 300, costEur: 0 },
    ]);
    const bedrock = await toolCalls(database, tool("anthropic-bedrock"));
    expect(bedrock.map((call) => [call.at.toISOString(), call.ok])).toEqual([
      ["2026-10-19T09:00:00.000Z", false],
      ["2026-10-19T08:00:00.000Z", true],
      ["2026-10-18T09:00:00.000Z", true],
      ["2026-09-19T09:00:00.000Z", true],
    ]);
    expect(bedrock[2]).toEqual({ at: new Date("2026-10-18T09:00:00Z"), operation: "coaching · claude-opus-5", ok: true, httpStatus: null, durationMs: 900, costEur: expect.closeTo(0.27, 9) });
    expect(JSON.stringify(bedrock)).not.toMatch(/Jeanne|Secret system text/);
  });

  it("lists at most the number of calls asked, and none for a Tool whose calls are not recorded", async () => {
    await seed();

    expect(await toolCalls(database, tool("anthropic-bedrock"), { limit: 2 })).toHaveLength(2);
    expect(await toolCalls(database, { ...tool("stripe"), usage: null })).toEqual([]);
  });
});
