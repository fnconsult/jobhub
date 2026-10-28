/**
 * The Search provider's fallback (ADR-0043): when the active one fails in a run (key missing, 401/403, 429,
 * an outage), the run switches to the fallback until it ends; without the fallback's key, no switch.
 */
import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAiLayer, createWebSearchRun } from "./ai-layer";
import { createAiLayerFromEnv } from "./env";
import { AiConfigError, AiProviderError } from "./errors";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "./testing";

const criteria: SearchCriteria = {
  targetRole: "Directeur Financier",
  locations: ["Lyon"],
  contractTypes: ["cdi"],
  remoteWorkOptions: [],
  sectors: [],
  subsectors: [],
  domains: [],
};

const failing = (status: number | undefined) => createFakeProvider({ id: "perplexity", residency: "outside_eu", fail: new AiProviderError("perplexity", `HTTP ${status}`, status) });
const brave = () => createFakeProvider({ id: "brave", residency: "outside_eu", sources: ["https://jobs.example/offre"] });

function layer(active: FakeProvider, fallback: FakeProvider | null, searchFallback: "brave" | "perplexity" | null = "brave") {
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({
    providers: [active, ...(fallback ? [fallback] : [])],
    routes: { web_search: active.id },
    ...(searchFallback ? { searchFallback } : {}),
    usage,
    warn: () => {},
  });
  return { ai, usage };
}

describe("the Search provider's fallback", () => {
  it("serves a search after a 429 from the active one, and the rest of the run from the fallback", async () => {
    const active = failing(429);
    const fallback = brave();
    const { ai, usage } = layer(active, fallback);
    const run = createWebSearchRun();

    const first = await ai.searchWeb({ candidateId: "c", criteria, run });
    const second = await ai.searchWeb({ candidateId: "c", criteria, run });

    expect(first).toMatchObject({ provider: "brave", sources: ["https://jobs.example/offre"] });
    expect(second.provider).toBe("brave");
    expect(active.searches).toHaveLength(1);
    expect(fallback.searches).toHaveLength(2);
    expect(run.fallback).toEqual({ from: "perplexity", to: "brave", reason: "rate_limited" });
    expect(usage.entries.map((entry) => [entry.provider, entry.outcome])).toEqual([
      ["perplexity", "failed"],
      ["brave", "ok"],
      ["brave", "ok"],
    ]);
  });

  it.each([
    [401, "provider_rejected"],
    [403, "provider_rejected"],
    [503, "provider_unavailable"],
    [undefined, "provider_unavailable"],
    [432, "provider_rejected"],
  ])("switches on a %s from the active one", async (status, reason) => {
    const run = createWebSearchRun();
    await layer(failing(status), brave()).ai.searchWeb({ candidateId: "c", criteria, run });
    expect(run.fallback).toEqual({ from: "perplexity", to: "brave", reason });
  });

  it("switches when the active one's key is missing", async () => {
    const fallback = brave();
    const { ai } = layer(createFakeProvider({ id: "perplexity", residency: "outside_eu" }), fallback);
    const run = createWebSearchRun();

    // A task Playbook naming a Search provider whose key was never entered.
    const found = await ai.searchWeb({ candidateId: "c", criteria, run, route: { provider: "tavily" } });

    expect(found.provider).toBe("brave");
    expect(run.fallback).toEqual({ from: "tavily", to: "brave", reason: "key_missing" });
  });

  it("does not switch when the fallback's key is missing: the failure stands", async () => {
    const { ai } = layer(failing(429), null);
    const run = createWebSearchRun();

    await expect(ai.searchWeb({ candidateId: "c", criteria, run })).rejects.toMatchObject({ status: 429 });
    expect(run.fallback).toBeNull();
  });

  it("does not switch without a fallback, nor to the active one itself", async () => {
    await expect(layer(failing(429), brave(), null).ai.searchWeb({ candidateId: "c", criteria })).rejects.toBeInstanceOf(AiProviderError);
    await expect(layer(failing(429), null, "perplexity").ai.searchWeb({ candidateId: "c", criteria })).rejects.toBeInstanceOf(AiProviderError);
  });

  it("does not switch on a refusal of the request itself (400, 422)", async () => {
    const run = createWebSearchRun();
    await expect(layer(failing(422), brave()).ai.searchWeb({ candidateId: "c", criteria, run })).rejects.toMatchObject({ status: 422 });
    expect(run.fallback).toBeNull();
  });

  it("does not switch once the search is stopped", async () => {
    const stop = new AbortController();
    const active = createFakeProvider({ id: "perplexity", residency: "outside_eu", pending: true });
    const fallback = brave();
    const run = createWebSearchRun();

    const searching = layer(active, fallback).ai.searchWeb({ candidateId: "c", criteria, run, signal: stop.signal });
    stop.abort();

    await expect(searching).rejects.toBe(stop.signal.reason);
    expect(fallback.searches).toHaveLength(0);
    expect(run.fallback).toBeNull();
  });

  it("serves a single search too (a Company Dossier's), without a run", async () => {
    const found = await layer(failing(503), brave()).ai.searchCompany({ candidateId: null, employer: "Acme" });
    expect(found.provider).toBe("brave");
  });

  it("re-batches the queries for the fallback, as many calls as it takes", async () => {
    const active = createFakeProvider({ id: "perplexity", residency: "outside_eu", queriesPerCall: 5, fail: new AiProviderError("perplexity", "HTTP 429", 429) });
    const fallback = brave();
    const mistral = createFakeProvider({ id: "mistral", reply: JSON.stringify({ en: ["CFO"] }) });
    const ai = createAiLayer({ providers: [active, fallback, mistral], routes: { web_search: "perplexity", job_titles: "mistral" }, searchFallback: "brave", usage: createMemoryUsageLog(), warn: () => {} });
    const plan = await ai.planJobSearch({ candidateId: "c", criteria });

    await ai.searchWeb({ candidateId: "c", criteria, queries: plan.queries, run: createWebSearchRun() });

    expect(active.searches.map((search) => search.queries.length)).toEqual([plan.queries.length]);
    expect(fallback.searches.map((search) => search.queries.length)).toEqual(plan.queries.map(() => 1));
  });

  it("asks a provider for no page past its last: none is searched", async () => {
    const fallback = brave();
    const { ai } = layer(failing(429), fallback);
    const run = createWebSearchRun();

    await ai.searchWeb({ candidateId: "c", criteria, run });
    const second = await ai.searchWeb({ candidateId: "c", criteria, run, page: 2 });

    expect(second.sources).toEqual([]);
    expect(fallback.searches).toHaveLength(1);
  });
});

