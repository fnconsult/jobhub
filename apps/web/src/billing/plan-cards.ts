import { FREE_PLAN, LIMITED_QUOTAS, type Plan, type PlanQuotas } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { PlanPrice } from "./index";
import { planPriceLabel } from "./plan-price";
import type { PlanDefinition } from "./plans";
import { planQuotaValue } from "./quota-labels";

/** The quotas a card lists, in the comparison's order: the limited ones, then the Job Digest. */
const CARD_QUOTAS = [...LIMITED_QUOTAS, "jobDigest"] as const satisfies readonly (keyof PlanQuotas)[];

/** One line of a Plan's card: a quota and what the Plan gives of it (« 1 par semaine », « Illimité », « Non compris »). */
export interface PlanCardQuota {
  quota: keyof PlanQuotas;
  label: string;
  value: string;
  /** False when the Plan does not include it at all: the line is drawn as missing. */
  included: boolean;
}

/** One offered Plan as Mon abonnement compares it (#469). */
export interface PlanCard {
  key: Plan;
  /** In the Candidate's Interface Language. */
  name: string;
  /** « 19 € / mois »; null when Stripe's prices could not be read. */
  price: string | null;
  quotas: PlanCardQuota[];
  /** The Candidate's Plan: « Votre offre ». */
  current: boolean;
  /** « Conseillée »: the lowest-ranked offered Plan above the Candidate's, as an Upgrade Prompt would name it. */
  recommended: boolean;
  /** Chosen through Stripe Checkout: only from Free, for a paid Plan tied to a Stripe product. A paid Plan changes on Stripe's page. */
  checkout: boolean;
}

/**
 * The Plan comparison cards (#469): the offered Plans in rank order (a hidden Plan is never compared, even the
 * Candidate's), each with its price and what it includes, which one is the Candidate's, the one recommended above it,
 * and whether choosing it goes to Checkout. `plans` is every Plan, `current` the Candidate's, `quotas` each Plan's.
 */
export function planCards({
  plans,
  current,
  quotas,
  prices,
  locale,
}: {
  plans: readonly PlanDefinition[];
  current: Plan;
  quotas: Record<Plan, PlanQuotas>;
  prices: Record<Plan, PlanPrice> | null;
  locale: Locale;
}): PlanCard[] {
  const { t } = createI18n(locale);
  const offered = [...plans].filter((each) => each.status === "offered").sort((a, b) => a.rank - b.rank);
  const rank = plans.find((each) => each.key === current)?.rank ?? 0;
  const recommended = offered.find((each) => each.rank > rank)?.key;
  return offered.map((each) => {
    const planQuotas = quotas[each.key];
    const price = prices?.[each.key];
    return {
      key: each.key,
      name: each.name[locale],
      price: price ? planPriceLabel(price, locale) : null,
      quotas: planQuotas
        ? CARD_QUOTAS.map((quota) => ({
            quota,
            label: t(`billing.quotas.${quota}`),
            value: planQuotaValue(t, quota, planQuotas),
            included: quota === "jobDigest" ? planQuotas.jobDigest !== "none" : planQuotas[quota] !== 0,
          }))
        : [],
      current: each.key === current,
      recommended: each.key === recommended,
      checkout: current === FREE_PLAN && each.key !== FREE_PLAN && each.stripeProductId !== null,
    };
  });
}
