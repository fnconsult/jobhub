import { createAiLayer, readOfferFields } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { describe, expect, it } from "vitest";
import { recordedReading } from "./summary-reading";

const CANDIDATE = "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b";
const jobOffer = { id: "offer-1", source: { url: "https://carrieres.groupe-seb.fr/offres/daf-lyon?utm_source=x" }, title: "DAF H/F", content: "Groupe Seb recrute son DAF à Lyon." };

function setUp(reply = '{"summary": "Groupe Seb recrute son DAF à Lyon.", "employer": "Groupe Seb"}') {
  const llm = createFakeProvider({ id: "mistral", reply });
  return createAiLayer({ providers: [llm], routes: { offer_analysis: "mistral" }, euAiConsent: async () => false, warn: () => {}, usage: createMemoryUsageLog() });
}

describe("a Job Offer's text read for its summary, with that reading's Provenance (#329)", () => {
  it("is the fields read, and the model that read them on the site of the offer's page, naming no Candidate", async () => {
    const ai = setUp();

    const reading = await recordedReading(ai, jobOffer, (recording) => readOfferFields(recording, { candidateId: CANDIDATE, jobOffer }));

    expect(reading).toMatchObject({ employer: "Groupe Seb" });
    expect(reading.provenance?.steps).toEqual([
      expect.objectContaining({ kind: "ai", activity: "think_write", task: "offer_analysis", provider: "mistral", model: "fake-mistral", outcome: "ok", count: 1 }),
    ]);
    expect(reading.provenance?.sites).toEqual([{ kind: "web", domain: "carrieres.groupe-seb.fr", links: ["https://carrieres.groupe-seb.fr/offres/daf-lyon"] }]);
    expect(JSON.stringify(reading.provenance)).not.toContain(CANDIDATE);
  });

  it("has no site for an offer captured without its page", async () => {
    const reading = await recordedReading(setUp(), { ...jobOffer, source: {} }, (recording) => readOfferFields(recording, { candidateId: CANDIDATE, jobOffer }));

    expect(reading.provenance?.sites).toEqual([]);
  });

  it("throws what the reading throws", async () => {
    await expect(recordedReading(setUp("pas du JSON"), jobOffer, (recording) => readOfferFields(recording, { candidateId: CANDIDATE, jobOffer }))).rejects.toThrow();
  });
});