describe("the fallback as the environment sets it (AI_WEB_SEARCH_FALLBACK_PROVIDER)", () => {
  const keys = { ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "b", PERPLEXITY_API_KEY: "pk" };
  const down = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "api.perplexity.ai") return new Response("busy", { status: 429 });
    return new Response(JSON.stringify({ web: { results: [{ title: "Offre", url: "https://jobs.example/offre" }] } }), { status: 200 });
  }) as typeof globalThis.fetch;

  it("is used once set, its key entered", async () => {
    const ai = createAiLayerFromEnv({ ...keys, BRAVE_SEARCH_API_KEY: "bk", AI_WEB_SEARCH_FALLBACK_PROVIDER: "brave" }, { fetch: down, usage: createMemoryUsageLog() });
    await expect(ai.searchWeb({ candidateId: "c", criteria })).resolves.toMatchObject({ provider: "brave" });
  });

  it("is none by default, and skipped without its key", async () => {
    const byDefault = createAiLayerFromEnv({ ...keys, BRAVE_SEARCH_API_KEY: "bk" }, { fetch: down, usage: createMemoryUsageLog() });
    await expect(byDefault.searchWeb({ candidateId: "c", criteria })).rejects.toMatchObject({ status: 429 });
    const withoutKey = createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_FALLBACK_PROVIDER: "brave" }, { fetch: down, usage: createMemoryUsageLog() });
    await expect(withoutKey.searchWeb({ candidateId: "c", criteria })).rejects.toMatchObject({ status: 429 });
  });

  it("is refused when set to the active Search provider, or to a provider that does not search", () => {
    expect(() => createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_FALLBACK_PROVIDER: "perplexity" }, { usage: createMemoryUsageLog() })).toThrow(AiConfigError);
    expect(() => createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_FALLBACK_PROVIDER: "mistral" }, { usage: createMemoryUsageLog() })).toThrow(AiConfigError);
  });

  it("is refused when set to the active Search provider", async () => {
    const braveDown = (async () => new Response("busy", { status: 429 })) as typeof globalThis.fetch;
    const env = { ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "b", BRAVE_SEARCH_API_KEY: "bk", AI_WEB_SEARCH_PROVIDER: "brave" };
    const ai = createAiLayerFromEnv(env, { fetch: braveDown, usage: createMemoryUsageLog() });
    await expect(ai.searchWeb({ candidateId: "c", criteria })).rejects.toMatchObject({ status: 429 });
    expect(() => createAiLayerFromEnv({ ...env, AI_WEB_SEARCH_FALLBACK_PROVIDER: "brave" }, { usage: createMemoryUsageLog() })).toThrow(/must not be the active/);
  });
});
