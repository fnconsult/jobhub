/**
 * Fantastic.jobs: searching its `active-ats` API, the postings of employers' own
 * career pages (their ATS), for those matching a Profile's Search Criteria, each
 * at its ATS page with its posting date as its Posting date (#243).
 *
 *   const fantasticJobs = fantasticJobsFromEnv(process.env); // null: no key, Job discovery goes without it
 *   const result = await fantasticJobs.search(criteria, { max: 30, now, location: "Lyon" });
 *   // { ok: true, offers: [{ url, details }], calls, costEur } | { ok: false, reason: "refused" | "failed", detail, calls }
 *
 * Runs only with FANTASTIC_JOBS_API_KEY set (a Provider Secret). Every job it returns
 * is charged (one Jobs credit) and every call too (one API request, a hard limit):
 * a search asks for no more jobs than wanted, and states their estimated cost
 * (`costEur`), from the count Fantastic.jobs charged (`x-api-jobs-this-request`).
 * A search asks for no more than `maxPerSearch` jobs (FANTASTIC_JOBS_MAX_PER_SEARCH,
 * default 10), whatever the Job discovery budget has left, so that a plan's Jobs
 * credits last (the trial's 500: ~50 searches rather than ~16), nor more than the
 * credits left. Job discovery makes one search a run, at its first location (ADR-0031).
 *
 * Quota guard (ADR-0031): the client keeps the last quotas an answer stated (`x-api-jobs-remaining`,
 * `x-api-requests-remaining`). Once either is spent, or Fantastic.jobs answered 402
 * or 429, a search makes no call and is refused (`calls: 0`) until the quota is
 * renewed: the next billing date stated (`x-api-next-billing-date`), the wait a 429
 * asked for (`retry-after`), else QUOTA_HOLD_MS. A key replaced builds a new client,
 * whose quotas are read again. The API requests are a hard limit: calling on with
 * none left would only be turned away.
 *
 * A search never throws: a refusal (the key rejected, the quota or the rate limit
 * reached: 401, 402, 403, 429, or the quota guard) or any other failure is an outcome
 * Job discovery counts and goes on without. What the API looks like is kept in ./api.ts.
 */
import type { JobOfferDetails, SearchCriteria } from "@jobhub/shared";
import { DEFAULT_API_URL, readJobs, readUsage, searchParams, type Usage } from "./api";

export interface FantasticJobsOffer {
  /** The posting's page at its ATS (the employer's career site). */
  url: string;
  /** The posting, its Posting date (`postedAt`) the one Fantastic.jobs states. */
  details: JobOfferDetails;
}

export type FantasticJobsSearch =
  | { ok: true; offers: FantasticJobsOffer[]; calls: number; costEur: number }
  /** `refused`: the key was rejected or the quota is spent; `failed`: anything else went wrong. */
  | { ok: false; reason: "refused" | "failed"; detail: string; calls: number };

export interface FantasticJobs {
  /** Fantastic.jobs' first `max` jobs for the Search Criteria near `location` (one of theirs, the first by default), posted in the last 30 days at `now`. Never throws. */
  search(criteria: SearchCriteria, options: { max: number; now: Date; location?: string }): Promise<FantasticJobsSearch>;
}

/**
 * The estimated € of one job returned: its $45 plan's 5,000 Jobs credits a month (fantastic.jobs/api,
 * 2026-10-20), about $0.009 a job, in euros. Its API requests come with the plan.
 */
export const DEFAULT_EUR_PER_JOB = 0.008;

/** The most jobs one search asks for by default: the trial's 500 Jobs credits then last ~50 searches (#243). */
export const DEFAULT_MAX_PER_SEARCH = 10;

/** How long a spent quota holds the calls back when no renewal date (or 429 wait) was stated: a day. */
export const QUOTA_HOLD_MS = 24 * 60 * 60 * 1000;

export interface FantasticJobsOptions {
  apiKey: string;
  /** Default: https://data.fantastic.jobs/v1 (FANTASTIC_JOBS_API_URL overrides it for the e2e fake). */
  apiUrl?: string;
  /** The estimated € of each job returned. Default: DEFAULT_EUR_PER_JOB. */
  eurPerJob?: number;
  /** The most jobs one search asks for (each is charged). Default: DEFAULT_MAX_PER_SEARCH. */
  maxPerSearch?: number;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: 15 s; a search can take several seconds. */
  timeoutMs?: number;
}

/** Statuses by which Fantastic.jobs refuses us rather than fails: the key rejected, the quota or the rate limit reached. */
const REFUSED = new Set([401, 402, 403, 429]);
/** Of those, the ones by which a quota is spent: no call until it is renewed. */
const QUOTA_SPENT = new Set([402, 429]);

class Refused extends Error {}

