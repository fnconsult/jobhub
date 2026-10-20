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
 * A search never throws: a refusal (the key rejected, the quota or the rate limit
 * reached: 401, 402, 403, 429) or any other failure is an outcome Job discovery
 * counts and goes on without. What the API looks like is kept in ./api.ts.
 */
import type { JobOfferDetails, SearchCriteria } from "@jobhub/shared";
import { DEFAULT_API_URL, readJobs, searchParams } from "./api";

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

export interface FantasticJobsOptions {
  apiKey: string;
  /** Default: https://data.fantastic.jobs/v1 (FANTASTIC_JOBS_API_URL overrides it for the e2e fake). */
  apiUrl?: string;
  /** The estimated € of each job returned. Default: DEFAULT_EUR_PER_JOB. */
  eurPerJob?: number;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: 15 s; a search can take several seconds. */
  timeoutMs?: number;
}

/** Statuses by which Fantastic.jobs refuses us rather than fails: the key rejected, the quota or the rate limit reached. */
const REFUSED = new Set([401, 402, 403, 429]);

class Refused extends Error {}

export function createFantasticJobs(options: FantasticJobsOptions): FantasticJobs {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const eurPerJob = options.eurPerJob ?? DEFAULT_EUR_PER_JOB;
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");

  return {
    async search(criteria, { max, now, location }) {
      let calls = 0;
      try {
        calls++;
        const answer = await fetch(`${apiUrl}/active-ats?${searchParams(criteria, location === undefined ? { max, now } : { max, now, location })}`, {
          headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (REFUSED.has(answer.status)) throw new Refused(`active-ats refused (${answer.status})`);
        if (!answer.ok) throw new Error(`active-ats answered ${answer.status}`);
        const jobs: unknown = await answer.json();
        const charged = Number(answer.headers.get("x-api-jobs-this-request"));
        const returned = Array.isArray(jobs) ? jobs.length : 0;
        const costEur = (answer.headers.has("x-api-jobs-this-request") && Number.isFinite(charged) ? charged : returned) * eurPerJob;
        return { ok: true, offers: readJobs(jobs), calls, costEur: Math.round(costEur * 1e6) / 1e6 };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: error instanceof Refused ? "refused" : "failed", detail, calls };
      }
    },
  };
}

/** Fantastic.jobs from FANTASTIC_JOBS_API_KEY (and FANTASTIC_JOBS_API_URL, FANTASTIC_JOBS_EUR_PER_JOB), or null without a key. */
export function fantasticJobsFromEnv(
  env: Record<string, string | undefined>,
  options: Omit<FantasticJobsOptions, "apiKey" | "apiUrl" | "eurPerJob"> = {},
): FantasticJobs | null {
  const apiKey = env.FANTASTIC_JOBS_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = env.FANTASTIC_JOBS_API_URL?.trim();
  const eurPerJob = Number(env.FANTASTIC_JOBS_EUR_PER_JOB?.trim() || NaN);
  return createFantasticJobs({ ...options, apiKey, ...(apiUrl && { apiUrl }), ...(Number.isFinite(eurPerJob) && eurPerJob >= 0 && { eurPerJob }) });
}
