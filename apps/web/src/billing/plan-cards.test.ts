import type { PlanQuotas } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { PlanPrice } from "./index";
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

const PLANS = [plan("free", 1, "Gratuite"), plan("standard", 2, "Standard"), plan("premium", 3, "Premium")];

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
    const plans = [plan("free", 1, "Gratuite"), { ...plan("standard", 2, "Standard"), name: { fr: "Standard", en: "Standard plan" } }];
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
    ]);
    expect(premium!.quotas.map((line) => line.value)).toEqual(["Illimité", "Illimité", "Illimité", "5 par semaine", "Illimité", "Chaque jour"]);
  });

  it("show a Plan without quotas yet with no lines rather than failing", () => {
    const plans = [...PLANS, plan("nouvelle", 4, "Nouvelle")];
    expect(planCards({ plans, current: "free", quotas: QUOTAS, prices: PRICES, locale: "fr" }).at(-1)!.quotas).toEqual([]);
  });
});
