import type { PlanQuotas } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { PlanPrice } from "./index";
import { allowsMoreCoachContext } from "./index";
import { planCards } from "./plan-cards";
import type { PlanDefinition } from "./plans";

const plan = (key: string, rank: number, fr: string, status: "offered" | "hidden" = "offered"): PlanDefinition => ({
  key,
  name: { fr, en: fr },
  rank,
  status,
  stripeProductId: key === "free" ? null : `prod_${key}`,
  features: [],
});

const PLANS = [plan("free", 1, "Gratuit"), plan("standard", 2, "Standard"), plan("premium", 3, "Premium")];

const QUOTAS: Record<string, PlanQuotas> = {
  free: { profiles: 1, matchScores: 1, atsScores: 0, enrichedContacts: 0, jobSearches: 2, jobDigest: "none" },
  standard: { profiles: 3, matchScores: null, atsScores: 5, enrichedContacts: 0, jobSearches: 5, jobDigest: "weekly" },
  premium: { profiles: null, matchScores: null, atsScores: null, enrichedContacts: 5, jobSearches: null, jobDigest: "daily" },
  essentiel: { profiles: 2, matchScores: 10, atsScores: 2, enrichedContacts: 0, jobSearches: 3, jobDigest: "weekly" },
};

const month = (amount: number): PlanPrice => ({ amount, currency: "eur", interval: "month" });
const PRICES = { free: month(0), standard: month(1900), premium: month(3900) };

const summary = (cards: ReturnType<typeof planCards>) => cards.map(({ key, current, recommended, checkout }) => ({ key, current, recommended, checkout }));

describe("the Plan comparison cards on Mon abonnement (#469)", () => {
  it("show the offered Plans in rank order; on Free, the next Plan up is « Conseillée » and the paid ones go to Checkout", () => {
    expect(summary(planCards({ plans: PLANS, current: "free", quotas: QUOTAS, prices: PRICES, locale: "fr" }))).toEqual([
      { key: "free", current: true, recommended: false, checkout: false },
      { key: "standard", current: false, recommended: true, checkout: true },
      { key: "premium", current: false, recommended: false, checkout: true },
    ]);
  });

  it("on a paid Plan, recommend the next one up, and send to no Checkout: the change is made on Stripe's page", () => {
    expect(summary(planCards({ plans: PLANS, current: "standard", quotas: QUOTAS, prices: PRICES, locale: "fr" }))).toEqual([
      { key: "free", current: false, recommended: false, checkout: false },
      { key: "standard", current: true, recommended: false, checkout: false },
      { key: "premium", current: false, recommended: true, checkout: false },
    ]);
  });

  it("recommend nothing on the highest Plan", () => {
    expect(planCards({ plans: PLANS, current: "premium", quotas: QUOTAS, prices: PRICES, locale: "fr" }).some((card) => card.recommended)).toBe(false);
  });

  it("leave a hidden Plan out, even the Candidate's, and recommend from its rank", () => {
    const plans = [...PLANS.slice(0, 2), plan("essentiel", 3, "Essentiel", "hidden"), { ...PLANS[2]!, rank: 4 }];
    const cards = planCards({ plans, current: "essentiel", quotas: QUOTAS, prices: PRICES, locale: "fr" });
    expect(summary(cards)).toEqual([
      { key: "free", current: false, recommended: false, checkout: false },
      { key: "standard", current: false, recommended: false, checkout: false },
      { key: "premium", current: false, recommended: true, checkout: false },
    ]);
  });

  it("go to Checkout only for a Plan tied to a Stripe product", () => {
    const plans = [PLANS[0]!, { ...PLANS[1]!, stripeProductId: null }, PLANS[2]!];
    expect(planCards({ plans, current: "free", quotas: QUOTAS, prices: PRICES, locale: "fr" }).map((card) => card.checkout)).toEqual([false, false, true]);
  });

  it("name each Plan in the Candidate's language, with its price, and no price when Stripe could not be read", () => {
    const plans = [plan("free", 1, "Gratuit"), { ...plan("standard", 2, "Standard"), name: { fr: "Standard", en: "Standard plan" } }];
    const [free, standard] = planCards({ plans, current: "free", quotas: QUOTAS, prices: PRICES, locale: "en" });
    expect(standard!.name).toBe("Standard plan");
    expect(standard!.price?.replace(/\s/g, " ")).toBe("€19 / month");
    expect(free!.price?.replace(/\s/g, " ")).toBe("€0 / month");
    expect(planCards({ plans, current: "free", quotas: QUOTAS, prices: null, locale: "fr" }).map((card) => card.price)).toEqual([null, null]);
  });

  it("list what each Plan includes, every quota in the comparison's order, saying which are not included", () => {
    const [free, , premium] = planCards({ plans: PLANS, current: "free", quotas: QUOTAS, prices: PRICES, locale: "fr" });
    expect(free!.quotas).toEqual([
      { quota: "profiles", label: "Profils", value: "1", included: true },
      { quota: "matchScores", label: "Match Scores", value: "1 par semaine", included: true },
      { quota: "atsScores", label: "ATS Scores", value: "Non compris", included: false },
      { quota: "enrichedContacts", label: "Contacts enrichis", value: "Non compris", included: false },
      { quota: "jobSearches", label: "Recherches d'offres", value: "2 par semaine", included: true },
      { quota: "jobDigest", label: "Job Digest", value: "Non compris", included: false },
      { quota: "coachMemory", label: "Mémoire du coach", value: "40 messages", included: true },
      { quota: "coachContextSize", label: "Contexte du coach", value: "×1", included: true },
    ]);
    expect(premium!.quotas.map((line) => line.value)).toEqual(["Illimité", "Illimité", "Illimité", "5 par semaine", "Illimité", "Chaque jour", "40 messages", "×1"]);
  });

  it("show a Plan without quotas yet with no lines rather than failing", () => {
    const plans = [...PLANS, plan("nouvelle", 4, "Nouvelle")];
    expect(planCards({ plans, current: "free", quotas: QUOTAS, prices: PRICES, locale: "fr" }).at(-1)!.quotas).toEqual([]);
  });
});

