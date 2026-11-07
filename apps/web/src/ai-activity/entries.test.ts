import { readProvenance, rulesProvenance, type Provenance, type ReplyCost } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { activityEntries, servedEntries, type CardGiven, type ReplyGiven, type VersionGiven } from "./entries";

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
const CV_CARD = "4d8e9f0a-1b2c-4d3e-9f5a-6b7c8d9e0f1a";
const CV = `/profils/${PROFILE}/cv-de-reference`;

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

  describe("scenario 3a, a Profile's Master CV: a reply, then Version 7 its card created, then that version's ATS Score", () => {
    /** Version 1 read from the Candidate's file by Mistral Medium. */
    const cvRead: Provenance = {
      v: 1,
      steps: [{ kind: "ai", activity: "think", task: "cv_parsing", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-medium-3-5", tokens: { input: 8_000, output: 1_600 }, ms: 20_000, at: at("10:31", "2026-10-12"), outcome: "ok", count: 1 }],
      sites: [{ kind: "candidate", links: [] }],
      startedAt: at("10:31", "2026-10-12"),
      wallMs: 27_000,
    };
    const versions: VersionGiven[] = [
      { version: 7, savedAt: new Date(at("21:18")), restoredFrom: null, origin: { cardId: CV_CARD }, href: CV },
      { version: 6, savedAt: new Date(at("20:38", "2026-10-27")), restoredFrom: null, href: CV },
      { version: 1, savedAt: new Date(at("10:31", "2026-10-12")), restoredFrom: null, provenance: cvRead, href: CV },
    ];
    const scores = [
      { kind: "ats_score" as const, provenance: rulesProvenance("ats_score", { at: new Date(at("20:40", "2026-10-27")) }), scored: 6, href: CV, result: { score: 68 } },
      { kind: "ats_score" as const, provenance: rulesProvenance("ats_score", { at: new Date(at("21:19")) }), scored: 7, href: CV, result: { score: 79 } },
    ];
    const strengthen: ReplyGiven = {
      messageId: "m8",
      at: at("21:14"),
      question: "Peux-tu renforcer mon CV pour le contrôle de gestion industriel ?",
      provenance: replyRun(at("21:14"), [{ tool: "profile", action: "propose_master_cv", seen: [{ type: "profile", href: `/profils/${PROFILE}` }], proposes: true }]),
      sent: SENT,
      cards: [{ id: CV_CARD, status: "accepted", decidedAt: at("21:18"), change: { target: { href: CV, name: "CV de référence" }, what: "3 modifications du CV", before: "Version 6", after: "Version 7" } }],
    };
    const entries = activityEntries({ page: "profile", elements: scores, replies: [strengthen], versions });
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));

    it("chains the ATS Score to Version 7 and Version 7 to the reply whose card created it, newest first", () => {
      expect(entries.map(({ kind, at, result, after }) => ({ kind, at, result, after: after ? byKey.get(after)!.kind : undefined }))).toEqual([
        { kind: "ats_score", at: at("21:19"), result: { end: { state: "done" }, score: 79 }, after: "master_cv_version" },
        { kind: "master_cv_version", at: at("21:18"), result: { end: { state: "done" }, version: 7, restoredFrom: null }, after: "coach_reply" },
        { kind: "coach_reply", at: at("21:14"), result: { end: { state: "done" } }, after: undefined },
        { kind: "ats_score", at: at("20:40", "2026-10-27"), result: { end: { state: "done" }, score: 68 }, after: "master_cv_version" },
        { kind: "master_cv_version", at: at("20:38", "2026-10-27"), result: { end: { state: "done" }, version: 6, restoredFrom: null }, after: undefined },
        { kind: "master_cv", at: at("10:31", "2026-10-12"), result: { end: { state: "done" }, version: 1 }, after: undefined },
      ]);
      expect(byKey.get(entries[0]!.after!)!.result.version).toBe(7);
      expect(byKey.get(entries[3]!.after!)!.result.version).toBe(6);
    });

    it("makes Version 7 the change the card applied: from the coach's proposal, in the conversation, without AI, and no change entry beside it", () => {
      const [, seventh, reply] = entries;
      expect(seventh).toMatchObject({ object: { href: CV, label: null }, origin: "coach_proposal", messageId: "m8", cost: { quota: null, tokens: null, noAi: true } });
      expect(entries.some((entry) => entry.kind === "change")).toBe(false);
      expect(reply!.proposals).toEqual([{ object: { href: CV, label: "CV de référence" }, what: "3 modifications du CV", before: "Version 6", after: "Version 7", state: "applied", led: seventh!.key }]);
    });

    it("says a version saved by hand is the Candidate's, and Version 1 read from their file has its model and tokens", () => {
      expect(entries[4]).toMatchObject({ origin: "candidate", cost: { noAi: true } });
      expect(entries[4]).not.toHaveProperty("messageId");
      expect(entries[5]).toMatchObject({ origin: "candidate", cost: { quota: null, tokens: { count: 9_600, calls: null, partial: false }, noAi: false } });
      expect(entries[5]!.models.map((model) => model.name)).toEqual(["Mistral Medium 3.5"]);
    });

    it("keeps Version 7 « suite de » the reply once its card is undone, with no change entry", () => {
      const undone = activityEntries({ page: "profile", replies: [{ ...strengthen, cards: [{ ...strengthen.cards![0]!, status: "undone" }] }], versions: versions.slice(0, 1) });
      expect(undone.map(({ kind, messageId, after }) => ({ kind, messageId, after }))).toEqual([
        { kind: "master_cv_version", messageId: "m8", after: "coach_reply:m8" },
        { kind: "coach_reply", messageId: "m8", after: undefined },
      ]);
      expect(undone[1]!.proposals![0]).toMatchObject({ state: "undone", led: undone[0]!.key });
    });

    it("built in two halves, the server's (its elements, versions and replies) then the thread's replies with their cards (#808), is the same", () => {
      const served = servedEntries({ page: "profile", elements: scores, versions, replies: [{ ...strengthen, cards: [] }] });
      // The server's half names no card but a version's Origin, which the thread's cards hold already.
      expect(served.filter((entry) => entry.card).map(({ key, card }) => [key, card])).toEqual([["master_cv_version:7", CV_CARD]]);
      expect(served.find((entry) => entry.kind === "master_cv_version" && entry.result.version === 7)).not.toHaveProperty("after");
      expect(activityEntries({ page: "profile", built: served, replies: [strengthen] })).toEqual(entries);
    });

    it("keeps the server's reply when the thread does not show it, without « Voir dans la conversation » being the builder's to decide", () => {
      const served = servedEntries({ page: "profile", replies: [{ ...strengthen, cards: [] }] });
      expect(activityEntries({ page: "profile", built: served }).map(({ key, messageId }) => [key, messageId])).toEqual([["coach_reply:m8", "m8"]]);
    });

    it("counts an ATS Score in its Plan Quota, made by Jobbbox's rules without AI", () => {
      expect(entries[0]).toMatchObject({ origin: "jobbbox", cost: { quota: "atsScores", tokens: null, noAi: true }, models: [], tools: [{ name: null }] });
    });
  });

  describe("a reply saved before #791", () => {
    /** Its partial Provenance, read from its own columns: the last call only, times unknown. */
    const lastCall = readProvenance(null, { activity: "think_write", task: "coaching", provider: "anthropic", model: "claude-opus-5", inputTokens: 5_000, cachedInputTokens: 1_000, outputTokens: 700, at: new Date(at("09:00", "2026-10-01")) });
    const [old] = activityEntries({ page: "any", replies: [{ messageId: "m1", at: at("09:00", "2026-10-01"), question: "Bonjour", provenance: lastCall, sent: null }] });

    it("costs what its Provenance holds, marked partial (« dernier appel seulement »)", () => {
      expect(old!.cost).toEqual({ quota: null, tokens: { count: 6_700, calls: null, partial: true }, noAi: false });
      expect(old!.models.map((model) => model.name)).toEqual(["Claude Opus 5"]);
      expect(old!.steps).toEqual([{ label: "think_write", tool: null, model: "Claude Opus 5", count: 1, ms: null, tokens: 6_700, seen: [] }]);
      expect(old!.read).toEqual([]);
    });

    it("is « modèle non enregistré » when no model was saved either", () => {
      const [none] = activityEntries({ page: "any", replies: [{ messageId: "m1", at: at("09:00", "2026-10-01"), question: null, provenance: null, sent: null }] });
      expect(none).toMatchObject({ unrecorded: true, at: at("09:00", "2026-10-01"), question: null, cost: { tokens: null, noAi: false }, models: [], steps: [] });
    });
  });

  describe("an element « modèle non enregistré »", () => {
    const dossier = { kind: "company_dossier" as const, provenance: null, at: new Date(at("11:00", "2026-09-30")), href: "/candidatures/a/entreprise", sites: [{ kind: "web" as const, domain: "annuaire-entreprises.data.gouv.fr", links: [] }] };
    const [entry] = activityEntries({ page: "any", elements: [dossier] });

    it("keeps its date, page and the sites its source names, with no step, model, Tool or token, and is not said « Sans IA »", () => {
      expect(entry).toEqual({
        key: `company_dossier:${at("11:00", "2026-09-30")}`,
        kind: "company_dossier",
        at: at("11:00", "2026-09-30"),
        object: { href: "/candidatures/a/entreprise", label: null },
        origin: "candidate",
        result: { end: { state: "done" } },
        steps: [],
        sites: dossier.sites,
        tools: [],
        models: [],
        cost: { quota: null, tokens: null, noAi: false },
        unrecorded: true,
      });
    });

    it("has no date when none was given, and comes after every dated entry", () => {
      const entries = activityEntries({ page: "job_search", elements: [{ kind: "job_offer", provenance: null, name: "Safran · Contrôleur" }, searchElement] });
      expect(entries.map(({ kind, at, unrecorded }) => ({ kind, at, unrecorded }))).toEqual([
        { kind: "job_search", at: at("14:02"), unrecorded: undefined },
        { kind: "job_offer", at: null, unrecorded: true },
      ]);
    });
  });

  describe("a stable order", () => {
    const same = at("10:00");
    const rules = rulesProvenance("ats_score", { at: new Date(same) });
    const reply: ReplyGiven = {
      messageId: "m3",
      at: same,
      question: "Et maintenant ?",
      provenance: null,
      sent: null,
      cards: [{ id: CV_CARD, status: "accepted", decidedAt: same, change: { target: { href: CV, name: "CV de référence" }, what: "Titre", before: "A", after: "B" } }],
    };
    const input = {
      page: "profile" as const,
      elements: [
        { kind: "ats_score" as const, provenance: rules, scored: 8, href: CV },
        { kind: "action_card" as const, provenance: rules, name: "ATS Fix", href: CV },
        { kind: "action_card" as const, provenance: rules, name: "ATS Fix", href: CV },
      ],
      replies: [reply],
      versions: [{ version: 8, savedAt: same, restoredFrom: null, origin: { cardId: CV_CARD }, href: CV }],
    };

    it("puts entries of the same time in the same order whatever order they were given in, a consequence before its cause", () => {
      const entries = activityEntries(input);
      expect(entries.map(({ kind }) => kind)).toEqual(["ats_score", "master_cv_version", "action_card", "action_card", "coach_reply"]);
      const reversed = activityEntries({ ...input, elements: [...input.elements].reverse() });
      expect(reversed.map(({ kind, key }) => ({ kind, key }))).toEqual(entries.map(({ kind, key }) => ({ kind, key })));
      expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    });

    it("orders entries alike but for their object the same way whatever order they were given in", () => {
      const safran = { kind: "job_offer" as const, provenance: null, name: "Safran · Contrôleur", href: `/recherches/${SEARCH}/offres/s` };
      const airbus = { kind: "job_offer" as const, provenance: null, name: "Airbus · Contrôleuse", href: `/recherches/${SEARCH}/offres/a` };
      const one = activityEntries({ page: "job_search", elements: [safran, airbus] });
      const other = activityEntries({ page: "job_search", elements: [airbus, safran] });
      expect(other.map(({ key, object }) => ({ key, object }))).toEqual(one.map(({ key, object }) => ({ key, object })));
    });
  });

  describe("what each page counts", () => {
    const cvCard: ReplyGiven = {
      messageId: "m4",
      at: at("15:00"),
      question: "Change mon titre",
      provenance: null,
      sent: null,
      cards: [{ id: CV_CARD, status: "accepted", decidedAt: at("15:01"), change: { target: { href: CV, name: "CV de référence" }, what: "Titre", before: "A", after: "B" } }],
    };
    const versions: VersionGiven[] = [{ version: 9, savedAt: at("15:01"), restoredFrom: null, origin: { cardId: CV_CARD }, href: CV }];
    const atsScore = { kind: "ats_score" as const, provenance: rulesProvenance("ats_score", { at: new Date(at("15:02")) }), scored: 9 };

    it("a Profile's page: its Master CV Versions and ATS Scores, not a Job Search's run", () => {
      const entries = activityEntries({ page: "profile", elements: [searchElement, atsScore], replies: [cvCard], versions });
      expect(entries.map(({ kind }) => kind)).toEqual(["ats_score", "master_cv_version", "coach_reply"]);
    });

    it("a Job Search's page: its run and the Job Offers read from it, no Master CV Version (the card stays the change it made)", () => {
      const entries = activityEntries({ page: "job_search", elements: [searchElement, offerElement, atsScore], replies: [cvCard], versions });
      expect(entries.map(({ kind }) => kind)).toEqual(["change", "coach_reply", "job_offer", "job_search"]);
    });

    it("any page: the replies of its Coach Conversation and what it shows", () => {
      const entries = activityEntries({ page: "any", elements: [offerElement], replies: [cvCard], versions });
      expect(entries.map(({ kind }) => kind)).toEqual(["change", "coach_reply", "job_offer"]);
      expect(entries[2]).not.toHaveProperty("after");
    });
  });

  describe("a proposal's state", () => {
    const card = (id: string, status: CardGiven["status"]): CardGiven => ({ id, status, change: { target: { href: `/profils/${PROFILE}`, name: "Contrôle de gestion" }, what: status, before: "a", after: "b" } });
    const [reply, ...others] = activityEntries({
      page: "any",
      replies: [{ messageId: "m9", at: at("16:00"), question: "?", provenance: null, sent: null, cards: [card(CARD, "pending"), card(OTHER_CARD, "undone"), card(CV_CARD, "withdrawn")] }],
    });

    it("is pending, undone or withdrawn, and none of those cards is an entry", () => {
      expect(reply!.proposals!.map(({ state, led }) => ({ state, led }))).toEqual([
        { state: "pending", led: null },
        { state: "undone", led: null },
        { state: "withdrawn", led: null },
      ]);
      expect(others).toEqual([]);
    });
  });

  it("never carries a card's id, an AI task, a provider's Outcome or a name not from `seenNames` (ADR-0034)", () => {
    const entries = [
      ...activityEntries({ page: "job_search", elements: [searchElement, offerElement], replies: [firstReply, secondReply] }),
      ...activityEntries({ page: "profile", replies: [{ ...firstReply, seenNames: {} }] }),
    ];
    const json = JSON.stringify(entries);
    for (const id of [CARD, OTHER_CARD, CV_CARD]) expect(json).not.toContain(id);
    expect(json).not.toMatch(/"(task|outcome|provider|endpoint|cardId|id)":/);
    const unnamed = entries.at(-1)!;
    expect(unnamed.read!.map((element) => (element.kind === "object" ? element.name : null))).toEqual([null, null]);
  });
});
