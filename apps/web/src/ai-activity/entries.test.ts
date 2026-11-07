import type { Provenance, ReplyCost } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { activityEntries, type CardGiven, type ReplyGiven } from "./entries";

/**
 * The scenarios of the « Activité unifiée » prototype (ADR-0086, variant C), as the builder is given them: a Job Search
 * page with its run and a Job Offer read from it, a conversation with two replies interleaved and an applied card, a
 * Profile page's chain reply → Master CV Version 7 → ATS Score, a reply saved before #791, and an element « modèle non
 * enregistré ».
 */

const SEARCH = "1a5b6c7d-8e9f-4a0b-9c2d-3e4f5a6b7c8d";
const OFFER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PROFILE = "0f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c";
const CARD = "3c7d8e9f-0a1b-4c2d-8e4f-5a6b7c8d9e0f";
const OTHER_CARD = "5e9f0a1b-2c3d-4e4f-8a6b-7c8d9e0f1a2b";

const at = (hhmm: string, day = "2026-11-05") => `${day}T${hhmm}:00.000Z`;

/** A Job Search's run (scenario 1): Brave's web search, Mistral Medium reading 23 pages, duplicates and Match Scores by rules. */
const searchRun: Provenance = {
  v: 1,
  steps: [
    { kind: "tool", activity: "web_search", tool: "brave", ms: 2_000, at: at("14:02"), outcome: "ok", count: 8 },
    { kind: "ai", activity: "read", task: "offer_analysis", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-medium-3-5", tokens: { input: 30_000, output: 6_100 }, ms: 9_000, at: at("14:03"), outcome: "ok", count: 23 },
    { kind: "rules", activity: "compute", rule: "offer_dedup", ms: 40, at: at("14:04"), outcome: "ok", count: 1 },
    { kind: "rules", activity: "compute", rule: "match_score", ms: 60, at: at("14:04"), outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "airbus.com", links: ["https://www.airbus.com/fr/careers/controleuse-de-gestion"] }],
  startedAt: at("14:02"),
  wallMs: 161_000,
};

/** The Job Offer opened afterwards, its page read and summarized by Mistral Small. */
const offerRead: Provenance = {
  v: 1,
  steps: [
    { kind: "tool", activity: "read", tool: "job-site", ms: 900, at: at("14:06"), outcome: "ok", count: 1 },
    { kind: "ai", activity: "think_write", task: "offer_summary", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-small", tokens: { input: 2_000, output: 300 }, ms: 3_000, at: at("14:06"), outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "airbus.com", links: ["https://www.airbus.com/fr/careers/controleuse-de-gestion"] }],
  startedAt: at("14:06"),
  wallMs: 4_000,
};

const searchElement = { kind: "job_search" as const, provenance: searchRun, href: `/recherches/${SEARCH}`, result: { offers: 14 } };
const offerElement = { kind: "job_offer" as const, provenance: offerRead, name: "Airbus · Contrôleuse de gestion industrielle", href: `/recherches/${SEARCH}/offres/${OFFER}`, after: 0 };

/** A Coach reply's Provenance: its Coach Actions (what they saw, by page), a Guardrail check, then the reply written. */
function replyRun(start: string, actions: { tool: "profile" | "job-searches"; action: string; seen: { type: "profile" | "job_search"; href: string }[]; proposes?: true }[]): Provenance {
  return {
    v: 1,
    steps: [
      ...actions.map(({ tool, action, seen, proposes }) => ({ kind: "tool" as const, activity: "act" as const, tool, action, seen, ...(proposes ? { proposes } : {}), ms: 300, at: start, outcome: "ok" as const, count: 1 })),
      { kind: "ai", activity: "think", task: "guardrail", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-small", tokens: { input: 900, output: 20 }, ms: 600, at: start, outcome: "ok", count: 1 },
      { kind: "ai", activity: "think_write", task: "coaching", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "claude-opus-5-5", tokens: { input: 6_000, output: 900 }, ms: 9_000, at: start, outcome: "ok", count: 1 },
    ],
    sites: [{ kind: "candidate", links: [`/profils/${PROFILE}`] }],
    startedAt: start,
    wallMs: 23_000,
  };
}

/** What a reply sent in all its AI calls (#805). */
const SENT: ReplyCost = { calls: 4, turns: 2, rounds: 1, inputTokens: 21_400, cachedInputTokens: 9_000, outputTokens: 800 };

const blagnac: CardGiven = {
  id: CARD,
  status: "accepted",
  decidedAt: at("14:05"),
  change: { target: { href: `/profils/${PROFILE}`, name: "Contrôle de gestion" }, what: "Lieux", before: "Toulouse, Colomiers", after: "Toulouse, Colomiers, Blagnac" },
};
const remote: CardGiven = {
  id: OTHER_CARD,
  status: "dismissed",
  decidedAt: at("14:05"),
  change: { target: { href: `/profils/${PROFILE}`, name: "Contrôle de gestion" }, what: "Télétravail", before: "Non précisé", after: "Partiel" },
};

/** Scenario 2: while the search runs, a first reply proposes Blagnac (applied) and partial remote work (dismissed); a second follows. */
const firstReply: ReplyGiven = {
  messageId: "m2",
  at: at("14:03"),
  question: "Pendant que ça cherche : je devrais ajouter Blagnac ?\n\nEt le télétravail   partiel, ça change quelque chose ?",
  provenance: replyRun(at("14:03"), [
    { tool: "profile", action: "read_profile", seen: [{ type: "profile", href: `/profils/${PROFILE}` }] },
    { tool: "job-searches", action: "read_job_search", seen: [{ type: "job_search", href: `/recherches/${SEARCH}` }] },
    { tool: "profile", action: "propose_search_criteria", seen: [{ type: "profile", href: `/profils/${PROFILE}` }], proposes: true },
  ]),
  sent: SENT,
  seenNames: { [`/profils/${PROFILE}`]: "Contrôle de gestion", [`/recherches/${SEARCH}`]: "Contrôle de gestion" },
  cards: [blagnac, remote],
};
const secondReply: ReplyGiven = {
  messageId: "m5",
  at: at("14:07"),
  question: "Lesquelles sont les plus proches de mon profil ?",
  provenance: replyRun(at("14:07"), [{ tool: "job-searches", action: "read_job_search", seen: [{ type: "job_search", href: `/recherches/${SEARCH}` }] }]),
  sent: { ...SENT, calls: 3, inputTokens: 24_100 },
};

describe("Activité entries (#807): a pure builder over a page's elements, Coach replies, Master CV Versions and applied cards", () => {
  describe("scenario 1, a Job Search alone", () => {
    const entries = activityEntries({ page: "job_search", elements: [searchElement, offerElement] });

    it("lists the Job Offer read, then the run that found it, newest first, the offer « suite de » the run", () => {
      expect(entries.map(({ kind, at, object, after }) => ({ kind, at, object, after }))).toEqual([
        { kind: "job_offer", at: at("14:06"), object: { href: `/recherches/${SEARCH}/offres/${OFFER}`, label: "Airbus · Contrôleuse de gestion industrielle" }, after: entries[1]!.key },
        { kind: "job_search", at: at("14:02"), object: { href: `/recherches/${SEARCH}`, label: null }, after: undefined },
      ]);
      expect(entries[1]).not.toHaveProperty("messageId");
    });

    it("gives the run its steps, models, Tools and sites from its Provenance, its result, and its cost: one Job Search of the Plan Quota and its tokens", () => {
      const [, search] = entries;
      expect(search!.steps.map(({ label, tool, model, count }) => ({ label, tool, model, count }))).toEqual([
        { label: "web_search", tool: "Brave Search", model: null, count: 8 },
        { label: "read", tool: null, model: "Mistral Medium 3.5", count: 23 },
        { label: "compute", tool: null, model: null, count: 2 },
      ]);
      expect(search!.models.map((model) => model.name)).toEqual(["Mistral Medium 3.5"]);
      expect(search!.tools.map((tool) => tool.name)).toEqual(["Brave Search", null]);
      expect(search!.sites).toEqual(searchRun.sites);
      expect(search!.origin).toBe("candidate");
      expect(search!.result).toEqual({ end: { state: "done" }, offers: 14 });
      expect(search!.cost).toEqual({ quota: "jobSearches", tokens: { count: 36_100, calls: null, partial: false }, noAi: false });
    });

    it("counts the Job Offer's reading in no Plan Quota", () => {
      expect(entries[0]!.cost).toEqual({ quota: null, tokens: { count: 2_300, calls: null, partial: false }, noAi: false });
    });
  });

  describe("scenario 2, a Job Search, two Coach replies interleaved and an applied card", () => {
    const entries = activityEntries({ page: "job_search", elements: [searchElement], replies: [secondReply, firstReply] });
    const [second, change, first, search] = entries;

    it("interleaves the replies, the change applied and the run in the order of time, the change « suite de » the reply that proposed it", () => {
      expect(entries.map(({ kind, at, messageId, after }) => ({ kind, at, messageId, after }))).toEqual([
        { kind: "coach_reply", at: at("14:07"), messageId: "m5", after: undefined },
        { kind: "change", at: at("14:05"), messageId: "m2", after: first!.key },
        { kind: "coach_reply", at: at("14:03"), messageId: "m2", after: undefined },
        { kind: "job_search", at: at("14:02"), messageId: undefined, after: undefined },
      ]);
      expect(search!.kind).toBe("job_search");
    });

    it("gives a reply its question on one line, its tool steps with what each saw, what it read, its models and Tools", () => {
      expect(first!.origin).toBe("question");
      expect(first!.question).toBe("Pendant que ça cherche : je devrais ajouter Blagnac ? Et le télétravail partiel, ça change quelque chose ?");
      expect(first!.steps.map(({ label, tool, model, seen }) => ({ label, tool, model, seen }))).toEqual([
        { label: "act", tool: "Profil", model: null, seen: [{ kind: "object", href: `/profils/${PROFILE}`, page: "profile", name: "Contrôle de gestion", type: "profile" }] },
        { label: "act", tool: "Recherches d'offres", model: null, seen: [{ kind: "object", href: `/recherches/${SEARCH}`, page: "job_search", name: "Contrôle de gestion", type: "job_search" }] },
        { label: "propose", tool: "Profil", model: null, seen: [{ kind: "object", href: `/profils/${PROFILE}`, page: "profile", name: "Contrôle de gestion", type: "profile" }] },
        { label: "check", tool: null, model: "Mistral Small", seen: [] },
        { label: "think_write", tool: null, model: "Claude Opus 5.5", seen: [] },
      ]);
      expect(first!.read).toEqual([
        { kind: "object", href: `/profils/${PROFILE}`, page: "profile", name: "Contrôle de gestion", type: "profile" },
        { kind: "object", href: `/recherches/${SEARCH}`, page: "job_search", name: "Contrôle de gestion", type: "job_search" },
      ]);
      expect(first!.models.map((model) => model.name)).toEqual(["Mistral Small", "Claude Opus 5.5"]);
      expect(first!.tools.map((tool) => tool.name)).toEqual(["Profil", "Recherches d'offres"]);
      expect(first!.object).toEqual({ href: null, label: null });
    });

    it("costs a reply all its calls' tokens summed, in no Plan Quota", () => {
      expect(first!.cost).toEqual({ quota: null, tokens: { count: 22_200, calls: 4, partial: false }, noAi: false });
      expect(second!.cost.tokens).toEqual({ count: 24_900, calls: 3, partial: false });
    });

    it("lists a reply's proposals with their state and what an applied one led to; only the applied card is an entry", () => {
      expect(first!.proposals).toEqual([
        { object: { href: `/profils/${PROFILE}`, label: "Contrôle de gestion" }, what: "Lieux", before: "Toulouse, Colomiers", after: "Toulouse, Colomiers, Blagnac", state: "applied", led: change!.key },
        { object: { href: `/profils/${PROFILE}`, label: "Contrôle de gestion" }, what: "Télétravail", before: "Non précisé", after: "Partiel", state: "dismissed", led: null },
      ]);
      expect(second!.proposals).toEqual([]);
      expect(entries.filter((entry) => entry.kind === "change")).toHaveLength(1);
    });

    it("makes the applied card the change it made, on its object, without AI", () => {
      expect(change).toMatchObject({
        object: { href: `/profils/${PROFILE}`, label: "Contrôle de gestion" },
        origin: "coach_proposal",
        result: { end: { state: "done" }, change: { what: "Lieux", before: "Toulouse, Colomiers", after: "Toulouse, Colomiers, Blagnac" } },
        steps: [],
        cost: { quota: null, tokens: null, noAi: true },
      });
    });
  });
});
