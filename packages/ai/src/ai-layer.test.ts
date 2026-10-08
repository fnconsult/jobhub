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
      "Offres d'emploi « Directeur Financier » à Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel",
    ]);
    expect(usage.entries).toEqual([expect.objectContaining({ candidateId: "cand-1", task: "web_search", provider: "perplexity" })]);
  });

  it("strips e-mail addresses and phone numbers typed into the free-text criteria", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });

    await ai.searchWeb({
      candidateId: "cand-1",
      criteria: { targetRole: "DAF jean.dupont@mail.fr\nappelez le 06 12 34 56 78", location: "Paris +33 6 12 34 56 78" },
    });

    expect(perplexity.queries[0]).toBe("Offres d'emploi « DAF appelez le » à Paris");
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
