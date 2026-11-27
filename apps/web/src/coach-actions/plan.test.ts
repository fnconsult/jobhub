import { createAiLayer, createProvenanceRecorder, type ToolOutcome } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { PlanQuotas, WeeklyQuota } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { candidateObjects, type CandidateObjectSources } from "./candidate-objects";
import { createCoachActions } from "./index";
import { PLAN_READ_ID, readCoachActions } from "./reads";

// read_plan (ADR-0119 « Questions about Jobbbox », #1158): the Candidate's Plan and the week's Plan Quotas, used and left,
// with their reset date, read as « Mon abonnement » shows them (billing's entitlements), through the seam the AI Coach
// calls it by.

const ESSENTIEL: PlanQuotas = { profiles: 2, matchScores: null, atsScores: 3, enrichedContacts: 0, jobSearches: 4, jobDigest: "weekly" };
const PLANS = [
  { key: "free", name: { fr: "Gratuit", en: "Free" } },
  { key: "essentiel", name: { fr: "Essentiel", en: "Essential" } },
  { key: "premium", name: { fr: "Premium", en: "Premium" } },
];

interface Account {
  plan: string;
  quotas: PlanQuotas;
  used: Record<WeeklyQuota, number>;
  endsAt?: Date | null;
}

/** The billing module as Mon abonnement reads it, Marie's account only: anyone else is on Free, having used nothing. */
function billingOf(marie: Account): NonNullable<CandidateObjectSources["plan"]> {
  const of = (candidateId: string): Account =>
    candidateId === "marie" ? marie : { plan: "free", quotas: { ...ESSENTIEL, jobSearches: 1, atsScores: 1 }, used: { matchScores: 0, atsScores: 0, enrichedContacts: 0, jobSearches: 0 } };
  return {
    entitlements: async (candidateId: string) => {
      const account = of(candidateId);
      return { plan: account.plan, stripeStatus: null, endsAt: account.endsAt ?? null, quotas: account.quotas, usedThisWeek: account.used };
    },
    plans: async () => PLANS,
    // A quota used up, or not included: the next Plan that gives more of it, as the Upgrade Prompt names it.
    allows: async (candidateId: string, quota: WeeklyQuota) => {
      const account = of(candidateId);
      const name = PLANS.find((plan) => plan.key === account.plan)!.name;
      return { allowed: false, quota, plan: account.plan, planName: name, limit: account.quotas[quota] ?? 0, upgradeTo: "premium", upgradeToName: { fr: "Premium", en: "Premium" } };
    },
  } as unknown as NonNullable<CandidateObjectSources["plan"]>;
}

const NOTHING = { get: async () => null, list: async () => [] };

async function setUp(account: Account, { candidateId = "marie", now = new Date("2026-11-27T21:00:00Z"), plan = true } = {}) {
  const sources = {
    profiles: NOTHING,
    applications: NOTHING,
    jobSearches: NOTHING,
    jobDigests: { ...NOTHING, settings: async () => null },
    agenda: { upcoming: async () => [] },
    tailoredDocuments: NOTHING,
    tailoredCvs: NOTHING,
    companyDossiers: NOTHING,
    enrichedContacts: NOTHING,
    coachReviews: { reviews: async () => [] },
    ...(plan ? { plan: billingOf(account) } : {}),
    now: () => now,
  } as unknown as CandidateObjectSources;
  const reader = candidateObjects(sources);
  const actions = createCoachActions({ catalog: readCoachActions(reader), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
  const ai = createAiLayer({ providers: [createFakeProvider()], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
  const reply = (await actions.forReply(candidateId, { recorder: createProvenanceRecorder(ai), untrustedInView: false }))!;
  return { reply, reader, read: (): Promise<ToolOutcome> => reply.runTool({ id: "call_1", name: "read_plan", arguments: {}, round: 1 }, {}) };
}

const MARIE: Account = { plan: "essentiel", quotas: ESSENTIEL, used: { matchScores: 12, atsScores: 1, enrichedContacts: 0, jobSearches: 3 } };

describe("read_plan (ADR-0119, #1158)", () => {
  it("is a read of the Profil group that copies no text and takes no argument", async () => {
    const { reply } = await setUp(MARIE);
    const tool = reply.tools.find((each) => each.name === "read_plan");
    expect(tool?.description).toMatch(/offre.*quotas de la semaine.*remise à zéro/);
    expect(tool?.parameters).toMatchObject({ type: "object", properties: {} });
    expect(readCoachActions(candidateObjects({} as CandidateObjectSources)).find((action) => action.name === "read_plan")).toMatchObject({ group: "profile", kind: "read", copiesText: false });
  });

  it("tells the Plan's name and each weekly quota used and left, as Mon abonnement shows them, with their reset date", async () => {
    const { read } = await setUp(MARIE);

    const { content, error } = await read();

    expect(error).toBeUndefined();
    expect(content).toMatch(/^<donnees>[\s\S]*<\/donnees>$/);
    expect(content).toContain("Offre du candidat : Essentiel.");
    // Friday 27 November 2026, 22:00 in Paris: the quotas start again on Monday 30 November at midnight, Paris time.
    expect(content).toContain("Quotas de la semaine, remis à zéro le lundi 30 novembre 2026 à 0 h (heure de Paris) :");
    expect(content).toContain("- Recherches d'offres : 3 utilisés sur 4, 1 restant.");
    expect(content).toContain("- ATS Scores : 1 utilisé sur 3, 2 restants.");
    expect(content).toContain("- Match Scores : 12 utilisés, illimité.");
    // Not included in the Plan: said, with the Plan that includes it.
    expect(content).toContain("- Contacts enrichis : non compris dans son offre ; l'offre Premium les comprend.");
  });

  it("says a quota used up is reached, and which Plan gives more of it: the AI Coach proposes the change, never makes it", async () => {
    const { read } = await setUp({ ...MARIE, used: { ...MARIE.used, jobSearches: 4 } });

    const { content } = await read();

    expect(content).toContain("- Recherches d'offres : 4 utilisés sur 4, 0 restant : quota atteint ; l'offre Premium en donne plus.");
  });

  it("says until when a Plan whose cancellation is scheduled is kept", async () => {
    const { read } = await setUp({ ...MARIE, endsAt: new Date("2026-12-15T10:00:00Z") });

    expect((await read()).content).toContain("Offre du candidat : Essentiel, gardée jusqu'au 15 décembre 2026 (sa résiliation est programmée).");
  });

  it("reads the session's Candidate's Plan only, and is not_found where no billing is reached", async () => {
    const paul = await setUp(MARIE, { candidateId: "paul" });
    expect((await paul.read()).content).toContain("Offre du candidat : Gratuit.");
    expect((await paul.read()).content).not.toContain("Essentiel");

    const none = await setUp(MARIE, { plan: false });
    expect(await none.read()).toEqual({ content: JSON.stringify({ error: "not_found" }), error: true });
  });

  it("is read by its one id: any other is not found", async () => {
    const { reader } = await setUp(MARIE);
    expect(await reader.read("marie", "plan", PLAN_READ_ID, 1_500)).toMatchObject({ untrusted: false, pages: [] });
    expect(await reader.read("marie", "plan", "premium", 1_500)).toBeNull();
  });
});
