import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const criteria: SearchCriteria = {
  targetRole: "Directeur Financier",
  location: "Lyon",
  minSalary: 90000,
  contractType: "cdi",
  remoteWork: "hybrid",
};

function searchLayer() {
  const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
  const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });
  return { ai, perplexity };
}

describe("Job Search query variants", () => {
  it("words a query in English for an English variant, with the variant's job title", async () => {
    const { ai, perplexity } = searchLayer();

    await ai.searchWeb({ candidateId: "cand-1", criteria, query: { title: "Chief Financial Officer", language: "en" } });

    expect(perplexity.queries).toEqual([
      'Job offer "Chief Financial Officer" in Lyon, permanent contract, hybrid remote work, salary from €90,000 gross per year',
    ]);
  });

  it("words a French variant like the Search Criteria's own query, with the variant's job title", async () => {
    const { ai, perplexity } = searchLayer();

    await ai.searchWeb({ candidateId: "cand-1", criteria, query: { title: "DAF", language: "fr" } });

    expect(perplexity.queries).toEqual(["Offre d'emploi « DAF » à Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel"]);
  });
});

describe("planning a Job Search", () => {
  function planningLayer(reply: string | (() => string)) {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const mistral = createFakeProvider({ id: "mistral", reply });
    const usage = createMemoryUsageLog();
    const warnings: string[] = [];
    const ai = createAiLayer({
      providers: [perplexity, mistral],
      routes: { web_search: "perplexity", job_titles: "mistral" },
      usage,
      warn: (message) => warnings.push(message),
    });
    return { ai, mistral, usage, warnings };
  }

  it("plans up to 6 queries: the Search Criteria title and up to 2 variants from an AI step, each in French and English", async () => {
    const { ai } = planningLayer(
      JSON.stringify({ fr: ["DAF", "Responsable administratif et financier"], en: ["Chief Financial Officer", "Finance Director", "Head of Finance"] }),
    );

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria });

    expect(plan.queries).toEqual([
      { title: "Directeur Financier", language: "fr" },
      { title: "Chief Financial Officer", language: "en" },
      { title: "DAF", language: "fr" },
      { title: "Finance Director", language: "en" },
      { title: "Responsable administratif et financier", language: "fr" },
      { title: "Head of Finance", language: "en" },
    ]);
  });

  it("gives the AI step the Search Criteria title alone, without the contact details typed into it", async () => {
    const { ai, mistral } = planningLayer("{}");
    const leaky = { ...criteria, targetRole: "DAF jean.dupont@mail.fr 06 12 34 56 78", cv: "Jean Dupont, né le 3 mars 1965" } as SearchCriteria;

    await ai.planJobSearch({ candidateId: "cand-1", criteria: leaky });

    expect(mistral.calls).toHaveLength(1);
    expect(mistral.calls[0]!.messages).toEqual([{ role: "user", content: "DAF" }]);
    expect(mistral.calls[0]!.system).not.toMatch(/Lyon|90|Dupont|CDI|jean/);
  });

  it("strips contact details from the titles the AI step writes, and keeps each title once", async () => {
    const { ai } = planningLayer(
      "```json\n" +
        JSON.stringify({ fr: ["daf", "DAF rh@acme.fr", "Responsable financier +33 6 12 34 56 78", "Contrôleur de gestion", "Trésorier"], en: ["CFO", "", "cfo", 42] }) +
        "\n```",
    );

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria: { targetRole: "DAF", location: "Lyon" } });

    expect(plan.queries).toEqual([
      { title: "DAF", language: "fr" },
      { title: "CFO", language: "en" },
      { title: "Responsable financier", language: "fr" },
      { title: "Contrôleur de gestion", language: "fr" },
    ]);
  });

  it("searches with the Search Criteria title alone, in French and English, when the AI step's reply is unreadable", async () => {
    const { ai } = planningLayer("Désolé, je ne peux pas répondre.");

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria });

    expect(plan.queries).toEqual([
      { title: "Directeur Financier", language: "fr" },
      { title: "Directeur Financier", language: "en" },
    ]);
  });

  it("searches with the Search Criteria title alone when the AI step fails, and warns", async () => {
    const { ai, warnings } = planningLayer(() => {
      throw new Error("Mistral down");
    });

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria });

    expect(plan.queries).toEqual([
      { title: "Directeur Financier", language: "fr" },
      { title: "Directeur Financier", language: "en" },
    ]);
    expect(plan.call).toBeNull();
    expect(warnings).toEqual([expect.stringMatching(/title variants unavailable/i)]);
  });

  it("logs the AI step's usage as the job titles task, and returns its call for its cost", async () => {
    const { ai, usage } = planningLayer("{}");

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria });

    expect(plan.call).toMatchObject({ provider: "mistral", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(usage.entries).toEqual([expect.objectContaining({ candidateId: "cand-1", task: "job_titles", provider: "mistral" })]);
  });
});

describe("paging a Job Search query", () => {
  it("says how many pages of results the web-search provider can give one query", async () => {
    const paging = createFakeProvider({ id: "brave", residency: "outside_eu", pages: 10 });
    const single = createFakeProvider({ id: "tavily", residency: "outside_eu" });
    const plan = (provider: typeof paging) =>
      createAiLayer({ providers: [provider], routes: { web_search: provider.id }, usage: createMemoryUsageLog(), warn: () => {} }).planJobSearch({
        candidateId: "c",
        criteria,
      });

    expect((await plan(paging)).pages).toBe(10);
    expect((await plan(single)).pages).toBe(1);
  });

  it("asks the web-search provider for the page wanted", async () => {
    const { ai, perplexity } = searchLayer();

    await ai.searchWeb({ candidateId: "cand-1", criteria });
    await ai.searchWeb({ candidateId: "cand-1", criteria, query: { title: "CFO", language: "en" }, page: 2 });

    expect(perplexity.searches.map((search) => search.page)).toEqual([undefined, 2]);
  });
});
