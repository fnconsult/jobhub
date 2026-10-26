/**
 * What every AI call returns besides its answer (#325, ADR-0034): the endpoint that served it, with its region,
 * how long it took and its Outcome, as recorded in AI Usage; and Stop, an AbortSignal threaded to the provider.
 */
import { describe, expect, it, vi } from "vitest";
import { createAiLayer } from "./ai-layer";
import { createFakeProvider, createMemoryUsageLog } from "./testing";
import type { AiProvider, ProviderId } from "./types";

const TEXT_PROVIDERS = ["anthropic", "mistral", "openai"] as const satisfies readonly ProviderId[];
const SEARCH_PROVIDERS = ["perplexity", "brave", "tavily"] as const satisfies readonly ProviderId[];

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

describe("Stop: a call takes an AbortSignal (#325, ADR-0034)", () => {
  const stoppedEntry = { outcome: "failed", reason: "stopped", inputTokens: 0, outputTokens: 0, costEur: 0 };

  it("passes the signal to the provider, and records nothing different while it is not aborted", async () => {
    const mistral = createFakeProvider({ id: "mistral" });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [mistral], routes: { writing: "mistral" }, usage });
    const controller = new AbortController();

    await expect(ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", signal: controller.signal })).resolves.toMatchObject({ outcome: "ok" });

    expect(mistral.calls[0]!.signal).toBe(controller.signal);
    expect(usage.entries[0]).toMatchObject({ outcome: "ok", sent: true });
  });

  it("aborting a text call rejects with the abort error and records it failed, stopped, sent, with no tokens", async () => {
    const clock = { now: 0 };
    const mistral = createFakeProvider({ id: "mistral", pending: true });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [mistral], routes: { writing: "mistral" }, usage, clock: () => clock.now });
    const controller = new AbortController();

    const call = ai.generate({ task: "writing", candidateId: "cand-1", prompt: "Lettre", signal: controller.signal });
    await vi.waitFor(() => expect(mistral.calls).toHaveLength(1));
    clock.now = 900;
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    expect(usage.entries).toEqual([expect.objectContaining({ ...stoppedEntry, provider: "mistral", sent: true, durationMs: 900 })]);
  });

  it("rejects with the reason the signal was aborted with, and still records stopped", async () => {
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", pending: true })], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });
    const controller = new AbortController();
    const reason = new Error("the Candidate left the page");

    const call = ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", signal: controller.signal });
    controller.abort(reason);

    await expect(call).rejects.toBe(reason);
  });

  it("a call stopped before it left is never sent", async () => {
    const mistral = createFakeProvider({ id: "mistral" });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [mistral], routes: { writing: "mistral" }, usage });

    await expect(ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });

    expect(mistral.calls).toHaveLength(0);
    expect(usage.entries).toEqual([expect.objectContaining({ ...stoppedEntry, sent: false, durationMs: 0, tools: [] })]);
  });

  it.each([
    ["searchWeb", (ai: ReturnType<typeof createAiLayer>, signal: AbortSignal) => ai.searchWeb({ candidateId: null, criteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] }, signal })],
    ["searchCompany", (ai: ReturnType<typeof createAiLayer>, signal: AbortSignal) => ai.searchCompany({ candidateId: null, employer: "Acme", signal })],
    ["searchCompanyNews", (ai: ReturnType<typeof createAiLayer>, signal: AbortSignal) => ai.searchCompanyNews({ candidateId: null, employer: "Acme", signal })],
    ["searchCompanyNewsWithCall", (ai: ReturnType<typeof createAiLayer>, signal: AbortSignal) => ai.searchCompanyNewsWithCall({ candidateId: null, employer: "Acme", signal })],
  ])("aborting %s passes the signal to the provider, rejects and records the search stopped", async (_, search) => {
    const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu", pending: true });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [tavily], routes: { web_search: "tavily" }, usage, warn: () => {} });
    const controller = new AbortController();

    const call = search(ai, controller.signal);
    await vi.waitFor(() => expect(tavily.searches).toHaveLength(1));
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    expect(tavily.searches[0]!.signal).toBe(controller.signal);
    expect(usage.entries).toEqual([expect.objectContaining({ ...stoppedEntry, task: "web_search", sent: true })]);
  });

  it("a call without a signal reaches the provider without one", async () => {
    const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu" });
    const mistral = createFakeProvider({ id: "mistral" });
    const ai = createAiLayer({ providers: [tavily, mistral], routes: { web_search: "tavily", writing: "mistral" }, usage: createMemoryUsageLog() });

    await ai.searchCompany({ candidateId: null, employer: "Acme" });
    await ai.generate({ task: "writing", candidateId: null, prompt: "Lettre" });

    expect(tavily.searches[0]).not.toHaveProperty("signal");
    expect(mistral.calls[0]).not.toHaveProperty("signal");
  });
});
