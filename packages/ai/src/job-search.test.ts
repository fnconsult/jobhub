import type { IndustryReference, SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { DataResidencyError } from "./errors";
import type { JobSearchQuery } from "./search-query";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const criteria: SearchCriteria = {
  targetRole: "Directeur Financier",
  locations: ["Lyon"],
  minSalary: 90000,
  contractTypes: ["cdi"],
  remoteWorkOptions: ["hybrid"], sectors: [], subsectors: [], domains: [],
};

/** A layer whose job title step answers `variants`, so its plan issues queries with those titles. */
function searchLayer(variants: { fr?: string[]; en?: string[] } = {}) {
  const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
  const mistral = createFakeProvider({ id: "mistral", reply: JSON.stringify(variants) });
  const ai = createAiLayer({
    providers: [perplexity, mistral],
    routes: { web_search: "perplexity", job_titles: "mistral" },
    usage: createMemoryUsageLog(),
  });
  /** The plan's query with this title and language. */
  const planned = async (title: string, language: "fr" | "en") => {
    const query = (await ai.planJobSearch({ candidateId: "cand-1", criteria })).queries.find((q) => q.title === title && q.language === language);
    if (!query) throw new Error(`No planned query "${title}" (${language})`);
    return query;
  };
  return { ai, perplexity, planned };
}

describe("Job Search query variants", () => {
  it("words a query in English for an English variant, with the variant's job title", async () => {
    const { ai, perplexity, planned } = searchLayer({ en: ["Chief Financial Officer"] });

    await ai.searchWeb({ candidateId: "cand-1", criteria, query: await planned("Chief Financial Officer", "en") });

    expect(perplexity.queries).toEqual([
      'Job offer "Chief Financial Officer" in Lyon, permanent contract, hybrid remote work, salary from €90,000 gross per year',
    ]);
  });

  it("words a French variant like the Search Criteria's own query, with the variant's job title", async () => {
    const { ai, perplexity, planned } = searchLayer({ fr: ["DAF"] });

    await ai.searchWeb({ candidateId: "cand-1", criteria, query: await planned("DAF", "fr") });

    expect(perplexity.queries).toEqual(["Offre d'emploi « DAF » à Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel"]);
  });
});

describe("Search Criteria with several values (ADR-0025)", () => {
  const several: SearchCriteria = { ...criteria, locations: ["Lyon", "Bordeaux"], contractTypes: ["cdi", "freelance"], remoteWorkOptions: ["hybrid", "full_remote"], sectors: [], subsectors: [], domains: [] };

  it("names one location per query, and every contract type and remote-work option wanted in each", async () => {
    const { ai, perplexity } = searchLayer();

    await ai.searchWeb({ candidateId: "cand-1", criteria: several, location: "Bordeaux" });
    await ai.searchWeb({ candidateId: "cand-1", criteria: several });

    expect(perplexity.queries).toEqual([
      "Offre d'emploi « Directeur Financier » à Bordeaux, CDI ou freelance, télétravail partiel ou télétravail complet, salaire à partir de 90 000 € brut annuel",
      "Offre d'emploi « Directeur Financier » à Lyon, CDI ou freelance, télétravail partiel ou télétravail complet, salaire à partir de 90 000 € brut annuel",
    ]);
  });

  it("words several values in English with 'or'", async () => {
    const { ai, perplexity } = searchLayer({ en: ["Chief Financial Officer"] });
    const query = (await ai.planJobSearch({ candidateId: "cand-1", criteria: several })).queries.find((q) => q.language === "en")!;

    await ai.searchWeb({ candidateId: "cand-1", criteria: several, query, location: "Lyon" });

    expect(perplexity.queries).toEqual([
      'Job offer "Chief Financial Officer" in Lyon, permanent contract or freelance, hybrid remote work or fully remote work, salary from €90,000 gross per year',
    ]);
  });

  it("refuses a place that is not one of the Search Criteria's locations", async () => {
    const { ai, perplexity } = searchLayer();

    await expect(ai.searchWeb({ candidateId: "cand-1", criteria: several, location: "Jean Dupont" })).rejects.toThrow(DataResidencyError);
    expect(perplexity.queries).toEqual([]);
  });
});

describe("Sectors in a Job Search query (#236)", () => {
  const industries: IndustryReference = {
    sectors: [
      { code: "C", label: { fr: "Industrie manufacturière", en: "Manufacturing" } },
      { code: "K", label: { fr: "Activités financières et d'assurance", en: "Financial and insurance activities" } },
    ],
    subsectors: [{ code: "29", parent: "C", label: { fr: "Industrie automobile", en: "Manufacture of motor vehicles, trailers and semi-trailers" } }],
    domains: [{ code: "M13", parent: "M", label: { fr: "Direction d'entreprise" } }],
  };
  const inSectors: SearchCriteria = { ...criteria, sectors: ["C", "K"], subsectors: ["29"], domains: ["M13"] };

  it("names the label of each Sector chosen, or of its Subsectors chosen, any of which will do", async () => {
    const { ai, perplexity } = searchLayer();

    await ai.searchWeb({ candidateId: "cand-1", criteria: inSectors, industries });

    expect(perplexity.queries).toEqual([
      "Offre d'emploi « Directeur Financier » à Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel, secteur Industrie automobile ou Activités financières et d'assurance",
    ]);
  });

  it("names them in English in an English query", async () => {
    const { ai, perplexity, planned } = searchLayer({ en: ["Chief Financial Officer"] });

    await ai.searchWeb({ candidateId: "cand-1", criteria: { ...inSectors, subsectors: [], sectors: ["K"] }, industries, query: await planned("Chief Financial Officer", "en") });

    expect(perplexity.queries[0]).toMatch(/, Financial and insurance activities sector$/);
  });

  it("names no Sector without their labels, nor any code", async () => {
    const { ai, perplexity } = searchLayer();

    await ai.searchWeb({ candidateId: "cand-1", criteria: inSectors });

    expect(perplexity.queries).toEqual(["Offre d'emploi « Directeur Financier » à Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel"]);
  });
});

describe("what reaches the web-search provider (ADR-0007)", () => {
  it("refuses a job title that planJobSearch did not issue, so a caller cannot send free text", async () => {
    const { ai, perplexity } = searchLayer();
    const forged = { title: "Jean Dupont 06 12 34 56 78", language: "fr" } as unknown as JobSearchQuery;

    await expect(ai.searchWeb({ candidateId: "cand-1", criteria, query: forged })).rejects.toThrow(DataResidencyError);
    await expect(ai.searchWeb({ candidateId: "cand-1", criteria, query: { ...(await searchLayer().planned("Directeur Financier", "fr")) } })).rejects.toThrow(
      DataResidencyError,
    );
    expect(perplexity.queries).toEqual([]);
  });

  it("refuses a country filter that is not a two-letter country code", async () => {
    const { ai, perplexity } = searchLayer();

    await expect(ai.searchWeb({ candidateId: "cand-1", criteria, filters: { country: "Jean Dupont" } })).rejects.toThrow(DataResidencyError);
    await ai.searchWeb({ candidateId: "cand-1", criteria, filters: { country: "FR" } });

    expect(perplexity.searches.map((search) => search.filters?.country)).toEqual(["FR"]);
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

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] } });

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
    const { ai, perplexity, planned } = searchLayer({ en: ["CFO"] });

    await ai.searchWeb({ candidateId: "cand-1", criteria });
    await ai.searchWeb({ candidateId: "cand-1", criteria, query: await planned("CFO", "en"), page: 2 });

    expect(perplexity.searches.map((search) => search.page)).toEqual([undefined, 2]);
  });
});

