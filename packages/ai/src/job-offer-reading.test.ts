import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { readJobPage, readOfferFields } from "./job-offer-reading";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

function setUp(reply: string) {
  const claude = createFakeProvider({ id: "anthropic", reply });
  const mistral = createFakeProvider({ id: "mistral", reply });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({
    providers: [claude, mistral],
    routes: { offer_analysis: "anthropic" },
    euAiConsent: async () => true,
    warn: () => {},
    usage,
  });
  return { ai, claude, mistral, usage };
}

describe("reading a Job Offer's fields from its text (#94)", () => {
  const jobOffer = { title: "Chef de projet SI H/F", content: "Type de contrat : CDI. Ville : Saint-Ouen. 10 ans d'expérience. Pilotage, SQL." };

  it("sends the title and text alone as the offer_analysis task, and keeps only well-formed fields", async () => {
    const { ai, claude, usage } = setUp(
      '```json\n{"employer": "Région Île-de-France", "location": "Saint-Ouen", "contractType": "cdi", "remoteWork": "weekly", "salaryMin": 52000.4, "skills": ["Pilotage", "", 3, "SQL"], "requiredExperienceYears": 10}\n```',
    );

    const fields = await readOfferFields(ai, { candidateId: "cand-1", jobOffer });

    expect(fields).toEqual({
      employer: "Région Île-de-France",
      location: "Saint-Ouen",
      salary: { min: 52000 },
      skills: ["Pilotage", "SQL"],
      requiredExperienceYears: 10,
      contractType: "cdi",
    });
    expect(claude.calls).toHaveLength(1);
    expect(claude.calls[0]!.messages).toEqual([{ role: "user", content: `${jobOffer.title}\n\n${jobOffer.content}` }]);
    expect(claude.calls[0]!.maxTokens).toBeLessThanOrEqual(1024);
    expect(usage.entries).toMatchObject([{ task: "offer_analysis", candidateId: "cand-1" }]);
  });

  it("stays on the task's provider for a consenting Candidate: an offer's text carries no identity", async () => {
    const { ai, claude, mistral } = setUp("{}");

    expect(await readOfferFields(ai, { candidateId: "cand-1", jobOffer })).toEqual({});
    expect(claude.calls).toHaveLength(1);
    expect(mistral.calls).toHaveLength(0);
  });

  it("throws when the reply is not a JSON object, so the caller can tell a failed read from an offer stating nothing", async () => {
    const { ai } = setUp("Je ne peux pas lire cette offre.");

    await expect(readOfferFields(ai, { candidateId: null, jobOffer })).rejects.toThrow();
  });
});

describe("the Job Offer Summary, read with the fields", () => {
  const jobOffer = { title: "Finance Director", content: "Acme is hiring a Finance Director to lead a team of 12 in London." };

  it("asks for two or three sentences in the offer's own language, inventing nothing and naming no one", async () => {
    const { ai, claude } = setUp("{}");

    await readOfferFields(ai, { candidateId: "cand-1", jobOffer });

    const system = claude.calls[0]!.system ?? "";
    expect(system).toContain('"summary"');
    expect(system).toMatch(/deux ou trois phrases/);
    expect(system).toMatch(/langue de l'offre/);
    expect(system).toMatch(/sans rien inventer/);
    expect(system).toMatch(/sans nom de personne/);
  });

  it("keeps a summary of the right shape, its spacing tidied, in the language it was written in", async () => {
    const { ai, usage } = setUp(
      JSON.stringify({ location: "London", summary: "  Acme seeks a Finance Director\nto lead a team of 12.  Reporting to the CEO.  " }),
    );

    expect(await readOfferFields(ai, { candidateId: "cand-1", jobOffer })).toEqual({
      location: "London",
      summary: "Acme seeks a Finance Director to lead a team of 12. Reporting to the CEO.",
    });
    expect(usage.entries).toMatchObject([{ task: "offer_analysis", candidateId: "cand-1" }]);
  });

  it("reads the employer's sector and sub-sector, a sub-sector only with its sector, each a few words", async () => {
    const { ai } = setUp(JSON.stringify({ location: "Paris", sector: " Conseil ", subsector: "Stratégie et\ntransformation" }));
    expect(await readOfferFields(ai, { candidateId: null, jobOffer })).toEqual({ location: "Paris", sector: "Conseil", subsector: "Stratégie et transformation" });

    const { ai: noSector } = setUp(JSON.stringify({ location: "Paris", subsector: "Stratégie" }));
    expect(await readOfferFields(noSector, { candidateId: null, jobOffer })).toEqual({ location: "Paris" });

    const { ai: tooLong } = setUp(JSON.stringify({ location: "Paris", sector: "x".repeat(81) }));
    expect(await readOfferFields(tooLong, { candidateId: null, jobOffer })).toEqual({ location: "Paris" });
  });

  it("leaves out a summary that is not text, is empty or is far too long", async () => {
    for (const summary of [42, ["a", "b"], "   ", "x".repeat(601)]) {
      const { ai } = setUp(JSON.stringify({ location: "London", summary }));
      expect(await readOfferFields(ai, { candidateId: null, jobOffer })).toEqual({ location: "London" });
    }
  });

  it("comes with a job page read by Job discovery", async () => {
    const { ai, claude } = setUp('{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF.", "summary": "Groupe Seb recrute son DAF."}');

    expect(await readJobPage(ai, null, "page")).toEqual({ title: "DAF H/F", content: "Groupe Seb recrute son DAF.", summary: "Groupe Seb recrute son DAF." });
    expect(claude.calls[0]!.system).toMatch(/langue de l'offre/);
  });
});

describe("reading a job page (Job discovery)", () => {
  it("returns the posting with its fields, or null for a page that is not one job posting", async () => {
    const posting = setUp('{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF.", "contractType": "cdi", "skills": ["IFRS"]}');
    expect(await readJobPage(posting.ai, null, "page")).toEqual({
      title: "DAF H/F",
      content: "Groupe Seb recrute son DAF.",
      contractType: "cdi",
      skills: ["IFRS"],
    });

    const listing = setUp('{"isJobOffer": false}');
    expect(await readJobPage(listing.ai, null, "page")).toBeNull();
  });
});
