import type { Provenance } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { jobOfferPage, jobSearchPage, modelsInWords } from "./index";

const read: Provenance = {
  v: 1,
  steps: [
    { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", endpoint: "api.perplexity.ai", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 },
    { kind: "tool", activity: "read", tool: "job-site", ms: 900, at: "2026-10-23T10:00:05.000Z", outcome: "ok", count: 1 },
    { kind: "ai", activity: "read", task: "offer_analysis", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-haiku-4-5", tokens: { input: 6000, output: 700 }, ms: 3900, at: "2026-10-23T10:00:06.000Z", outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }],
  startedAt: "2026-10-23T10:00:00.000Z",
  wallMs: 9100,
};
const OFFER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const jobOffers = (stored: Provenance | null) => ({ provenance: async (id: string) => (id === OFFER ? stored : null) });

describe("the Job Offer page, as AI Activity reads it (#329)", () => {
  it("is the Job Offer, with how it was found, read and summarized", async () => {
    expect(await jobOfferPage(jobOffers(read), OFFER)).toEqual([{ kind: "job_offer", provenance: read }]);
  });

  it("names the models that served it for people", async () => {
    const [offer] = await jobOfferPage(jobOffers(read), OFFER);

    expect(modelsInWords(offer!, createI18n("fr").t)).toEqual(["Perplexity", "Claude Haiku 4.5"]);
  });

  it("shows « modèle non enregistré » for an offer from before Provenance was kept", async () => {
    const [offer] = await jobOfferPage(jobOffers(null), OFFER);

    expect(offer).toEqual({ kind: "job_offer", provenance: null });
    expect(modelsInWords(offer!, createI18n("fr").t)).toEqual(["modèle non enregistré"]);
    expect(modelsInWords(offer!, createI18n("en").t)).toEqual(["model not recorded"]);
  });

  it("carries no internal id to the pane", async () => {
    expect(JSON.stringify(await jobOfferPage(jobOffers(read), OFFER))).not.toContain(OFFER);
  });
});

describe("the Job Search page, as AI Activity reads it (#330)", () => {
  const SEARCH = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const CANDIDATE = "candidate-1";
  const run: Provenance = {
    ...read,
    steps: [{ kind: "ai", activity: "think", task: "job_titles", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-large-latest", tokens: { input: 900, output: 40 }, ms: 1200, at: "2026-10-23T09:59:58.000Z", outcome: "ok", count: 1 }, ...read.steps, { kind: "rules", activity: "compute", rule: "match_score", ms: 2, at: "2026-10-23T10:00:10.000Z", outcome: "ok", count: 1 }],
  };
  const jobSearches = {
    get: async (candidateId: string, id: string) =>
      candidateId === CANDIDATE && id === SEARCH ? { provenance: run, results: [{ jobOffer: { id: OFFER } }, { jobOffer: { id: "8d2e3f40-5b6c-4d7e-9f80-1a2b3c4d5e6f" } }] } : null,
  };

  it("is the Job Search's run, then each Job Offer it found with its own Provenance, best Match Score first", async () => {
    expect(await jobSearchPage(jobSearches, jobOffers(read), CANDIDATE, SEARCH)).toEqual([
      { kind: "job_search", provenance: run },
      { kind: "job_offer", provenance: read },
      { kind: "job_offer", provenance: null },
    ]);
  });

  it("is nothing for a Job Search that is not the Candidate's", async () => {
    expect(await jobSearchPage(jobSearches, jobOffers(read), "candidate-2", SEARCH)).toEqual([]);
  });

  it("carries no internal id to the pane", async () => {
    const page = JSON.stringify(await jobSearchPage(jobSearches, jobOffers(read), CANDIDATE, SEARCH));
    expect(page).not.toContain(SEARCH);
    expect(page).not.toContain(OFFER);
  });
});
