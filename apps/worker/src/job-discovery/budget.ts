import { readNumberSetting } from "@jobhub/web/platform-settings";

/**
 * When a Job discovery run stops reading result pages: once it has this many Job
 * Offers, has spent this much on AI calls, or has run this long, whichever comes
 * first. It is checked before each web search and each page, so the page being read when a limit is
 * reached is finished.
 */
export interface JobDiscoveryBudget {
  /** Job Offers found, new or already stored. */
  jobOffers: number;
  /** Estimated cost in € of the run's AI calls, the web searches included. */
  spendEur: number;
  /** Time since the run started, the web searches included. */
  seconds: number;
}

/** The budget from JOB_DISCOVERY_BUDGET_JOB_OFFERS, _EUR and _SECONDS (Platform Settings: their bounds and defaults are the catalog's); an unset or empty one keeps its default. */
export function jobDiscoveryBudgetFromEnv(env: Record<string, string | undefined>): JobDiscoveryBudget {
  return {
    jobOffers: readNumberSetting(env, "JOB_DISCOVERY_BUDGET_JOB_OFFERS"),
    spendEur: readNumberSetting(env, "JOB_DISCOVERY_BUDGET_EUR"),
    seconds: readNumberSetting(env, "JOB_DISCOVERY_BUDGET_SECONDS"),
  };
}

/** The code's defaults (the Platform Settings catalog's, ADR-0033). */
export const DEFAULT_BUDGET: JobDiscoveryBudget = jobDiscoveryBudgetFromEnv({});