describe("the Coach context on the Plan cards (ADR-0078, #732)", () => {
  const COACH_CONTEXT = {
    free: { coachContextMessages: 20, coachContextTokens: 6_000 },
    standard: { coachContextMessages: 40, coachContextTokens: 24_000 },
    premium: { coachContextMessages: null, coachContextTokens: null },
  };
  const coachLines = (cards: ReturnType<typeof planCards>) => cards.map((card) => card.quotas.filter((line) => line.quota === "coachMemory" || line.quota === "coachContextSize").map((line) => `${line.label} : ${line.value}`));

  it("say each Plan's « Mémoire du coach » in messages and its context as a multiple of the lowest offered Plan's, « Illimité » when unlimited", () => {
    expect(coachLines(planCards({ plans: PLANS, current: "free", quotas: QUOTAS, coachContext: COACH_CONTEXT, prices: PRICES, locale: "fr" }))).toEqual([
      ["Mémoire du coach : 20 messages", "Contexte du coach : ×1"],
      ["Mémoire du coach : 40 messages", "Contexte du coach : ×4"],
      ["Mémoire du coach : Illimité", "Contexte du coach : Illimité"],
    ]);
    expect(coachLines(planCards({ plans: PLANS, current: "free", quotas: QUOTAS, coachContext: COACH_CONTEXT, prices: PRICES, locale: "en" }))[1]).toEqual([
      "Coach memory : 40 messages",
      "Coach context : ×4",
    ]);
  });

  it("measure from the lowest offered Plan, not a hidden one, and keep one decimal", () => {
    const plans = [plan("free", 1, "Gratuit", "hidden"), plan("standard", 2, "Standard"), plan("premium", 3, "Premium")];
    const coachContext = { ...COACH_CONTEXT, premium: { coachContextMessages: 60, coachContextTokens: 36_000 } };
    expect(coachLines(planCards({ plans, current: "standard", quotas: QUOTAS, coachContext, prices: PRICES, locale: "fr" }))).toEqual([
      ["Mémoire du coach : 40 messages", "Contexte du coach : ×1"],
      ["Mémoire du coach : 60 messages", "Contexte du coach : ×1,5"],
    ]);
  });

  it("never count jetons or tokens on a card", () => {
    for (const locale of ["fr", "en"] as const) {
      expect(JSON.stringify(planCards({ plans: PLANS, current: "free", quotas: QUOTAS, coachContext: COACH_CONTEXT, prices: PRICES, locale }))).not.toMatch(/tokens?|jetons?/i);
    }
  });
});

describe("a Plan that allows more Coach context (ADR-0078, #732)", () => {
  const limits = (coachContextMessages: number | null, coachContextTokens: number | null) => ({ coachContextMessages, coachContextTokens });

  it("reads more messages or holds a larger context; unlimited is more than any number, and nothing is more than unlimited", () => {
    expect(allowsMoreCoachContext(limits(40, 12_000), limits(60, 12_000))).toBe(true);
    expect(allowsMoreCoachContext(limits(40, 12_000), limits(40, 24_000))).toBe(true);
    expect(allowsMoreCoachContext(limits(40, 12_000), limits(null, 6_000))).toBe(true);
    expect(allowsMoreCoachContext(limits(40, 12_000), limits(40, 12_000))).toBe(false);
    expect(allowsMoreCoachContext(limits(40, 12_000), limits(20, 6_000))).toBe(false);
    expect(allowsMoreCoachContext(limits(null, null), limits(null, null))).toBe(false);
  });
});
