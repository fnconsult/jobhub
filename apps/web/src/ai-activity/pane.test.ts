import type { Provenance, ProvenanceStep } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { activityElement, aiActivityPane } from "./pane";

const at = "2026-10-23T08:40:00.000Z";
const ai = (overrides: Partial<Extract<ProvenanceStep, { kind: "ai" }>>): ProvenanceStep => ({
  kind: "ai",
  activity: "think_write",
  task: "coaching",
  provider: "anthropic",
  endpoint: "bedrock eu-north-1",
  model: "anthropic.claude-opus-5",
  tokens: { input: 1500, output: 300 },
  ms: 4200,
  at,
  outcome: "ok",
  count: 1,
  ...overrides,
});
const tool = (ms: number, count = 1): ProvenanceStep => ({ kind: "tool", activity: "read", tool: "job-site", ms, at, outcome: "ok", count });
const provenance = (steps: ProvenanceStep[], overrides: Partial<Provenance> = {}): Provenance => ({ v: 1, steps, sites: [], startedAt: at, wallMs: 5000, ...overrides });

/** `/offres/[id]`: the offer, found by a web search, its page read, then read by Claude Haiku. */
const offer = provenance(
  [
    ai({ activity: "web_search", task: "web_search", provider: "perplexity", endpoint: "api.perplexity.ai", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100 }),
    tool(900),
    ai({ activity: "read", task: "offer_analysis", model: "anthropic.claude-haiku-4-5", tokens: { input: 6000, output: 700 }, ms: 3900 }),
  ],
  { sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }], wallMs: 9100 },
);
/** A Coach reply about it: Claude Opus 5, which read the offer's page again (two reads folded into one step), and a Guardrail check by Claude Haiku. */
const reply = provenance([ai({}), tool(600, 2), ai({ activity: "think", task: "guardrail", model: "anthropic.claude-haiku-4-5", tokens: { input: 1800, output: 200 }, ms: 1500 })], {
  sites: [
    { kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon", "https://www.welcometothejungle.com/fr/companies/seb"] },
    { kind: "candidate", links: ["/profils"] },
  ],
  startedAt: "2026-10-23T08:45:00.000Z",
  wallMs: 6400,
});

describe("AI Activity's « Cette page » pane (#332)", () => {
  it("sums each model's tokens and time across the page's elements, and totals the tokens and the wall-clock time", () => {
    const pane = aiActivityPane([activityElement("job_offer", offer, { name: "DAF Lyon" }), activityElement("coach_reply", reply)]);

    expect(pane.models.map(({ name, tokens, ms }) => ({ name, tokens, ms }))).toEqual([
      { name: "Perplexity", tokens: 1100, ms: 4100 },
      { name: "Claude Haiku 4.5", tokens: 6700 + 2000, ms: 3900 + 1500 },
      { name: "Claude Opus 5", tokens: 1800, ms: 4200 },
    ]);
    // Wall-clock: each element's start to end, summed; never the steps' times added up.
    expect(pane.total).toEqual({ tokens: 1100 + 8700 + 1800, ms: 9100 + 6400 });
    expect(pane.summary).toEqual({ models: 3, tokens: 11_600, ms: 15_500 });
  });

  it("sums each Tool's calls across the elements, and names the elements that used it", () => {
    const pane = aiActivityPane([activityElement("job_offer", offer, { name: "DAF Lyon" }), activityElement("coach_reply", reply)]);

    expect(pane.tools).toEqual([{ name: "Sites d'emploi", ms: 900 + 600, usedBy: [0, 1] }]);
  });

  it("names each model for people, with where it ran, its raw id kept for the tooltip, and the EU AI Consent or outside-EU route", () => {
    const consent = provenance([ai({ provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-large-latest", euAiConsent: true }), ai({ provider: "anthropic", endpoint: "api.anthropic.com" })]);

    expect(aiActivityPane([activityElement("coach_reply", consent)]).models).toEqual([
      { name: "Mistral Large", ids: ["mistral-large-latest"], where: { fr: "Mistral AI · UE", en: "Mistral AI · EU" }, euAiConsent: true, outsideEu: false, tokens: 1800, ms: 4200 },
      { name: "Claude Opus 5", ids: ["anthropic.claude-opus-5"], where: { fr: "API Anthropic · hors UE", en: "Anthropic API · outside the EU" }, euAiConsent: false, outsideEu: true, tokens: 1800, ms: 4200 },
    ]);
  });

  it("keeps each Provenance site once, with the pages every element read", () => {
    const pane = aiActivityPane([activityElement("job_offer", offer), activityElement("coach_reply", reply)]);

    expect(pane.sites).toEqual([
      { kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon", "https://www.welcometothejungle.com/fr/companies/seb"] },
      { kind: "candidate", links: ["/profils"] },
    ]);
  });

  it("lists an element whose Provenance was not kept as « modèle non enregistré », out of every total", () => {
    const pane = aiActivityPane([activityElement("job_search", null, { at: "2026-10-20T08:00:00.000Z" }), activityElement("coach_reply", reply)]);

    expect(pane.elements[0]).toEqual({ kind: "job_search", at: "2026-10-20T08:00:00.000Z", served: null });
    expect(pane.total).toEqual({ tokens: 1800 + 2000, ms: 6400 });
    expect(pane.summary).toEqual({ models: 2, tokens: 3800, ms: 6400 });
  });

  it("has no summary, so the closed button shows no words, on a page with no AI content, or none recorded", () => {
    expect(aiActivityPane([])).toMatchObject({ models: [], tools: [], sites: [], elements: [], summary: null });
    expect(aiActivityPane([activityElement("job_search", null)]).summary).toBeNull();
  });

  it("knows no time for a Coach reply saved before Provenance (its times unknown), but counts its tokens", () => {
    const partial = provenance([ai({ endpoint: undefined, ms: 0 })], { wallMs: 0 });

    const pane = aiActivityPane([activityElement("coach_reply", partial)]);

    expect(pane.models).toMatchObject([{ name: "Claude Opus 5", where: null, tokens: 1800, ms: null }]);
    expect(pane.total).toEqual({ tokens: 1800, ms: null });
  });

  it("dates each element by when its action started, else by the date it was made", () => {
    expect(activityElement("coach_reply", reply).at).toBe("2026-10-23T08:45:00.000Z");
    expect(activityElement("job_offer", null, { at: "2026-10-01T08:00:00.000Z" }).at).toBe("2026-10-01T08:00:00.000Z");
    expect(activityElement("job_offer", null).at).toBeNull();
  });

  it("shows Jobbbox's rules as a Tool of its own, with their time", () => {
    const scored = provenance([{ kind: "rules", activity: "compute", rule: "match_score", ms: 12, at, outcome: "ok", count: 1 }]);

    expect(aiActivityPane([activityElement("job_offer", scored)]).tools).toEqual([{ name: null, ms: 12, usedBy: [0] }]);
  });

  it("holds no cost, prompt, AI task, Playbook Agent, Outcome or internal id: only what the pane shows", () => {
    const shown = JSON.stringify([activityElement("job_offer", offer, { name: "DAF Lyon" }), activityElement("coach_reply", reply)]);

    expect(shown).not.toMatch(/coaching|guardrail|offer_analysis|web_search|playbook|outcome|"ok"|eur|cost|prompt|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