describe("a Job Search's queries, as the job-search-queries task Playbook words them (ADR-0026)", () => {
  it("are worded and planned as before with version 1, its built-in text", async () => {
    const mistral = createFakeProvider({ id: "mistral", reply: "{}" });
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "perplexity", residency: "outside_eu" }), mistral], routes: { web_search: "perplexity", job_titles: "mistral" }, usage: createMemoryUsageLog() });

    await ai.planJobSearch({ candidateId: "cand-1", criteria });

    expect(mistral.calls[0]!.system).toBe(
      "Tu aides à chercher des offres d'emploi. On te donne un intitulé de poste. Donne les autres intitulés que les recruteurs " +
        "emploient pour ce même poste : jusqu'à 2 en français et jusqu'à 3 en anglais, les plus courants d'abord, sans changer de niveau ni de métier. " +
        'Réponds uniquement par un objet JSON : {"fr": ["..."], "en": ["..."]}.',
    );
  });

  it("take the served version's instructions and Playbook Agent for the job titles, and its openings for the queries", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const mistral = createFakeProvider({ id: "mistral", reply: JSON.stringify({ en: ["CFO"] }) });
    const claude = createFakeProvider({ id: "anthropic", reply: JSON.stringify({ en: ["CFO"] }) });
    const ai = createAiLayer({ providers: [perplexity, mistral, claude], routes: { web_search: "perplexity", job_titles: "anthropic" }, usage: createMemoryUsageLog() });

    const plan = await ai.planJobSearch({
      candidateId: "cand-1",
      criteria,
      instructions: {
        titles: { text: "Donne des synonymes.", route: { provider: "mistral", model: "mistral-medium-3-5" }, effort: "high" },
        openings: { fr: "Poste de {{intitulé}} près de {{lieu}}", en: "{{intitulé}} job near {{lieu}}" },
      },
    });
    for (const query of plan.queries) await ai.searchWeb({ candidateId: "cand-1", criteria, query });

    expect(claude.calls).toHaveLength(0);
    expect(mistral.calls[0]).toMatchObject({ model: "mistral-medium-3-5", effort: "high" });
    expect(mistral.calls[0]!.system).toMatch(/^Donne des synonymes\. Réponds uniquement par un objet JSON/);
    expect(perplexity.queries).toEqual([
      "Poste de Directeur Financier près de Lyon, CDI, télétravail partiel, salaire à partir de 90 000 € brut annuel",
      "CFO job near Lyon, permanent contract, hybrid remote work, salary from €90,000 gross per year",
    ]);
  });

  it("open with the built-in words when the served opening lacks the job title or the location", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
    const ai = createAiLayer({ providers: [perplexity, createFakeProvider({ id: "mistral", reply: "{}" })], routes: { web_search: "perplexity", job_titles: "mistral" }, usage: createMemoryUsageLog() });

    const plan = await ai.planJobSearch({ candidateId: "cand-1", criteria, instructions: { titles: { text: "Donne des synonymes." }, openings: { fr: "Offres à {{lieu}}", en: "Jobs" } } });
    await ai.searchWeb({ candidateId: "cand-1", criteria, query: plan.queries[0] });

    expect(perplexity.queries[0]).toMatch(/^Offre d'emploi « Directeur Financier » à Lyon, /);
  });
});
