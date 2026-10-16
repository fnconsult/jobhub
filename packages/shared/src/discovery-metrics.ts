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
 * How France Travail's search went in a run: `off` (not configured), `searched`,
 * `refused` (France Travail turned us away: access withdrawn or not granted) or `failed`.
 */
export const FRANCE_TRAVAIL_STATUSES = ["off", "searched", "refused", "failed"] as const;
export type FranceTravailStatus = (typeof FRANCE_TRAVAIL_STATUSES)[number];

/** France Travail's part of a run. Its offers are also counted in the funnel, as extracted or already stored. */
export interface FranceTravailMetrics {
  status: FranceTravailStatus;
  /** Job Offers it gave, new or already stored, after the freshness rule. */
  offers: number;
  /** HTTP calls made to it: a token when needed, and the search. */
  calls: number;
}

export interface DiscoveryMetrics {
  /** How many results reached each stage, in order. */
  funnel: {
    /** Distinct URLs the web-search provider returned, as sources or named in its answer. */
    providerUrls: number;
    /** Result pages read, the postings followed from listing pages included. */
    fetched: number;
    /** Job Offers extracted from the pages read (and France Travail's offers), before deduplication. */
    extracted: number;
    /** Results (and France Travail's offers) that led to a Job Offer already stored, without reading the page. */
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
}

/** The metrics of a run where Job discovery found nothing, or never ran. */
export function noDiscoveryMetrics(): DiscoveryMetrics {
  return {
    funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0, afterDedup: 0, matched: 0 },
    skipped: Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>,
    costEur: 0,
  };
}
