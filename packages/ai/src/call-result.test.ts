/**
 * What every AI call returns besides its answer (#325, ADR-0034): the endpoint that served it, with its region,
 * how long it took and its Outcome, as recorded in AI Usage; and Stop, an AbortSignal threaded to the provider.
 */
import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { createFakeProvider, createMemoryUsageLog } from "./testing";
import type { AiProvider, ProviderId } from "./types";

const TEXT_PROVIDERS = ["anthropic", "mistral", "openai"] as const satisfies readonly ProviderId[];
const SEARCH_PROVIDERS = ["perplexity", "brave", "tavily", "linkup"] as const satisfies readonly ProviderId[];

/** A provider whose every call takes `ms` on `clock`. */
function taking(provider: AiProvider, clock: { now: number }, ms: number): AiProvider {
  return {
    ...provider,
    generate: provider.generate && (async (input) => ((clock.now += ms), provider.generate!(input))),
    search: provider.search && (async (query, options) => ((clock.now += ms), provider.search!(query, options))),
  };
}

describe("every result says which endpoint served it, how long it took and its Outcome (#325)", () => {
  it.each(TEXT_PROVIDERS)("a text call to %s", async (id) => {
    const clock = { now: 1_000 };
    const provider = taking({ ...createFakeProvider({ id }), endpoint: `${id} eu-north-1` }, clock, 420);
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [provider], routes: { offer_analysis: id }, usage, clock: () => clock.now });

    const result = await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre" });

    expect(result).toMatchObject({ provider: id, endpoint: `${id} eu-north-1`, durationMs: 420, outcome: "ok" });
    expect(usage.entries[0]).toMatchObject({ endpoint: result.endpoint, durationMs: result.durationMs, outcome: result.outcome });
  });

  it.each(SEARCH_PROVIDERS)("a web search to %s", async (id) => {
    const clock = { now: 0 };
    const provider = taking(createFakeProvider({ id, residency: "outside_eu" }), clock, 1_250);
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [provider], routes: { web_search: id }, usage, clock: () => clock.now });

    const result = await ai.searchCompany({ candidateId: null, employer: "Acme" });

    expect(result).toMatchObject({ provider: id, endpoint: `fake ${id}`, durationMs: 1_250, outcome: "ok" });
    expect(usage.entries[0]).toMatchObject({ endpoint: result.endpoint, durationMs: result.durationMs, outcome: result.outcome });
  });

  it("a call whose feature ran degraded is Outcome warning, as recorded", async () => {
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });

    const result = await ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", warnings: [{ reason: "task_playbook_fallback" }] });

    expect(result.outcome).toBe("warning");
  });
});
