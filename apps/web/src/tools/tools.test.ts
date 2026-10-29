import type { UsageEntry } from "@jobhub/ai";
import { toolById, type ExternalApiCall, type Tool } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresExternalApiLog, createPostgresUsageLog, migrateAiUsage } from "../ai-usage";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { snapshotOfSettings, type StoredPlatformSettings } from "../platform-settings/resolver";
import { latestToolCalls, toolCalls, toolStatus, toolsOverview, type ToolsState } from "./index";

const tool = (id: string): Tool => toolById(id)!;

/** The state a Tool's status is read from: `env` (Provider Secrets over it), the Platform Settings it resolves to with what the Back Office set over it. */
const stateOf = (env: Record<string, string> = {}, options: { stored?: StoredPlatformSettings; signInTypes?: string[] } = {}): ToolsState => ({
  env,
  signInTypes: options.signInTypes ?? [],
  settings: snapshotOfSettings(env, options.stored ?? {}),
});

describe("a Tool's status", () => {
  const nothingEnabled = stateOf();

  it("is configured when every key it needs has a value, from env or the Provider Secrets", () => {
    expect(toolStatus(tool("france-travail"), stateOf({ FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" }))).toMatchObject({
      status: "configured",
      missingKeys: [],
    });
  });

  it("is awaiting access when its provider refused it at its latest connection test, configured as it is (#400)", () => {
    const franceTravail = { FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" };

    expect(toolStatus(tool("france-travail"), { ...stateOf(franceTravail), accessRefused: ["france-travail"] })).toMatchObject({ status: "awaiting_access" });
    // Without its keys, what is missing comes first.
    expect(toolStatus(tool("france-travail"), { ...stateOf(), accessRefused: ["france-travail"] })).toMatchObject({ status: "key_missing" });
  });

  it("is a key missing when one is empty or absent, naming it", () => {
    expect(toolStatus(tool("france-travail"), stateOf({ FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: " " }))).toMatchObject({
      status: "key_missing",
      missingKeys: ["FRANCE_TRAVAIL_CLIENT_SECRET"],
    });
    expect(toolStatus(tool("brave"), nothingEnabled)).toMatchObject({ status: "key_missing", missingKeys: ["BRAVE_SEARCH_API_KEY"] });
  });

  it("needs no key for a public API", () => {
    expect(toolStatus(tool("greenhouse"), nothingEnabled)).toMatchObject({ status: "no_key_needed", missingKeys: [] });
  });

  it("is, for a sign-in Tool, whether a Sign-in Provider of its type is enabled", () => {
    expect(toolStatus(tool("google"), stateOf({}, { signInTypes: ["google"] }))).toMatchObject({ status: "configured", missingKeys: [] });
    expect(toolStatus(tool("apple"), stateOf({}, { signInTypes: ["google"] }))).toMatchObject({ status: "not_configured", missingKeys: [] });
  });

  it("is a setting missing when one the Tool cannot be called without is empty, naming it", () => {
    expect(toolStatus(tool("anthropic-vertex"), stateOf({ ANTHROPIC_ENDPOINT: "vertex" }))).toMatchObject({ status: "setting_missing", missingSettings: ["VERTEX_PROJECT_ID"] });
    expect(toolStatus(tool("anthropic-vertex"), stateOf({ ANTHROPIC_ENDPOINT: "vertex", VERTEX_PROJECT_ID: "jobbbox" }))).toMatchObject({ status: "configured", missingSettings: [] });
  });

  it("is off while a setting turns it off: Enriched Contacts without a signed DPA, another provider chosen, Claude on Vertex on another endpoint, mail to the console", () => {
    const lusha = { LUSHA_API_KEY: "key", CONTACT_ENRICHMENT_PROVIDER: "lusha" };
    expect(toolStatus(tool("lusha"), stateOf(lusha))).toMatchObject({ status: "disabled" });
    expect(toolStatus(tool("lusha"), stateOf({ ...lusha, CONTACT_ENRICHMENT_DPA_SIGNED: "true" }))).toMatchObject({ status: "configured" });
    // Compared as the code reads it: the provider in lower case.
    expect(toolStatus(tool("lusha"), stateOf({ ...lusha, CONTACT_ENRICHMENT_PROVIDER: "Lusha", CONTACT_ENRICHMENT_DPA_SIGNED: "true" }))).toMatchObject({ status: "configured" });
    expect(toolStatus(tool("kaspr"), stateOf({ ...lusha, KASPR_API_KEY: "key", CONTACT_ENRICHMENT_DPA_SIGNED: "true" }))).toMatchObject({ status: "disabled" });
    // Off comes first: a Tool that is not called needs none of its keys nor settings.
    expect(toolStatus(tool("apollo"), nothingEnabled)).toMatchObject({ status: "disabled", missingKeys: ["APOLLO_API_KEY"] });
    expect(toolStatus(tool("anthropic-vertex"), nothingEnabled)).toMatchObject({ status: "disabled", missingSettings: ["VERTEX_PROJECT_ID"] });
    expect(toolStatus(tool("brevo-api"), stateOf({ BREVO_API_KEY: "key", MAIL_TRANSPORT: "console" }))).toMatchObject({ status: "disabled" });
    expect(toolStatus(tool("brevo-api"), stateOf({ BREVO_API_KEY: "key" }))).toMatchObject({ status: "configured" });
  });

  it("names each of the Tool's settings with its value in use and where it comes from", () => {
    const stored = { ANTHROPIC_ENDPOINT: { value: "vertex", updatedBy: "admin@jobbbox.ai", updatedAt: new Date("2026-10-20T10:00:00Z") } };
    expect(toolStatus(tool("anthropic-vertex"), stateOf({ VERTEX_REGION: "europe-west9" }, { stored })).settings).toEqual([
      { name: "ANTHROPIC_ENDPOINT", value: "vertex", source: "back_office", differsFromDefault: false },
      { name: "VERTEX_REGION", value: "europe-west9", source: "env", differsFromDefault: true },
      { name: "VERTEX_PROJECT_ID", value: "", source: "default", differsFromDefault: false },
    ]);
    // A setting only env holds, as Paramètres shows it: from env, with no default to differ from.
    expect(toolStatus(tool("brevo-smtp"), stateOf({ MAIL_TRANSPORT: "console" })).settings).toEqual([
      { name: "MAIL_FROM", value: "Jobbbox <bonjour@localhost>", source: "default", differsFromDefault: false },
      { name: "MAIL_TRANSPORT", value: "console", source: "env", differsFromDefault: false },
    ]);
  });

  it("carries the « env » badge when one of its settings comes from env and differs from its default", () => {
    expect(toolStatus(tool("anthropic-bedrock"), stateOf({ ANTHROPIC_ENDPOINT: "bedrock" })).settingsFromEnv).toEqual(["ANTHROPIC_ENDPOINT"]);
    // Env holding the default, the default itself, or the Back Office's value: no badge.
    expect(toolStatus(tool("anthropic-bedrock"), stateOf({ ANTHROPIC_ENDPOINT: "direct", BEDROCK_REGION: "eu-north-1" })).settingsFromEnv).toEqual([]);
    expect(toolStatus(tool("anthropic-bedrock"), nothingEnabled).settingsFromEnv).toEqual([]);
    const stored = { ANTHROPIC_ENDPOINT: { value: "bedrock", updatedBy: "admin@jobbbox.ai", updatedAt: new Date("2026-10-20T10:00:00Z") } };
    expect(toolStatus(tool("anthropic-bedrock"), stateOf({ ANTHROPIC_ENDPOINT: "direct" }, { stored })).settingsFromEnv).toEqual([]);
    expect(toolStatus(tool("greenhouse"), stateOf({ ANTHROPIC_ENDPOINT: "bedrock" })).settingsFromEnv).toEqual([]);
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
    outcome: "ok",
    sent: true,
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
    await ai.record(aiCall({ outcome: "failed", reason: "provider_unavailable", costEur: 0, at: new Date("2026-10-19T09:00:00Z") }));
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

    const overview = await toolsOverview(database, stateOf({ AWS_BEARER_TOKEN_BEDROCK: "token" }), now);
    const row = (id: string) => overview.flatMap((group) => group.rows).find((candidate) => candidate.tool.id === id)!;

    expect(row("anthropic-bedrock").figures).toEqual({
      calls: 3,
      failures: 1,
      costEur: expect.closeTo(0.77, 9),
      reasons: [{ outcome: "failed", reason: "provider_unavailable", calls: 1 }],
    });
    expect(row("anthropic-bedrock").status).toBe("configured");
    expect(row("anthropic").figures).toEqual({ calls: 1, failures: 0, costEur: expect.closeTo(0.1, 9), reasons: [] });
    expect(row("anthropic").status).toBe("key_missing");
    // An external API's failures have no Failure Reason: only AI Usage keeps codes.
    expect(row("france-travail").figures).toEqual({ calls: 2, failures: 1, costEur: 0, reasons: [] });
    // No call's cost known: not a cost of 0.
    expect(row("lusha").figures).toEqual({ calls: 1, failures: 0, costEur: null, reasons: [] });
    expect(row("mistral").figures).toEqual({ calls: 0, failures: 0, costEur: null, reasons: [] });
  });

  it("shows each Tool's state with its Platform Settings: a setting missing, off, and the « env » badge", async () => {
    const overview = await toolsOverview(database, stateOf({ ANTHROPIC_ENDPOINT: "vertex", LUSHA_API_KEY: "key", CONTACT_ENRICHMENT_PROVIDER: "lusha" }), now);
    const row = (id: string) => overview.flatMap((group) => group.rows).find((candidate) => candidate.tool.id === id)!;

    expect(row("anthropic-vertex")).toMatchObject({ status: "setting_missing", missingSettings: ["VERTEX_PROJECT_ID"], settingsFromEnv: ["ANTHROPIC_ENDPOINT"] });
    expect(row("lusha")).toMatchObject({ status: "disabled", settingsFromEnv: ["CONTACT_ENRICHMENT_PROVIDER"] });
    expect(row("anthropic-bedrock").settingsFromEnv).toEqual(["ANTHROPIC_ENDPOINT"]);
    expect(row("mistral").settingsFromEnv).toEqual([]);
  });

  it("groups the Tools by category, in the catalog's order", async () => {
    const overview = await toolsOverview(database, stateOf(), now);

    expect(overview.map((group) => group.category)).toEqual(["ai_model", "web_search", "job_discovery", "company_data", "contact_enrichment", "billing", "mail", "sign_in", "geolocation", "reference_data"]);
    expect(overview[0]!.rows.map((row) => row.tool.id)).toEqual(["anthropic", "anthropic-bedrock", "anthropic-vertex", "mistral", "openai"]);
  });

  it("lists a Tool's latest calls, newest first: when, what, its outcome, duration and cost, never what was said", async () => {
    await seed();

    expect(await toolCalls(database, tool("france-travail"))).toEqual([
      { at: new Date("2026-10-19T07:05:00Z"), operation: "GET /partenaire/offresdemploi/v2/offres/search", ok: false, outcome: "failed", reason: null, httpStatus: 429, durationMs: 300, costEur: 0 },
      { at: new Date("2026-10-19T07:00:00Z"), operation: "GET /partenaire/offresdemploi/v2/offres/search", ok: true, outcome: "ok", reason: null, httpStatus: 200, durationMs: 300, costEur: 0 },
    ]);
    const bedrock = await toolCalls(database, tool("anthropic-bedrock"));
    expect(bedrock.map((call) => [call.at.toISOString(), call.ok, call.outcome, call.reason])).toEqual([
      ["2026-10-19T09:00:00.000Z", false, "failed", "provider_unavailable"],
      ["2026-10-19T08:00:00.000Z", true, "ok", null],
      ["2026-10-18T09:00:00.000Z", true, "ok", null],
      ["2026-09-19T09:00:00.000Z", true, "ok", null],
    ]);
    expect(bedrock[2]).toEqual({
      at: new Date("2026-10-18T09:00:00Z"),
      operation: "coaching · claude-opus-5",
      ok: true,
      outcome: "ok",
      reason: null,
      httpStatus: null,
      durationMs: 900,
      costEur: expect.closeTo(0.27, 9),
    });
    expect(JSON.stringify(bedrock)).not.toMatch(/Jeanne|Secret system text/);
  });

  it("counts an AI Tool's failed and warned calls of the last 30 days per Failure Reason, and lists each call's code, never its technical reason (#262)", async () => {
    const ai = createPostgresUsageLog(database);
    const technicalReason = { class: "AiProviderError", provider: "mistral", status: 503, message: "upstream down for jeanne@example.fr" };
    const mistralCall = (overrides: Partial<UsageEntry>) => aiCall({ provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-large", ...overrides });
    await ai.record(mistralCall({}));
    await ai.record(mistralCall({ outcome: "failed", reason: "provider_unavailable", technicalReason, costEur: 0 }));
    await ai.record(mistralCall({ outcome: "failed", reason: "provider_unavailable", technicalReason, costEur: 0, task: "scoring" }));
    await ai.record(mistralCall({ outcome: "failed", reason: "rate_limited", technicalReason, costEur: 0 }));
    await ai.record(mistralCall({ outcome: "warning", reason: "other" }));
    // Never sent: no endpoint, still Mistral's.
    await ai.record(mistralCall({ outcome: "failed", reason: "key_missing", endpoint: null, sent: false, costEur: 0, at: new Date("2026-10-19T10:00:00Z") }));
    // Older than 30 days, and another Tool's.
    await ai.record(mistralCall({ outcome: "failed", reason: "rate_limited", at: new Date("2026-09-19T09:00:00Z") }));
    await ai.record(aiCall({ outcome: "failed", reason: "invalid_reply" }));

    const overview = await toolsOverview(database, stateOf(), now);
    const mistral = overview.flatMap((group) => group.rows).find((row) => row.tool.id === "mistral")!;

    expect(mistral.figures?.reasons).toEqual([
      { outcome: "failed", reason: "provider_unavailable", calls: 2 },
      { outcome: "failed", reason: "key_missing", calls: 1 },
      { outcome: "failed", reason: "rate_limited", calls: 1 },
      { outcome: "warning", reason: "other", calls: 1 },
    ]);
    const calls = await toolCalls(database, tool("mistral"));
    expect(calls[0]).toMatchObject({ at: new Date("2026-10-19T10:00:00Z"), ok: false, outcome: "failed", reason: "key_missing" });
    expect(calls.filter((call) => call.outcome === "warning")).toEqual([expect.objectContaining({ ok: true, reason: "other" })]);
    expect(JSON.stringify({ overview, calls })).not.toMatch(/AiProviderError|upstream down|jeanne/);
  });

  it("lists at most the number of calls asked, and none for a Tool whose calls are not recorded", async () => {
    await seed();

    expect(await toolCalls(database, tool("anthropic-bedrock"), { limit: 2 })).toHaveLength(2);
    expect(await toolCalls(database, { ...tool("stripe"), usage: null })).toEqual([]);
  });

  it("lists an AI Tool's key connection tests among its calls, and counts them in its figures", async () => {
    const ai = createPostgresUsageLog(database);
    await ai.record(aiCall({ provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-large", at: new Date("2026-10-19T08:00:00Z") }));
    await createPostgresExternalApiLog(database).record(
      externalCall({ provider: "mistral", operation: "connection_test", ok: false, httpStatus: 401, durationMs: 120, costEur: null, at: new Date("2026-10-19T09:00:00Z") }),
    );

    expect(await toolCalls(database, tool("mistral"))).toEqual([
      { at: new Date("2026-10-19T09:00:00Z"), operation: "connection_test", ok: false, outcome: "failed", reason: null, httpStatus: 401, durationMs: 120, costEur: null },
      { at: new Date("2026-10-19T08:00:00Z"), operation: "coaching · mistral-large", ok: true, outcome: "ok", reason: null, httpStatus: null, durationMs: 900, costEur: 0.5 },
    ]);
    const overview = await toolsOverview(database, stateOf(), now);
    expect(overview.flatMap((group) => group.rows).find((row) => row.tool.id === "mistral")!.figures).toEqual({ calls: 2, failures: 1, costEur: 0.5, reasons: [] });
  });

  it("lists the latest calls to every Tool together, newest first, each with its Tool", async () => {
    await seed();

    const latest = await latestToolCalls(database, { limit: 3 });

    expect(latest.map(({ call }) => call.at.toISOString())).toEqual(["2026-10-19T09:00:00.000Z", "2026-10-19T08:00:00.000Z", "2026-10-19T08:00:00.000Z"]);
    expect(latest[0]).toEqual({ tool: tool("anthropic-bedrock"), call: expect.objectContaining({ operation: "coaching · claude-opus-5", ok: false }) });
    // At the same time, in no particular order.
    expect(latest.slice(1).map(({ tool: called, call }) => `${called.id} ${call.operation}`).sort()).toEqual([
      "anthropic offer_analysis · claude-opus-5",
      "anthropic-bedrock coaching · claude-opus-5",
    ]);
    expect(JSON.stringify(latest)).not.toMatch(/Jeanne|Secret system text/);
  });

  it("lists, among the latest calls, only the failed ones or only the succeeded ones when asked (the Journal's Résultat filter, #263)", async () => {
    await seed();

    const failed = await latestToolCalls(database, { ok: false, limit: 2 });
    const succeeded = await latestToolCalls(database, { ok: true });

    expect(failed.map(({ tool: called, call }) => [called.id, call.at.toISOString(), call.ok])).toEqual([
      ["anthropic-bedrock", "2026-10-19T09:00:00.000Z", false],
      ["france-travail", "2026-10-19T07:05:00.000Z", false],
    ]);
    expect(succeeded.length).toBeGreaterThan(0);
    expect(succeeded.every(({ call }) => call.ok)).toBe(true);
  });

  it("lists, among the latest calls, only those since a time when asked", async () => {
    await seed();

    const latest = await latestToolCalls(database, { since: new Date("2026-10-19T07:01:00Z") });

    expect(latest.map(({ tool: called, call }) => [called.id, call.at.toISOString()])).toEqual([
      ["anthropic-bedrock", "2026-10-19T09:00:00.000Z"],
      expect.anything(),
      expect.anything(),
      ["france-travail", "2026-10-19T07:05:00.000Z"],
    ]);
  });
});