export function createFantasticJobs(options: FantasticJobsOptions): FantasticJobs {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const eurPerJob = options.eurPerJob ?? DEFAULT_EUR_PER_JOB;
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const maxPerSearch = options.maxPerSearch ?? DEFAULT_MAX_PER_SEARCH;
  /** The quotas the last answers stated, and until when a spent one holds the calls back (ms). */
  let usage: Usage = {};
  let heldUntil: number | null = null;
  const hold = (at: number, retryAfterMs?: number) => {
    const renewal = usage.nextBillingDate?.getTime();
    heldUntil = retryAfterMs !== undefined ? at + retryAfterMs : renewal !== undefined && renewal > at ? renewal : at + QUOTA_HOLD_MS;
  };

  return {
    async search(criteria, { max, now, location }) {
      const at = now.getTime();
      if (heldUntil !== null) {
        if (at < heldUntil) return { ok: false, reason: "refused", detail: `quota spent: no call until ${new Date(heldUntil).toISOString()}`, calls: 0 };
        // Renewed: what was read of the spent quota no longer holds.
        heldUntil = null;
        usage = {};
      }
      const limit = Math.min(max, maxPerSearch, usage.jobsRemaining ?? Infinity);
      let calls = 0;
      try {
        calls++;
        const answer = await fetch(`${apiUrl}/active-ats?${searchParams(criteria, location === undefined ? { max: limit, now } : { max: limit, now, location })}`, {
          headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const read = readUsage(answer.headers, now);
        usage = { ...usage, ...read };
        if (QUOTA_SPENT.has(answer.status)) hold(at, answer.status === 429 ? read.retryAfterMs : undefined);
        else if ((usage.jobsRemaining ?? 1) <= 0 || (usage.requestsRemaining ?? 1) <= 0) hold(at);
        if (REFUSED.has(answer.status)) throw new Refused(`active-ats refused (${answer.status})`);
        if (!answer.ok) throw new Error(`active-ats answered ${answer.status}`);
        const jobs: unknown = await answer.json();
        // Without the count charged, every job returned is.
        const costEur = chargedCostEur(answer.headers, eurPerJob) ?? eurOf(Array.isArray(jobs) ? jobs.length : 0, eurPerJob);
        return { ok: true, offers: readJobs(jobs), calls, costEur };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: error instanceof Refused ? "refused" : "failed", detail, calls };
      }
    },
  };
}

const eurOf = (jobs: number, eurPerJob: number) => Math.round(jobs * eurPerJob * 1e6) / 1e6;

/** The estimated € of the jobs an answer says it charged (`x-api-jobs-this-request`); null when it does not say. */
export function chargedCostEur(headers: Headers, eurPerJob: number = DEFAULT_EUR_PER_JOB): number | null {
  const charged = Number(headers.get("x-api-jobs-this-request") ?? NaN);
  return Number.isFinite(charged) && charged >= 0 ? eurOf(charged, eurPerJob) : null;
}

/** The estimated € of a job: FANTASTIC_JOBS_EUR_PER_JOB (the plan's price), else DEFAULT_EUR_PER_JOB. */
export function eurPerJobFromEnv(env: Record<string, string | undefined>): number {
  const eurPerJob = Number(env.FANTASTIC_JOBS_EUR_PER_JOB?.trim() || NaN);
  return Number.isFinite(eurPerJob) && eurPerJob >= 0 ? eurPerJob : DEFAULT_EUR_PER_JOB;
}

/** The most jobs one search asks for: FANTASTIC_JOBS_MAX_PER_SEARCH (a positive whole number), else DEFAULT_MAX_PER_SEARCH. */
export function maxPerSearchFromEnv(env: Record<string, string | undefined>): number {
  const max = Number(env.FANTASTIC_JOBS_MAX_PER_SEARCH?.trim() || NaN);
  return Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_PER_SEARCH;
}

/**
 * Fantastic.jobs from FANTASTIC_JOBS_API_KEY (and FANTASTIC_JOBS_API_URL, FANTASTIC_JOBS_EUR_PER_JOB,
 * FANTASTIC_JOBS_MAX_PER_SEARCH), or null without a key.
 */
export function fantasticJobsFromEnv(
  env: Record<string, string | undefined>,
  options: Omit<FantasticJobsOptions, "apiKey" | "apiUrl" | "eurPerJob" | "maxPerSearch"> = {},
): FantasticJobs | null {
  const apiKey = env.FANTASTIC_JOBS_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = env.FANTASTIC_JOBS_API_URL?.trim();
  return createFantasticJobs({ ...options, apiKey, ...(apiUrl && { apiUrl }), eurPerJob: eurPerJobFromEnv(env), maxPerSearch: maxPerSearchFromEnv(env) });
}
