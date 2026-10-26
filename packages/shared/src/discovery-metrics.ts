/**
 * What one run of Job discovery measured, kept with the Job Search (or logged
 * for the Job Digest) it ran for, to see where Job Offers are lost and what a
 * search costs.
 */

/** Why a result page gave no Job Offer: refused before reading it (ADR-0002), or what reading it gave. */
export const SKIP_REASONS = [
  "robots",
  "site_terms",
  "bot_protection",
  "login_wall",
  "not_public",
  "gone",
  "unreachable",
  "not_a_job_offer",
  "invalid",
  "too_old",
  "site_disabled",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** The Match Score from which a Job Offer counts in the funnel's last stage (the Job Search target, 20 such per search). */
export const FUNNEL_MATCH_SCORE = 60;

/**
 * How a job API's search (France Travail, Fantastic.jobs) went in a run: `off` (not configured,
 * or its source disabled), `searched`, `refused` (it turned us away: access withdrawn or not
 * granted, the key rejected, the quota spent) or `failed`.
 */
export const JOB_API_STATUSES = ["off", "searched", "refused", "failed"] as const;
export type JobApiStatus = (typeof JOB_API_STATUSES)[number];
export const FRANCE_TRAVAIL_STATUSES = JOB_API_STATUSES;
export type FranceTravailStatus = JobApiStatus;

/** France Travail's part of a run. Its offers are also counted in the funnel, as extracted or already stored. */
export interface FranceTravailMetrics {
  status: FranceTravailStatus;
  /** Job Offers it gave, new or already stored, after the freshness rule. */
  offers: number;
  /** HTTP calls made to it: a token when needed, and the search. */
  calls: number;
}

/** Fantastic.jobs' part of a run (#243). Its offers are also counted in the funnel, as extracted or already stored. */
export interface FantasticJobsMetrics {
  status: JobApiStatus;
  /** Job Offers it gave, new or already stored, after the freshness rule. */
  offers: number;
  /** Calls made to it: one search per location. */
  calls: number;
  /** Estimated cost in € of the jobs it returned (each one charged), kept apart from the AI calls' `costEur`. */
  costEur: number;
}

export interface DiscoveryMetrics {
  /** How many results reached each stage, in order. */
  funnel: {
    /** Distinct URLs the web-search provider returned, as sources or named in its answer. */
    providerUrls: number;
    /** Result pages read, the postings followed from listing pages included. */
    fetched: number;
    /** Job Offers extracted from the pages read (and the job APIs' offers), before deduplication. */
    extracted: number;
    /** Results (and the job APIs' offers) that led to a Job Offer already stored, without reading the page. */
    alreadyStored: number;
    /** Distinct Job Offers found, new or already stored. */
    afterDedup: number;
    /** Of those, the ones whose Match Score against the Profile is FUNNEL_MATCH_SCORE or more. */
    matched: number;
  };
  /** Result pages that gave no Job Offer, by reason; every reason is listed, 0 when none. */
  skipped: Record<SkipReason, number>;
  /** Estimated cost in € of the AI calls: the web search (tokens and fee) and the LLM reading pages. */
  costEur: number;
  /** France Travail's part; absent for a run that never searched (or ran before France Travail was added). */
  franceTravail?: FranceTravailMetrics;
  /** Fantastic.jobs' part; absent for a run from before Fantastic.jobs was added. */
  fantasticJobs?: FantasticJobsMetrics;
  /**
   * The run's switch to the fallback Search provider (ADR-0043): from which provider, to which, and the Failure
   * Reason that made it switch. Null when it did not; absent for a run from before the fallback.
   */
  searchFallback?: SearchFallbackMetrics | null;
}

/** A run's switch to the fallback Search provider, by provider id and Failure Reason code. */
export interface SearchFallbackMetrics {
  from: string;
  to: string;
  reason: string;
}

/** The metrics of a run where Job discovery found nothing, or never ran. */
export function noDiscoveryMetrics(): DiscoveryMetrics {
  return {
    funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0, afterDedup: 0, matched: 0 },
    skipped: Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>,
    costEur: 0,
  };
}
