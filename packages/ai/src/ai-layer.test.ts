import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { AiConfigError, createAiLayer, DataResidencyError } from "./ai-layer";
import { pricesFromEnv } from "./cost";
import { AiProviderError } from "./errors";
import { createFakeProvider, createMemoryUsageLog } from "./testing";
import type { AiWarning } from "./types";

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

  describe("an endpoint outside the EU may take any task: the call is redacted instead (ADR-0007 amendment, 2026-10-20)", () => {
    const usOpenAi = () => createFakeProvider({ id: "openai", residency: "outside_eu" });

    it.each(["scoring", "writing", "coaching"] as const)("routes %s to an endpoint outside the EU, without the Candidate's email or phone", async (task) => {
      const openai = usOpenAi();
      const ai = createAiLayer({ providers: [openai], routes: { [task]: "openai" }, usage: createMemoryUsageLog(), warn: () => {} });

      await expect(ai.generate({ task, candidateId: "c", prompt: "CV : marie.dupont@example.fr, 06 12 34 56 78" })).resolves.toMatchObject({ provider: "openai" });
      expect(openai.calls[0]!.messages[0]!.content).toBe("CV : [E-MAIL], [TÉLÉPHONE]");
    });

    it("prefers an EU-resident endpoint for a task with personal data when the provider has one", async () => {
      const direct = { ...createFakeProvider({ id: "anthropic", residency: "outside_eu" }), endpoint: "api.anthropic.com" };
      const bedrock = { ...createFakeProvider({ id: "anthropic" }), endpoint: "bedrock eu-west-3" };
      const usage = createMemoryUsageLog();
      const ai = createAiLayer({ providers: [direct, bedrock], routes: { scoring: "anthropic", offer_analysis: "anthropic" }, usage });

      await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
      await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre" });

      expect(usage.entries.map((entry) => entry.endpoint)).toEqual(["bedrock eu-west-3", "api.anthropic.com"]);
    });

    describe("but reading an offer email (offer_email_reading) runs only on an EU endpoint, whatever EU AI Consent (ADR-0052)", () => {
      it("refuses the call routed outside the EU, before anything is sent, and records why", async () => {
        const openai = usOpenAi();
        const usage = createMemoryUsageLog();
        const ai = createAiLayer({ providers: [openai], routes: { offer_email_reading: "openai" }, usage, warn: () => {} });

        await expect(ai.generate({ task: "offer_email_reading", candidateId: "c", prompt: "Offre : DAF chez Acme, recrutée par Jeanne Martin" })).rejects.toThrow(DataResidencyError);
        expect(openai.calls).toHaveLength(0);
        expect(usage.entries).toEqual([expect.objectContaining({ task: "offer_email_reading", provider: "openai", outcome: "failed", reason: "data_residency", sent: false })]);
      });

      it("refuses a Playbook Agent outside the EU too, and serves a consenting Candidate's call in the EU", async () => {
        const mistral = createFakeProvider({ id: "mistral" });
        const openai = usOpenAi();
        const ai = createAiLayer({ providers: [mistral, openai], routes: { offer_email_reading: "mistral" }, usage: createMemoryUsageLog(), euAiConsent: async () => true, warn: () => {} });

        await expect(ai.generate({ task: "offer_email_reading", candidateId: "c", prompt: "Offre", route: { provider: "openai" } })).rejects.toThrow(DataResidencyError);
        await expect(ai.generate({ task: "offer_email_reading", candidateId: "c", prompt: "Offre", containsIdentity: true })).resolves.toMatchObject({ provider: "mistral" });
        expect(openai.calls).toHaveLength(0);
      });

      it("takes a provider's EU endpoint when it has one", async () => {
        const direct = { ...createFakeProvider({ id: "anthropic", residency: "outside_eu" }), endpoint: "api.anthropic.com" };
        const bedrock = { ...createFakeProvider({ id: "anthropic" }), endpoint: "bedrock eu-west-3" };
        const ai = createAiLayer({ providers: [direct, bedrock], routes: { offer_email_reading: "anthropic" }, usage: createMemoryUsageLog() });

        await expect(ai.generate({ task: "offer_email_reading", candidateId: "c", prompt: "Offre" })).resolves.toMatchObject({ endpoint: "bedrock eu-west-3" });
      });

      it("offers only EU models for its Playbook Agent", () => {
        const mistral = createFakeProvider({ id: "mistral", models: ["mistral-medium-latest"] });
        const openai = { ...usOpenAi(), models: ["gpt-5"] };
        const ai = createAiLayer({ providers: [mistral, openai], routes: { writing: "openai", offer_email_reading: "mistral" }, usage: createMemoryUsageLog() });

        expect(ai.agentModels().map((choice) => choice.provider)).toEqual(["mistral", "openai"]);
        expect(ai.agentModels("offer_email_reading").map((choice) => choice.provider)).toEqual(["mistral"]);
        expect(ai.agentModels("writing").map((choice) => choice.provider)).toEqual(["mistral", "openai"]);
      });
    });

    it("still refuses to route a text task to a web-search provider, which cannot write", () => {
      expect(() => createAiLayer({ providers: [{ ...createFakeProvider({ id: "perplexity", residency: "outside_eu" }), generate: undefined }], routes: { scoring: "perplexity" }, usage: createMemoryUsageLog() })).toThrow(AiConfigError);
    });
  });
});

