import type { Provenance } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { jobOfferPage, modelsInWords } from "./index";

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
