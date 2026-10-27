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
  /** The Target Companies' part (#406); absent for a run from before Target Companies were added. */
  targetCompanies?: TargetCompaniesMetrics;
  /** Where `costEur` went, per item (#408); absent for a run from before it was kept. Its stop reason is the Discovery run's (#404). */
  costByItem?: Record<RunCostItem, number>;
}

/**
 * How La Bonne Boite's list of Target Companies went in a run: `off` (France Travail not configured, or no Profile),
 * `kept` (fetched within the month), `searched` (fetched now), `refused` or `failed`.
 */
export type LaBonneBoiteStatus = "off" | "kept" | "searched" | "refused" | "failed";

/** The Target Companies' part of a run (#406). */
export interface TargetCompaniesMetrics {
  laBonneBoite: LaBonneBoiteStatus;
  /** HTTP calls made to France Travail for it (tokens, ROMEO, La Bonne Boite). */
  calls: number;
  /** Target Companies visited. */
  visited: number;
  /** Job Offers they gave, new or already stored, after the freshness rule. */
  offers: number;
}

/**
 * The items a run's AI cost goes to (#408): reading pages (the LLM), the plan (job title variants), the web
 * searches, and visiting the Target Companies (their web searches and the pages read from them).
 */
export const RUN_COST_ITEMS = ["page_reading", "plan", "web_search", "target_companies"] as const;
export type RunCostItem = (typeof RUN_COST_ITEMS)[number];

/** A run's switch to the fallback Search provider, by provider id and Failure Reason code. */
export interface SearchFallbackMetrics {
  from: string;
  to: string;
  reason: string;
}

/**
 * What a web search of a run was for (#404): one of the Job Search's plan's queries, a Target Company, or a Job
 * discovery site searched on purpose.
 */
export const DISCOVERY_SEARCH_KINDS = ["plan", "target_company", "site"] as const;
export type DiscoverySearchKind = (typeof DISCOVERY_SEARCH_KINDS)[number];

/** One web search of a run, as Activité › Recherches shows it (#404). */
export interface DiscoverySearch {
  kind: DiscoverySearchKind;
  /** The Job discovery site it was restricted to (`site`), or the Target Company it searched (`target_company`). */
  site?: string;
  /**
   * The query texts sent, as sent (after Redaction): built from the Search Criteria or an employer's name alone, never
   * a Candidate's name. Personal enough to be kept 30 days only, unlike the figures beside them.
   */
  queries: string[];
  /** Which page of results, from 1. */
  page: number;
  /** The Search provider that served it, by its id. */
  provider: string;
  /** Served by the fallback Search provider, once the active one failed (ADR-0043). */
  fallback: boolean;
  /** Distinct result URLs it gave. */
  results: number;
  /** Job Offers stored for the first time from the pages it led to. */
  newJobOffers: number;
  /** Its estimated cost in €: the search itself, not the pages read after it. */
  costEur: number;
}

/**
 * Why a run of Job discovery ended (#404): a limit of its Job discovery budget reached (`job_offers`, `spend`,
 * `duration`), every search done before any was (`exhausted`), the Candidate stopping it (`stopped`), or an error (`failed`).
 */
export const DISCOVERY_STOP_REASONS = ["job_offers", "spend", "duration", "exhausted", "stopped", "failed"] as const;
export type DiscoveryStopReason = (typeof DISCOVERY_STOP_REASONS)[number];

/** The metrics of a run where Job discovery found nothing, or never ran. */
export function noDiscoveryMetrics(): DiscoveryMetrics {
  return {
    funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0, afterDedup: 0, matched: 0 },
    skipped: Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>,
    costEur: 0,
  };
}