describe("Eval Runs (#231, ADR-0023)", () => {
  const coachEu = createFakeProvider({ id: "anthropic", residency: "eu", reply: "Coach" });
  const judgeOutsideEu = createFakeProvider({ id: "openai", residency: "outside_eu", reply: "{\"score\": 8}" });
  const setUp = () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [coachEu, judgeOutsideEu], routes: { coaching: "anthropic", eval: "openai" }, usage });
    return { ai, usage };
  };

  it("records every call made for an Eval Run on the eval task, for no Candidate, in AI Usage", async () => {
    const { ai, usage } = setUp();

    await ai.forEval().generate({ task: "coaching", candidateId: "candidate-1", prompt: "Bonjour" });

    expect(usage.entries).toEqual([expect.objectContaining({ task: "eval", candidateId: null, provider: "anthropic" })]);
  });

  it("plays a call on the route of its own task, outside the EU too once configured: every call is redacted (ADR-0007 amendment)", async () => {
    const outsideEu = createFakeProvider({ id: "mistral", residency: "outside_eu" });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [coachEu, outsideEu, judgeOutsideEu], routes: { coaching: "anthropic", eval: "openai" }, usage });

    const played = await ai.forEval().generate({ task: "coaching", candidateId: null, prompt: "Bonjour", route: { provider: "mistral" } });

    expect(played.provider).toBe("mistral");
    expect(outsideEu.calls).toHaveLength(1);
    expect(usage.entries.at(-1)).toMatchObject({ task: "eval", candidateId: null, provider: "mistral" });
  });

  it("lets the AI judge, the eval task's own calls, use an endpoint outside the EU: its cases are fictional", async () => {
    const { ai, usage } = setUp();

    const judged = await ai.forEval().generate({ task: "eval", candidateId: null, prompt: "Note cette réponse" });

    expect(judged).toMatchObject({ provider: "openai", text: '{"score": 8}' });
    expect(usage.entries.at(-1)).toMatchObject({ task: "eval", provider: "openai" });
  });
});

describe("web search", () => {
  const criteria: SearchCriteria = {
    targetRole: "Directeur Financier",
    locations: ["Lyon"],
    minSalary: 90000,
    contractTypes: ["cdi"],
    remoteWorkOptions: ["hybrid"], sectors: [], subsectors: [], domains: [],
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
      criteria: { targetRole: "DAF jean.dupont@mail.fr\nappelez le 06 12 34 56 78", locations: ["Paris +33 6 12 34 56 78"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
    });

    expect(perplexity.queries[0]).toBe("Offre d'emploi « DAF appelez le » à Paris");
  });

  it("says which query texts it sent, as sent: redacted, for the run that recorded them (#404)", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });

    const result = await ai.searchWeb({
      candidateId: "cand-1",
      criteria: { targetRole: "DAF jean.dupont@mail.fr", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
    });

    expect(result.queries).toEqual(["Offre d'emploi « DAF » à Paris"]);
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

  it("words the query as before with version 1 of the company-facts-search task Playbook, else as its served version says (ADR-0026)", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", answer: "{}" });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });

    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme" });
    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme", instructions: "Qui est {{entreprise}} ?\nPays et effectif." });

    expect(perplexity.queries).toEqual([
      "Fiche d'entreprise de « Acme » : pays, adresse du siège, secteur d'activité, effectif, chiffre d'affaires, site web, numéro SIREN si elle est française. " +
        "Réponds uniquement par un objet JSON avec les clés country, headquarters, industry, headcount, revenue, website, siren (texte court, null si inconnu). Ne nomme aucune personne.",
      "Qui est « Acme » ? Pays et effectif. Réponds uniquement par un objet JSON avec les clés country, headquarters, industry, headcount, revenue, website, siren (texte court, null si inconnu). Ne nomme aucune personne.",
    ]);
  });

  it("words the query for pages its Playbook Agent reads as the task Playbook's query alone: no JSON asked of a Search provider (#405)", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", answer: "" });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });

    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme hr@acme.example", forReading: true });
    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme", instructions: "Qui est\n{{entreprise}} ?", forReading: true });
    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme", instructions: "Qui est-ce ?", forReading: true });

    const builtIn = "« Acme » entreprise : siège, secteur d'activité, effectif, chiffre d'affaires, site officiel, SIREN";
    expect(perplexity.queries).toEqual([builtIn, "Qui est « Acme » ?", builtIn]);
  });
});

