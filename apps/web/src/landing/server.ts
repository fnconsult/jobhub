import { FREE_PLAN } from "@jobhub/shared";
import type { Locale } from "@jobhub/shared/i18n";
import { planCards } from "@/billing/plan-cards";
import { getBilling } from "@/billing/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { landingPlans, landingStoreLinks, type LandingPlan, type LandingStoreLinks } from "./index";

/**
 * The offered Plans with their prices, read as Mon abonnement reads them. Never fails the page: when the Plans cannot
 * be read (no database, Stripe down), the landing page shows no Plan at all rather than a made-up one.
 */
export async function readLandingPlans(locale: Locale): Promise<LandingPlan[]> {
  try {
    const billing = getBilling();
    const [plans, quotas, coachContext, prices] = await Promise.all([billing.plans(), billing.planQuotas(), billing.coachContextLimits(), billing.planPrices()]);
    return landingPlans(planCards({ plans, current: FREE_PLAN, quotas, coachContext, prices, locale }));
  } catch (error) {
    console.error("[landing] the Plans could not be read", error);
    return [];
  }
}

/** The store links Paramètres sets; none of them when the Platform Settings cannot be read. */
export function readLandingStoreLinks(): LandingStoreLinks {
  try {
    return landingStoreLinks(getPlatformSettingsResolver().current());
  } catch (error) {
    console.error("[landing] the Platform Settings could not be read", error);
    return { extension: null, appStore: null, playStore: null };
  }
}
