import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAiLayer, DataResidencyError } from "./ai-layer";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

describe("AI layer", () => {
  it("routes a task to the provider configured for it and logs token usage for the Candidate", async () => {
    const claude = createFakeProvider({ id: "anthropic", reply: "Score: 82" });
    const mistral = createFakeProvider({ id: "mistral", reply: "Chère Madame," });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({
      providers: [claude, mistral],
      routes: { scoring: "anthropic", writing: "mistral" },
      usage,
    });

    const result = await ai.generate({ task: "writing", candidateId: "cand-1", prompt: "Write a Cover Letter" });

    expect(result.text).toBe("Chère Madame,");
    expect(result.provider).toBe("mistral");
    expect(mistral.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
    expect(usage.entries).toEqual([
      expect.objectContaining({ candidateId: "cand-1", task: "writing", provider: "mistral", inputTokens: 10, outputTokens: 5 }),
    ]);
    expect(usage.totalFor("cand-1")).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  describe("personal data only goes to EU-resident endpoints", () => {
    const usOpenAi = createFakeProvider({ id: "openai", residency: "outside_eu" });

    it.each(["scoring", "writing", "coaching"] as const)("refuses to route %s to an endpoint outside the EU", (task) => {
      expect(() => createAiLayer({ providers: [usOpenAi], routes: { [task]: "openai" }, usage: createMemoryUsageLog() })).toThrow(
        DataResidencyError,
      );
    });

    it("allows Job Offer analysis, which carries no personal data, on an endpoint outside the EU", async () => {
      const ai = createAiLayer({ providers: [usOpenAi], routes: { offer_analysis: "openai" }, usage: createMemoryUsageLog() });
      await expect(ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre: DAF H/F" })).resolves.toMatchObject({
        provider: "openai",
      });
    });

    it("never sends a personal-data call outside the EU, even if a provider's residency changes after start-up", async () => {
      const drifting = { ...createFakeProvider({ id: "anthropic" }), residency: "eu" as "eu" | "outside_eu" };
      const ai = createAiLayer({ providers: [drifting], routes: { scoring: "anthropic" }, usage: createMemoryUsageLog() });
      drifting.residency = "outside_eu";
      await expect(ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" })).rejects.toThrow(DataResidencyError);
    });
  });
});

describe("web search", () => {
  const criteria: SearchCriteria = {
    targetRole: "Directeur Financier",
    location: "Lyon",
    minSalary: 90000,
    contractType: "cdi",
    remoteWork: "hybrid",
  };

  it("sends the search provider a query built only from Search Criteria, and logs its usage", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", answer: "3 offres", sources: ["https://example.fr/1"] });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage });

    const leaky = { ...criteria, cv: "Jean Dupont, né le 3 mars 1965" } as SearchCriteria;
    const result = await ai.searchWeb({ candidateId: "cand-1", criteria: leaky });

    expect(result).toMatchObject({ answer: "3 offres", sources: ["https://example.fr/1"], provider: "perplexity" });
    expect(perplexity.queries).toEqual([
      "Offre d'emploi « Directeur Financier » à Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel",
    ]);
    expect(usage.entries).toEqual([expect.objectContaining({ candidateId: "cand-1", task: "web_search", provider: "perplexity" })]);
  });

  it("passes domain and freshness filters to the search provider, with the configured model", async () => {
    const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu" });
    const ai = createAiLayer({ providers: [tavily], routes: { web_search: { provider: "tavily", model: "advanced" } }, usage: createMemoryUsageLog() });
    const filters = { includeDomains: ["apec.fr"], excludeDomains: ["indeed.fr"], maxAgeDays: 30 };

    await ai.searchWeb({ candidateId: "cand-1", criteria, filters });
    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme" });

    expect(tavily.searches.map(({ model, filters }) => ({ model, filters }))).toEqual([
      { model: "advanced", filters },
      { model: "advanced", filters: undefined },
    ]);
  });

  it("strips e-mail addresses and phone numbers typed into the free-text criteria", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });

    await ai.searchWeb({
      candidateId: "cand-1",
      criteria: { targetRole: "DAF jean.dupont@mail.fr\nappelez le 06 12 34 56 78", location: "Paris +33 6 12 34 56 78" },
    });

    expect(perplexity.queries[0]).toBe("Offre d'emploi « DAF appelez le » à Paris");
  });

  it("refuses to use the search-only provider for text tasks", () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const searchOnly = { ...perplexity, generate: undefined };
    expect(() => createAiLayer({ providers: [searchOnly], routes: { offer_analysis: "perplexity" }, usage: createMemoryUsageLog() })).toThrow(
      /cannot generate text/,
    );
  });

  it("refuses to route web search to a provider without search", () => {
    const mistral = { ...createFakeProvider({ id: "mistral" }), search: undefined };
    expect(() => createAiLayer({ providers: [mistral], routes: { web_search: "mistral" }, usage: createMemoryUsageLog() })).toThrow(
      /cannot search the web/,
    );
  });
});