describe("the usage of every AI call", () => {
  it("records a call that succeeded as such", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { scoring: "mistral" }, usage });

    await ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score this" });

    expect(usage.entries).toEqual([expect.objectContaining({ task: "scoring", provider: "mistral", model: "fake-mistral", outcome: "ok" })]);
  });

  it("records a failed text call, with no tokens, and still fails it", async () => {
    const failing = { ...createFakeProvider({ id: "mistral" }), generate: async () => Promise.reject(new Error("HTTP 503")) };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [failing], routes: { scoring: { provider: "mistral", model: "mistral-small" } }, usage });

    await expect(ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score this" })).rejects.toThrow("HTTP 503");

    expect(usage.entries).toEqual([
      expect.objectContaining({ task: "scoring", provider: "mistral", endpoint: "fake mistral", model: "mistral-small", inputTokens: 0, outputTokens: 0, outcome: "failed" }),
    ]);
  });

  it("records a failed web search, and still fails it", async () => {
    const failing = { ...createFakeProvider({ id: "perplexity", residency: "outside_eu" }), search: async () => Promise.reject(new Error("HTTP 429")) };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [failing], routes: { web_search: "perplexity" }, usage });

    await expect(ai.searchCompany({ candidateId: null, employer: "Acme" })).rejects.toThrow("HTTP 429");

    // No model on the route: the provider's own default, by name.
    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", provider: "perplexity", model: "fake-perplexity", outcome: "failed" })]);
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

    // Perplexity's Search API: $0.001 per search.
    expect(usage.entries[0]!.tools).toEqual([{ name: "web_search", count: 3, ok: true, durationMs: expect.any(Number), costEur: expect.closeTo(3 * 0.001 * 0.86, 6) }]);
  });

  it("records each billed unit at the prices it is given, and returns what it recorded (#403)", async () => {
    const usage = createMemoryUsageLog();
    const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu", models: ["advanced"], usage: { inputTokens: 0, outputTokens: 0 } });
    const prices = pricesFromEnv({ TAVILY_CREDIT_PRICE_USD: "0.005", EUR_PER_USD: "0.9" });
    const ai = createAiLayer({ providers: [tavily], routes: { web_search: { provider: "tavily", model: "advanced" } }, usage, prices });

    const result = await ai.searchCompany({ candidateId: null, employer: "Acme" });

    // An advanced search bills 2 credits, at $0.005 each, €0.9 per $.
    expect(usage.entries[0]!.tools).toEqual([{ name: "web_search", count: 1, ok: true, durationMs: expect.any(Number), costEur: expect.closeTo(2 * 0.005 * 0.9, 9) }]);
    expect(result.costEur).toBeCloseTo(2 * 0.005 * 0.9, 9);
  });

  it("records a failed call with its prompt, no reply and nothing billed", async () => {
    const failing = { ...createFakeProvider({ id: "brave", residency: "outside_eu" }), search: async () => Promise.reject(new Error("HTTP 500")) };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [failing], routes: { web_search: "brave" }, usage });

    await expect(ai.searchCompany({ candidateId: null, employer: "Acme" })).rejects.toThrow();

    expect(usage.entries).toEqual([
      expect.objectContaining({
        outcome: "failed",
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

describe("the Failure Reason of every failed AI call (#259, ADR-0030)", () => {
  it("records a provider's 503 as failed, provider_unavailable, with the provider and status 503 in the technical reason", async () => {
    const usage = createMemoryUsageLog();
    const mistral = createFakeProvider({ id: "mistral", fail: new AiProviderError("mistral", "HTTP 503 Service Unavailable", 503) });
    const ai = createAiLayer({ providers: [mistral], routes: { scoring: "mistral" }, usage });

    await expect(ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score this" })).rejects.toThrow(AiProviderError);

    expect(usage.entries).toEqual([
      expect.objectContaining({
        outcome: "failed",
        reason: "provider_unavailable",
        technicalReason: { class: "AiProviderError", provider: "mistral", status: 503, message: "mistral: HTTP 503 Service Unavailable" },
        sent: true,
        costEur: 0,
        transcript: { messages: [{ role: "user", content: "Score this" }], reply: null },
      }),
    ]);
  });

  it("records a failed web search with its Failure Reason", async () => {
    const usage = createMemoryUsageLog();
    const perplexity = createFakeProvider({ id: "perplexity", fail: new AiProviderError("perplexity", "HTTP 429", 429) });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage });

    await expect(ai.searchCompany({ candidateId: null, employer: "Acme" })).rejects.toThrow("HTTP 429");

    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", outcome: "failed", reason: "rate_limited", sent: true })]);
  });

  it("records a call whose provider's key is missing as failed and not sent, key_missing, at no cost; the caller still gets the AiConfigError", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { coaching: "mistral" }, usage, warn: () => {} });

    // A Playbook Agent's route names a provider whose key was never entered.
    await expect(ai.generate({ task: "coaching", candidateId: "cand-1", system: "Tu es le coach.", prompt: "Écris à marie.dupont@example.fr", route: { provider: "openai", model: "gpt-5" } })).rejects.toThrow(AiConfigError);

    expect(usage.entries).toEqual([
      {
        candidateId: "cand-1",
        task: "coaching",
        provider: "openai",
        endpoint: null,
        model: "gpt-5",
        inputTokens: 0,
        outputTokens: 0,
        outcome: "failed",
        reason: "key_missing",
        technicalReason: { class: "AiConfigError", message: 'AI provider "openai" is not configured' },
        sent: false,
        durationMs: 0,
        costEur: 0,
        tools: [],
        // What would have been sent, redacted.
        transcript: { system: "Tu es le coach.", messages: [{ role: "user", content: "Écris à [E-MAIL]" }], reply: null },
        at: expect.any(Date),
      },
    ]);
  });

  it("records a call stopped inside the provider by a missing key (the identity route without its key) as not sent", async () => {
    const usage = createMemoryUsageLog();
    const standIn = createFakeProvider({ id: "mistral", fail: new AiConfigError("Missing environment variable MISTRAL_API_KEY", { reason: "key_missing" }) });
    const ai = createAiLayer({ providers: [standIn], routes: { scoring: "mistral" }, usage });

    await expect(ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score" })).rejects.toThrow(AiConfigError);

    expect(usage.entries).toEqual([expect.objectContaining({ outcome: "failed", reason: "key_missing", sent: false, costEur: 0, tools: [] })]);
  });

  it("records a task no provider serves as route_missing, not sent, with no provider", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { coaching: "mistral" }, usage });

    await expect(ai.generate({ task: "writing", candidateId: null, prompt: "Une lettre" })).rejects.toThrow(AiConfigError);

    expect(usage.entries).toEqual([expect.objectContaining({ task: "writing", provider: null, endpoint: null, model: null, outcome: "failed", reason: "route_missing", sent: false })]);
  });

  it("records a web search refused by a data residency rule as data_residency, not sent", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "perplexity" })], routes: { web_search: "perplexity" }, usage });

    await expect(ai.searchWeb({ candidateId: null, criteria: { targetRole: "DAF", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [] } as unknown as SearchCriteria, filters: { country: "France" } })).rejects.toThrow(DataResidencyError);

    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", provider: "perplexity", outcome: "failed", reason: "data_residency", sent: false, tools: [] })]);
  });

  it("an Eval Run's web search is recorded as refused too", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "perplexity" })], routes: { web_search: "perplexity" }, usage });

    await expect(ai.forEval().searchCompany({ candidateId: null, employer: "Acme" })).rejects.toThrow(AiConfigError);

    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", candidateId: null, outcome: "failed", reason: "route_missing", sent: false })]);
  });

  it("keeps a technical message holding an API key, an email or more than 500 characters scrubbed, redacted and cut", async () => {
    const usage = createMemoryUsageLog();
    const key = "sk-proj-4f9a1c2b7d8e3f6a5b4c";
    const echo = `HTTP 400 invalid key ${key}; prompt began « Bonjour Marie Dupont, marie.dupont@example.fr » ${"et la suite ".repeat(60)}`;
    const openai = createFakeProvider({ id: "openai", fail: new AiProviderError("openai", echo, 400) });
    const ai = createAiLayer({
      providers: [openai],
      routes: { writing: "openai" },
      usage,
      identityOf: async () => ({ fullName: "Marie Dupont", firstName: "Marie", lastName: "Dupont" }),
      warn: () => {},
    });

    await expect(ai.generate({ task: "writing", candidateId: "cand-1", prompt: "Une lettre" })).rejects.toThrow(AiProviderError);

    const message = usage.entries[0]!.technicalReason!.message;
    expect(usage.entries[0]!.reason).toBe("provider_rejected");
    expect(message).not.toContain(key);
    expect(message).not.toContain("marie.dupont@example.fr");
    expect(message).not.toContain("Dupont");
    expect(message).toContain("[E-MAIL]");
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it("records a call that succeeded as ok, sent, without a Failure Reason", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { scoring: "mistral" }, usage });

    await ai.generate({ task: "scoring", candidateId: "cand-1", prompt: "Score" });

    expect(usage.entries[0]).toMatchObject({ outcome: "ok", sent: true });
    expect(usage.entries[0]).not.toHaveProperty("reason");
    expect(usage.entries[0]).not.toHaveProperty("technicalReason");
  });
});

