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
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** The Match Score from which a Job Offer counts in the funnel's last stage (the Job Search target, 20 such per search). */
export const FUNNEL_MATCH_SCORE = 60;

export interface DiscoveryMetrics {
  /** How many results reached each stage, in order. */
  funnel: {
    /** Distinct URLs the web-search provider returned. */
    providerUrls: number;
    /** Result pages read. */
    fetched: number;
    /** Job Offers extracted from the pages read, before deduplication. */
    extracted: number;
    /** Results that led to a Job Offer already stored, without reading the page. */
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
}

/** The metrics of a run where Job discovery found nothing, or never ran. */
export function noDiscoveryMetrics(): DiscoveryMetrics {
  return {
    funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0, afterDedup: 0, matched: 0 },
    skipped: Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>,
    costEur: 0,
  };
}