describe("company web search", () => {
  it("sends the search provider a query built only from the employer's name, and logs its usage", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", answer: "{}", sources: ["https://acme.example/about"] });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage });

    const result = await ai.searchCompany({ candidateId: "cand-1", employer: "Acme Robotics GmbH contact: hr@acme.example +49 30 1234 5678" });

    expect(result).toMatchObject({ answer: "{}", sources: ["https://acme.example/about"], provider: "perplexity" });
    expect(perplexity.queries).toHaveLength(1);
    expect(perplexity.queries[0]).toContain("« Acme Robotics GmbH contact: »");
    expect(perplexity.queries[0]).not.toMatch(/hr@|1234/);
    expect(perplexity.queries[0]).toMatch(/ne nomme aucune personne/i);
    expect(perplexity.queries[0]).toMatch(/siren/i);
    expect(usage.entries).toEqual([expect.objectContaining({ candidateId: "cand-1", task: "web_search", provider: "perplexity" })]);
  });
});

describe("the usage of every AI call", () => {
  it("records a call that succeeded as such", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { scoring: "mistral" }, usage });

    await ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score this" });

    expect(usage.entries).toEqual([expect.objectContaining({ task: "scoring", provider: "mistral", model: "fake-mistral", ok: true })]);
  });

  it("records a failed text call, with no tokens, and still fails it", async () => {
    const failing = { ...createFakeProvider({ id: "mistral" }), generate: async () => Promise.reject(new Error("HTTP 503")) };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [failing], routes: { scoring: { provider: "mistral", model: "mistral-small" } }, usage });

    await expect(ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score this" })).rejects.toThrow("HTTP 503");

    expect(usage.entries).toEqual([
      expect.objectContaining({ task: "scoring", provider: "mistral", endpoint: "fake mistral", model: "mistral-small", inputTokens: 0, outputTokens: 0, ok: false }),
    ]);
  });

  it("records a failed web search, and still fails it", async () => {
    const failing = { ...createFakeProvider({ id: "perplexity", residency: "outside_eu" }), search: async () => Promise.reject(new Error("HTTP 429")) };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [failing], routes: { web_search: "perplexity" }, usage });

    await expect(ai.searchCompany({ candidateId: null, employer: "Acme" })).rejects.toThrow("HTTP 429");

    // No model on the route: the provider's own default, by name.
    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", provider: "perplexity", model: "fake-perplexity", ok: false })]);
  });

  it("records how long the call took, its estimated cost and its text: system, messages and reply", async () => {
    let clock = 1_000;
    const usage = createMemoryUsageLog();
    const mistral = createFakeProvider({ id: "mistral", reply: "Bonjour", usage: { inputTokens: 1_000_000, outputTokens: 0 } });
    const slow = { ...mistral, generate: async (input: Parameters<NonNullable<typeof mistral.generate>>[0]) => ((clock += 250), mistral.generate!(input)) };
    const ai = createAiLayer({ providers: [slow], routes: { writing: { provider: "mistral", model: "mistral-small-latest" } }, usage, clock: () => clock });

    await ai.generate({ task: "writing", candidateId: "cand-1", system: "Tu écris.", prompt: "Une lettre" });

    expect(usage.entries).toEqual([
      expect.objectContaining({
        durationMs: 250,
        // 1M input tokens of mistral-small at $0.1, at €0.86 per $.
        costEur: expect.closeTo(0.086, 6),
        tools: [],
        transcript: { system: "Tu écris.", messages: [{ role: "user", content: "Une lettre" }], reply: "Bonjour" },
      }),
    ]);
  });

  it("records a web search as a web_search tool use, priced per search, apart from the tokens", async () => {
    const usage = createMemoryUsageLog();
    const brave = createFakeProvider({ id: "brave", residency: "outside_eu", answer: "", sources: ["https://acme.example"], usage: { inputTokens: 0, outputTokens: 0 } });
    const ai = createAiLayer({ providers: [brave], routes: { web_search: "brave" }, usage });

    await ai.searchCompany({ candidateId: null, employer: "Acme" });

    expect(usage.entries).toEqual([
      expect.objectContaining({
        task: "web_search",
        costEur: 0,
        // Brave: $5 per 1,000 searches.
        tools: [{ name: "web_search", count: 1, ok: true, durationMs: expect.any(Number), costEur: expect.closeTo(0.0043, 6) }],
        transcript: { messages: [{ role: "user", content: brave.queries[0] }], reply: "" },
      }),
    ]);
  });

  it("records whether each tool use succeeded, when the provider says, and leaves unpriced a tool it does not bill apart", async () => {
    const usage = createMemoryUsageLog();
    const perplexity = createFakeProvider({
      id: "perplexity",
      residency: "outside_eu",
      tools: [
        { name: "web_search", count: 1 },
        { name: "fetch_url", count: 2, ok: true },
        { name: "fetch_url", count: 1, ok: false },
      ],
    });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage });

    await ai.searchCompany({ candidateId: null, employer: "Acme" });

    expect(usage.entries[0]!.tools).toEqual([
      expect.objectContaining({ name: "web_search", count: 1, ok: true }),
      { name: "fetch_url", count: 2, ok: true, durationMs: expect.any(Number), costEur: null },
      { name: "fetch_url", count: 1, ok: false, durationMs: expect.any(Number), costEur: null },
    ]);
  });

  it("records the tools a model says it used, each priced when the provider bills it", async () => {
    const usage = createMemoryUsageLog();
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", tools: [{ name: "web_search", count: 3 }] });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage });

    await ai.searchCompany({ candidateId: null, employer: "Acme" });

    // Perplexity: $0.0025 per search.
    expect(usage.entries[0]!.tools).toEqual([{ name: "web_search", count: 3, ok: true, durationMs: expect.any(Number), costEur: expect.closeTo(3 * 0.0025 * 0.86, 6) }]);
  });

  it("records a failed call with its prompt, no reply and nothing billed", async () => {
    const failing = { ...createFakeProvider({ id: "brave", residency: "outside_eu" }), search: async () => Promise.reject(new Error("HTTP 500")) };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [failing], routes: { web_search: "brave" }, usage });

    await expect(ai.searchCompany({ candidateId: null, employer: "Acme" })).rejects.toThrow();

    expect(usage.entries).toEqual([
      expect.objectContaining({
        ok: false,
        costEur: 0,
        tools: [{ name: "web_search", count: 1, ok: false, durationMs: expect.any(Number), costEur: 0 }],
        transcript: { messages: [expect.objectContaining({ role: "user" })], reply: null },
      }),
    ]);
  });

  it("answers whatever the usage log does: it throws, rejects or never settles", async () => {
    const logs = [
      { record: () => { throw new Error("log down"); } },
      { record: () => Promise.reject(new Error("insert failed")) },
      { record: () => new Promise<void>(() => {}) },
    ];
    for (const usage of logs) {
      const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", reply: "ok" })], routes: { scoring: "mistral" }, usage, warn: () => {} });

      await expect(ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score this" })).resolves.toMatchObject({ text: "ok" });
    }
  });
});