describe("the warnings of an AI call: its feature ran degraded (#260, ADR-0030)", () => {
  it("records a call made while its feature runs degraded (a Task Playbook fallback) as warning, the first warning its reason, each with what happened", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { cv_parsing: "mistral" }, usage });

    await ai.generate({
      task: "cv_parsing",
      candidateId: "cand-1",
      prompt: "CV",
      warnings: [
        { reason: "task_playbook_fallback", detail: 'task Playbook "cv-reading": no version served' },
        { reason: "task_playbook_agent_not_offered", detail: "openai gpt-5" },
      ],
    });

    expect(usage.entries).toEqual([
      expect.objectContaining({
        outcome: "warning",
        reason: "task_playbook_fallback",
        warnings: [
          { reason: "task_playbook_fallback", detail: 'task Playbook "cv-reading": no version served' },
          { reason: "task_playbook_agent_not_offered", detail: "openai gpt-5" },
        ],
        sent: true,
        inputTokens: 10,
      }),
    ]);
    expect(usage.entries[0]).not.toHaveProperty("technicalReason");
  });

  it("reads them when the call is recorded: a warning added while the call runs is recorded with it", async () => {
    const usage = createMemoryUsageLog();
    const warnings: AiWarning[] = [];
    const reader = createFakeProvider({
      id: "anthropic",
      reply: () => {
        warnings.push({ reason: "match_score_too_slow", detail: "stopped waiting after 20000 ms" });
        return "{}";
      },
    });
    const ai = createAiLayer({ providers: [reader], routes: { offer_analysis: "anthropic" }, usage });

    await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Chef de projet", warnings });

    expect(usage.entries[0]).toMatchObject({ outcome: "warning", reason: "match_score_too_slow", warnings: [{ reason: "match_score_too_slow", detail: "stopped waiting after 20000 ms" }] });
  });

  it("records a call whose Candidate's identity could not be read, redacted by shape alone, as warning identity_unavailable", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "anthropic" })],
      routes: { writing: "anthropic" },
      usage,
      identityOf: async () => Promise.reject(new Error("database down")),
      warn: () => {},
    });

    await ai.generate({ task: "writing", candidateId: "cand-1", prompt: "Marie Dupont, marie.dupont@example.fr" });

    expect(usage.entries).toEqual([
      expect.objectContaining({ outcome: "warning", reason: "identity_unavailable", warnings: [{ reason: "identity_unavailable", detail: "identity lookup failed: database down" }] }),
    ]);
  });

  it("records a call carrying identity it did not declare as warning identity_undeclared, naming the kinds found, never their values", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "anthropic" }), createFakeProvider({ id: "mistral" })],
      routes: { coaching: "anthropic" },
      usage,
      euAiConsent: async () => true,
      warn: () => {},
    });

    await ai.generate({ task: "coaching", candidateId: "cand-1", prompt: "Appelez-moi au 06 12 34 56 78" });

    expect(usage.entries).toEqual([expect.objectContaining({ provider: "mistral", outcome: "warning", reason: "identity_undeclared", warnings: [{ reason: "identity_undeclared", detail: "found: phone" }] })]);
    expect(JSON.stringify(usage.entries[0]!.warnings)).not.toContain("06 12");
  });

  it("records the failed job title variants call with its own reason, and what the Job Search does instead: job_titles_unavailable", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "mistral", fail: new AiProviderError("mistral", "HTTP 503", 503) }), createFakeProvider({ id: "perplexity" })],
      routes: { job_titles: "mistral", web_search: "perplexity" },
      usage,
      warn: () => {},
    });

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria: { targetRole: "DAF", locations: ["Paris"] } as unknown as SearchCriteria });

    expect(plan.call).toBeNull();
    expect(usage.entries).toEqual([expect.objectContaining({ task: "job_titles", outcome: "failed", reason: "provider_unavailable", warnings: [{ reason: "job_titles_unavailable" }] })]);
  });

  it("records a job title variants call never sent (its key missing) with job_titles_unavailable too", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" }), createFakeProvider({ id: "perplexity" })], routes: { job_titles: "mistral", web_search: "perplexity" }, usage, warn: () => {} });

    await ai.planJobSearch({
      candidateId: "cand-1",
      criteria: { targetRole: "DAF", locations: ["Paris"] } as unknown as SearchCriteria,
      instructions: { titles: { text: "Variantes", route: { provider: "openai", model: "gpt-5" } }, openings: { fr: "{{intitulé}} {{lieu}}", en: "{{intitulé}} {{lieu}}" } },
    });

    expect(usage.entries).toEqual([expect.objectContaining({ outcome: "failed", reason: "key_missing", sent: false, warnings: [{ reason: "job_titles_unavailable" }] })]);
  });

  it("records the failed Company News search with its own reason, and company_news_unavailable: the Company Dossier is built without them", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "perplexity", fail: new AiProviderError("perplexity", "HTTP 429", 429) })], routes: { web_search: "perplexity" }, usage, warn: () => {} });

    expect(await ai.searchCompanyNews({ candidateId: "cand-1", employer: "Acme" })).toEqual([]);

    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", outcome: "failed", reason: "rate_limited", warnings: [{ reason: "company_news_unavailable" }] })]);
  });

  it("records a search made while its task Playbook fell back as warning", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "perplexity" })], routes: { web_search: "perplexity" }, usage });

    await ai.searchCompany({ candidateId: null, employer: "Acme", warnings: [{ reason: "task_playbook_search_not_offered", detail: "tavily advanced" }] });

    expect(usage.entries[0]).toMatchObject({ outcome: "warning", reason: "task_playbook_search_not_offered" });
  });

  it("records a call whose reply its feature cannot use as warning, its reason what the feature does instead", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "anthropic", reply: "Je ne peux pas." })], routes: { cv_parsing: "anthropic" }, usage });

    const result = await ai.generate({
      task: "cv_parsing",
      candidateId: "cand-1",
      prompt: "CV",
      fallback: "cv_reading_fallback",
      unusable: (reply) => (reply.startsWith("{") ? null : { reason: "cv_reading_fallback", detail: "the reply is not usable JSON" }),
    });

    expect(result.text).toBe("Je ne peux pas.");
    expect(usage.entries[0]).toMatchObject({ outcome: "warning", reason: "cv_reading_fallback", warnings: [{ reason: "cv_reading_fallback", detail: "the reply is not usable JSON" }] });
  });

  it("keeps a call whose reply its feature can use ok, its fallback unused", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "anthropic", reply: "{}" })], routes: { cv_parsing: "anthropic" }, usage });

    await ai.generate({ task: "cv_parsing", candidateId: "cand-1", prompt: "CV", fallback: "cv_reading_fallback", unusable: () => null });

    expect(usage.entries[0]).toMatchObject({ outcome: "ok" });
    expect(usage.entries[0]).not.toHaveProperty("warnings");
  });

  it("keeps a warning's detail scrubbed of keys, redacted by shape and cut at 500 characters", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "anthropic" })], routes: { writing: "anthropic" }, usage });

    await ai.generate({ task: "writing", candidateId: null, prompt: "Une lettre", warnings: [{ reason: "task_playbook_unreadable", detail: `sk-proj-4f9a1c2b7d8e3f6a5b4c marie@example.fr ${"x".repeat(600)}` }] });

    const detail = usage.entries[0]!.warnings![0]!.detail!;
    expect(detail).not.toContain("sk-proj-4f9a1c2b7d8e3f6a5b4c");
    expect(detail).not.toContain("marie@example.fr");
    expect(detail.length).toBeLessThanOrEqual(500);
  });
});
