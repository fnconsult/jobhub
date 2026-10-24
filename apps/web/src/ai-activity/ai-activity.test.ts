import { rulesProvenance, type Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { applicationPage, tailoredDocumentsMade, jobDigestPage, jobOfferPage, jobSearchPage, profilePage, type PageSources } from "./index";
import { aiActivityPane, byRulesOnly } from "./pane";

/** The Job Offer: found by a web search, its page read, then read by Claude Haiku. */
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
/** A Coach reply about it: a Guardrail check that failed, Claude Opus 5's reply, and the offer's page read again. */
const replied: Provenance = {
  v: 1,
  steps: [
    { kind: "ai", activity: "think", task: "guardrail", provider: "anthropic", endpoint: "bedrock eu-north-1", ms: 300, at: "2026-10-23T10:40:00.000Z", outcome: "failed", count: 1 },
    { kind: "ai", activity: "think_write", task: "coaching", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-opus-5", tokens: { input: 1500, output: 600 }, ms: 4200, at: "2026-10-23T10:40:01.000Z", outcome: "ok", count: 1 },
    { kind: "tool", activity: "read", tool: "job-site", ms: 700, at: "2026-10-23T10:40:05.000Z", outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }],
  startedAt: "2026-10-23T10:40:00.000Z",
  wallMs: 6400,
};
const OFFER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OTHER_OFFER = "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const APPLICATION = "9e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const PROFILE = "0f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c";
const CANDIDATE = "cand_7Hq2LmX";

/** The app's Job Offers and Coach Conversations, faked: the offer read above, the Candidate's one reply about each object. */
function sources({ offers = { [OFFER]: read } as Record<string, Provenance | null>, replies = [{ at: replied.startedAt, provenance: replied as Provenance | null }] } = {}): PageSources {
  return {
    jobOffers: { provenances: async (ids) => new Map(ids.map((id) => [id, offers[id] ?? null])) },
    coachReplies: {
      repliesAbout: async (candidateId, focus) => (candidateId === CANDIDATE && [OFFER, APPLICATION, PROFILE].includes(focus.id) ? replies : []),
    },
  };
}

describe("AI Activity's page loaders (#332)", () => {
  it("shows `/offres/[id]`'s Job Offer and the Coach reply about it, with each model's and Tool's sums and the wall-clock total", async () => {
    const elements = await jobOfferPage(sources(), CANDIDATE, { id: OFFER, title: "DAF Lyon" });
    const pane = aiActivityPane(elements);

    expect(elements.map(({ kind, name, at }) => ({ kind, name, at }))).toEqual([
      { kind: "job_offer", name: "DAF Lyon", at: "2026-10-23T10:00:00.000Z" },
      { kind: "coach_reply", name: undefined, at: "2026-10-23T10:40:00.000Z" },
    ]);
    expect(pane.models.map(({ name, tokens, ms }) => ({ name, tokens, ms }))).toEqual([
      { name: "Perplexity", tokens: 1100, ms: 4100 },
      { name: "Claude Haiku 4.5", tokens: 6700, ms: 3900 },
      { name: "Claude Opus 5", tokens: 2100, ms: 4200 },
    ]);
    expect(pane.tools).toEqual([{ name: "Sites d'emploi", ms: 1600, usedBy: [0, 1] }]);
    expect(pane.total).toEqual({ tokens: 9900, ms: 15_500 });
    expect(pane.summary).toEqual({ models: 3, tokens: 9900, ms: 15_500 });
  });

  it("shows an offer from before Provenance was kept as « modèle non enregistré », counted in no total", async () => {
    const pane = aiActivityPane(await jobOfferPage(sources({ offers: {} }), CANDIDATE, { id: OFFER, title: "DAF Lyon" }));

    expect(pane.elements[0]).toEqual({ kind: "job_offer", name: "DAF Lyon", at: null, served: null });
    expect(pane.total).toEqual({ tokens: 2100, ms: 6400 });
  });

  it("never carries a cost, prompt, AI task, Playbook Agent, Back Office setting, Outcome, technical error or internal id to the browser", async () => {
    const props = JSON.stringify([
      await jobOfferPage(sources(), CANDIDATE, { id: OFFER, title: "DAF Lyon" }),
      await applicationPage(sources(), CANDIDATE, { id: APPLICATION, jobOffer: { id: OFFER, title: "DAF Lyon" } }, [{ kind: "tailored_cv", at: new Date("2026-10-22T09:00:00Z") }]),
      await profilePage(sources(), CANDIDATE, { id: PROFILE }, [{ kind: "action_card" }]),
      await jobSearchPage(sources(), [{ startedAt: new Date("2026-10-20T08:00:00Z"), results: [{ jobOffer: { id: OFFER, title: "DAF Lyon" } }] }]),
    ]);

    expect(props).not.toMatch(/€|eur\b|cost|prompt|playbook|agent|setting|coaching|guardrail|offer_analysis|web_search|outcome|failed|error/i);
    for (const id of [OFFER, APPLICATION, PROFILE, CANDIDATE]) expect(props).not.toContain(id);
    expect(props).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });

  it("shows each Job Search shown on `/recherches[/id]`, « non enregistré » until its slice lands, and the Job Offers it found", async () => {
    const elements = await jobSearchPage(sources(), [
      { startedAt: new Date("2026-10-20T08:00:00Z"), results: [{ jobOffer: { id: OFFER, title: "DAF Lyon" } }, { jobOffer: { id: OTHER_OFFER, title: "DAF Paris" } }] },
    ]);

    expect(elements.map(({ kind, name, at, served }) => ({ kind, name, at, recorded: served !== null }))).toEqual([
      { kind: "job_search", name: undefined, at: "2026-10-20T08:00:00.000Z", recorded: false },
      { kind: "job_offer", name: "DAF Lyon", at: "2026-10-23T10:00:00.000Z", recorded: true },
      { kind: "job_offer", name: "DAF Paris", at: null, recorded: false },
    ]);
  });

  it("shows a Job Search's run Provenance once kept (#354), « non enregistré » before", async () => {
    const run: Provenance = { ...read, steps: [{ kind: "rules", activity: "compute", rule: "match_score", ms: 2, at: "2026-10-23T10:00:10.000Z", outcome: "ok", count: 1 }] };
    const elements = await jobSearchPage(sources(), [
      { startedAt: new Date("2026-10-20T08:00:00Z"), provenance: run, results: [{ jobOffer: { id: OFFER, title: "DAF Lyon" } }] },
      { startedAt: new Date("2026-10-19T08:00:00Z"), provenance: null, results: [] },
    ]);

    expect(elements.map(({ kind, served }) => ({ kind, recorded: served !== null }))).toEqual([
      { kind: "job_search", recorded: true },
      { kind: "job_offer", recorded: true },
      { kind: "job_search", recorded: false },
    ]);
  });

  it("shows `/job-digests/[id]`'s Job Digest, « non enregistré », and the Job Offers it brought", async () => {
    const elements = await jobDigestPage(sources(), { sentAt: new Date("2026-10-21T06:00:00Z"), results: [{ jobOffer: { id: OFFER, title: "DAF Lyon" } }] });

    expect(elements.map(({ kind, served }) => ({ kind, recorded: served !== null }))).toEqual([
      { kind: "job_digest", recorded: false },
      { kind: "job_offer", recorded: true },
    ]);
  });

  it("shows a new Job Digest from its Provenance (#336): its Match Scores, « Calcul » with no model, then its top-up run", async () => {
    const scoring = rulesProvenance("match_score", { at: new Date("2026-10-21T06:00:00Z"), ms: 8 });
    const [alone] = await jobDigestPage(sources(), { sentAt: new Date("2026-10-21T06:00:00Z"), provenance: scoring, results: [] });
    const [toppedUp] = await jobDigestPage(sources(), { sentAt: new Date("2026-10-21T06:00:00Z"), provenance: { ...read, steps: [...scoring.steps, ...read.steps] }, results: [] });

    expect(alone).toMatchObject({ kind: "job_digest", at: "2026-10-21T06:00:00.000Z", served: { models: [], tools: [{ name: null, ms: 8 }] } });
    expect(byRulesOnly(alone!.served!)).toBe(true);
    expect(toppedUp!.served!.models.map((model) => model.name)).toEqual(["Perplexity", "Claude Haiku 4.5"]);
    expect(byRulesOnly(toppedUp!.served!)).toBe(false);
  });

  it("shows `/candidatures/[id]/*`'s Job Offer, what was made for it (« non enregistré » until their slices land) and the Coach replies about the Application", async () => {
    const elements = await applicationPage(sources(), CANDIDATE, { id: APPLICATION, jobOffer: { id: OFFER, title: "DAF Lyon" } }, [
      { kind: "tailored_cv", at: new Date("2026-10-22T09:00:00Z") },
      { kind: "company_dossier" },
    ]);

    expect(elements.map(({ kind, at, served }) => ({ kind, at, recorded: served !== null }))).toEqual([
      { kind: "job_offer", at: "2026-10-23T10:00:00.000Z", recorded: true },
      { kind: "tailored_cv", at: "2026-10-22T09:00:00.000Z", recorded: false },
      { kind: "company_dossier", at: null, recorded: false },
      { kind: "coach_reply", at: "2026-10-23T10:40:00.000Z", recorded: true },
    ]);
  });

  it("shows `/profils/[id]/*`'s ATS Score and ATS Fix cards as « Calcul » with no model, and an Action Card proposed before as « non enregistré » (#336)", async () => {
    const at = new Date("2026-10-24T09:00:00Z");
    const elements = await profilePage(sources({ replies: [] }), CANDIDATE, { id: PROFILE }, [
      { kind: "ats_score", provenance: rulesProvenance("ats_score", { at }) },
      { kind: "action_card", name: "Ajoutez « IFRS » à vos compétences", provenance: rulesProvenance("ats_fixes", { at, ms: 2 }) },
      { kind: "action_card", name: "Ajoutez « SAP » à vos compétences", at, provenance: null },
    ]);
    const pane = aiActivityPane(elements);

    expect(elements.map(({ kind, name, served }) => ({ kind, name, byRules: served ? byRulesOnly(served) : null }))).toEqual([
      { kind: "ats_score", name: undefined, byRules: true },
      { kind: "action_card", name: "Ajoutez « IFRS » à vos compétences", byRules: true },
      { kind: "action_card", name: "Ajoutez « SAP » à vos compétences", byRules: null },
    ]);
    expect(pane.models).toEqual([]);
    expect(pane.tools).toEqual([{ name: null, ms: 2, usedBy: [0, 1] }]);
    // No model served the page: the closed button shows its label, not « 0 modèle ».
    expect(pane.summary).toBeNull();
  });

  it("shows `/candidatures/[id]/*`'s Follow-up card with the model that wrote it (#336)", async () => {
    const wrote: Provenance = {
      v: 1,
      steps: [{ kind: "ai", activity: "write", task: "writing", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-sonnet-5", tokens: { input: 900, output: 120 }, ms: 2100, at: "2026-11-12T06:00:00.000Z", outcome: "ok", count: 1 }],
      sites: [],
      startedAt: "2026-11-12T06:00:00.000Z",
      wallMs: 2100,
    };
    const elements = await applicationPage(sources({ replies: [] }), CANDIDATE, { id: APPLICATION, jobOffer: { id: OFFER, title: "DAF Lyon" } }, [
      { kind: "action_card", name: "Relancer : DAF Lyon", provenance: wrote },
    ]);

    expect(elements[1]).toMatchObject({ kind: "action_card", name: "Relancer : DAF Lyon", at: "2026-11-12T06:00:00.000Z", served: { models: [{ name: "Claude Sonnet 5", tokens: 1020 }] } });
    expect(aiActivityPane(elements).summary).toMatchObject({ models: 3 });
  });

  it("shows `/profils/[id]/*`'s Action Cards, « non enregistré », and the Coach replies about the Profile", async () => {
    const elements = await profilePage(sources(), CANDIDATE, { id: PROFILE }, [{ kind: "action_card", at: new Date("2026-10-19T09:00:00Z") }]);

    expect(elements.map(({ kind, served }) => ({ kind, recorded: served !== null }))).toEqual([
      { kind: "action_card", recorded: false },
      { kind: "coach_reply", recorded: true },
    ]);
  });

  it("lists a Coach reply saved with nothing kept as « modèle non enregistré »", async () => {
    const elements = await jobOfferPage(sources({ replies: [{ at: "2026-09-01T08:00:00.000Z", provenance: null }] }), CANDIDATE, { id: OFFER, title: "DAF Lyon" });

    expect(elements[1]).toEqual({ kind: "coach_reply", at: "2026-09-01T08:00:00.000Z", served: null });
  });
});

describe("the Application's Tailored Documents, as AI Activity reads them on its pages (#334)", () => {
  const written = (model: string): Provenance => ({
    v: 1,
    steps: [{ kind: "ai", activity: "write", task: "writing", provider: "mistral", endpoint: "api.mistral.ai", model, tokens: { input: 4000, output: 900 }, ms: 8200, at: "2026-10-23T10:40:00.000Z", outcome: "ok", count: 1 }],
    sites: [],
    startedAt: "2026-10-23T10:40:00.000Z",
    wallMs: 8200,
  });
  const day = (hour: number) => new Date(Date.UTC(2026, 9, 23, hour));

  it("is the saved Tailored CV, the proposal under review, the Cover Letter and the Outreach Message, each with its Provenance and when it was written", async () => {
    const made = tailoredDocumentsMade(
      { saved: { savedAt: day(9), provenance: written("mistral-large-latest") }, proposal: { proposedAt: day(10), provenance: written("mistral-medium-latest") } },
      { coverLetter: { draftedAt: day(11), provenance: written("mistral-large-latest") }, outreachMessage: { draftedAt: day(12), provenance: null } },
    );
    expect(made.map(({ kind, at, provenance }) => ({ kind, at, model: provenance?.steps[0]?.kind === "ai" ? provenance.steps[0].model : null }))).toEqual([
      { kind: "tailored_cv", at: day(9), model: "mistral-large-latest" },
      { kind: "tailored_cv", at: day(10), model: "mistral-medium-latest" },
      { kind: "tailored_documents", at: day(11), model: "mistral-large-latest" },
      { kind: "tailored_documents", at: day(12), model: null },
    ]);

    // As the pane shows them: the models that wrote them, their tokens and time; one written before #334, « modèle non enregistré ».
    const elements = await applicationPage(sources({ offers: {}, replies: [] }), "candidate-1", { id: "application-1", jobOffer: { id: "offer-1", title: "DAF" } }, made);
    expect(elements.slice(1).map((element) => element.served?.models.map((model) => model.name) ?? null)).toEqual([["Mistral Large"], ["Mistral Medium"], ["Mistral Large"], null]);
    expect(aiActivityPane(elements).total).toEqual({ tokens: 3 * 4900, ms: 3 * 8200 });
  });

  it("is nothing when none was written yet", () => {
    expect(tailoredDocumentsMade(null, null)).toEqual([]);
    expect(tailoredDocumentsMade({ saved: null, proposal: null }, { coverLetter: null, outreachMessage: null })).toEqual([]);
  });
});
