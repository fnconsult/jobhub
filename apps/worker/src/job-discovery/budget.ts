import { SEARCH_TIMEOUT_MS } from "@jobhub/web/job-searches";

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

export const DEFAULT_BUDGET: JobDiscoveryBudget = { jobOffers: 30, spendEur: 0.08, seconds: 90 };

/**
 * The longest run allowed: 5 minutes inside the 15-minute Job Search timeout, which
 * stays the safety net, for the page being read when time runs out and for scoring.
 */
const MAX_SECONDS = SEARCH_TIMEOUT_MS / 1000 - 5 * 60;

/** The budget from JOB_DISCOVERY_BUDGET_JOB_OFFERS, _EUR and _SECONDS; an unset or empty one keeps its default. */
export function jobDiscoveryBudgetFromEnv(env: Record<string, string | undefined>): JobDiscoveryBudget {
  const read = (name: string, fallback: number, { whole, max }: { whole: boolean; max: number }) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > max || (whole && !Number.isInteger(value))) {
      throw new Error(`${name} must be a ${whole ? "whole " : ""}number above 0, up to ${max} (got "${raw}")`);
    }
    return value;
  };
  return {
    jobOffers: read("JOB_DISCOVERY_BUDGET_JOB_OFFERS", DEFAULT_BUDGET.jobOffers, { whole: true, max: 1000 }),
    spendEur: read("JOB_DISCOVERY_BUDGET_EUR", DEFAULT_BUDGET.spendEur, { whole: false, max: 10 }),
    seconds: read("JOB_DISCOVERY_BUDGET_SECONDS", DEFAULT_BUDGET.seconds, { whole: true, max: MAX_SECONDS }),
  };
}
