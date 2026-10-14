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
