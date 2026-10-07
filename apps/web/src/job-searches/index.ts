/**
 * Job Searches: Job discovery the Candidate asks the AI Coach for, on demand,
 * for one of their Profiles, and the Job Offers it found, ranked by Match Score.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createJobSearches(database, deps)`:
 *    - `start` a Job Search for a Profile (from the Profile page or the Coach
 *      Panel). It counts against the Plan Quota first, then queues Job discovery
 *      for the worker;
 *    - `get` one, with its results: each Job Offer found, the Match Score of the
 *      Profile's current Master CV against it, and the Application the Candidate
 *      already has for it, best Match Score first;
 *    - `record` what Job discovery found (or why it could not run): the worker's
 *      side, also alone as `createJobSearchReports(database)`.
 *  - `migrateJobSearches(database)` creates / upgrades the table.
 * Every read is scoped to the Candidate; `start`'s input is untrusted (it comes
 * from the browser) and problems come back as results, never exceptions. A
 * search the worker never answered is shown as failed after SEARCH_TIMEOUT_MS.
 * Job Searches belong to their Profile and are deleted with it (ADR-0010); the
 * Job Offers they found are kept.
 */
import { scoreMatch, type JobOffer, type MatchScore, type MonthlyQuota } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Applications } from "../applications";
import type { QuotaDecision } from "../billing";
import type { JobOffers } from "../job-offers";
import type { Profiles } from "../profiles";
import { fieldErrors, type FieldError } from "../validation";

/** Queue the worker's Job discovery listens on. Data: { candidateId, profileId, jobSearchId? }. */
export const JOB_DISCOVERY_QUEUE = "job-discovery.run";

/** How long a Job Search may wait for the worker before it is shown as failed. */
export const SEARCH_TIMEOUT_MS = 15 * 60 * 1000;

export type JobSearchStatus = "searching" | "done" | "failed";

/** One Job Offer a Job Search found. */
export interface JobSearchResult {
  jobOffer: JobOffer;
  /** The Profile's current Master CV against the Job Offer and the Profile's Search Criteria. */
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it (with any Profile). */
  applicationId: string | null;
}

export interface JobSearch {
  id: string;
  profile: { id: string; name: string };
  status: JobSearchStatus;
  startedAt: Date;
  /** Best Match Score first. Empty until the search is done. */
  results: JobSearchResult[];
}

export type StartJobSearchResult =
  | { ok: true; jobSearch: JobSearch }
  | { ok: false; errors: FieldError[] }
  /** No such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** Archived Profiles are set aside: restore it to search for it. */
  | { ok: false; error: "archived" }
  /** The Plan Quota of Job Searches is used up this month. */
  | { ok: false; error: "quota_exceeded"; refusal: Extract<QuotaDecision, { allowed: false }> };

/** What Job discovery reported for a Job Search. */
export type JobSearchOutcome = { jobOfferIds: string[] } | { failed: string };

export interface JobSearches {
  /** Starts a Job Search. `input`: { profileId }. */
  start(candidateId: string, input: unknown): Promise<StartJobSearchResult>;
  /** The Job Search, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, jobSearchId: string): Promise<JobSearch | null>;
  /** Records the outcome of Job discovery for a Job Search still searching; later reports are ignored. */
  record(jobSearchId: string, outcome: JobSearchOutcome): Promise<void>;
}

export interface JobSearchesDeps {
  profiles: Pick<Profiles, "get">;
  jobOffers: Pick<JobOffers, "get">;
  applications: Pick<Applications, "list">;
  /** The billing module's monthly quotas. */
  quotas: { use(candidateId: string, quota: MonthlyQuota): Promise<QuotaDecision> };
  /** Where background jobs are queued for the worker. */
  queue: { send(name: string, data: object): Promise<void> };
  now?: () => Date;
}

/** Creates or upgrades the Job Search table. Run after the Profiles' and Job Offers' migrations. */
export async function migrateJobSearches(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS job_search (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'searching' CHECK (status IN ('searching', 'done', 'failed')),
      job_offer_ids uuid[] NOT NULL DEFAULT '{}',
      failure text,
      started_at timestamptz NOT NULL,
      finished_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS job_search_candidate_profile_idx ON job_search (candidate_id, profile_id, started_at DESC);
  `);
}

interface JobSearchRow {
  id: string;
  profile_id: string;
  status: JobSearchStatus;
  job_offer_ids: string[];
  started_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const startSchema = z.object({ profileId: z.string().trim().min(1) });

/**
 * The worker's side of Job Searches alone: recording what Job discovery found.
 * The same as `createJobSearches(...).record`, without the web app's modules.
 */
export function createJobSearchReports(database: Pool, { now = () => new Date() }: { now?: () => Date } = {}): Pick<JobSearches, "record"> {
  return {
    async record(jobSearchId, outcome) {
      if (!UUID.test(jobSearchId)) return;
      const done = "jobOfferIds" in outcome;
      await database.query(
        `UPDATE job_search SET status = $2, job_offer_ids = $3, failure = $4, finished_at = $5
         WHERE id = $1 AND status = 'searching'`,
        [jobSearchId, done ? "done" : "failed", done ? outcome.jobOfferIds.filter((id) => UUID.test(id)) : [], done ? null : outcome.failed, now()],
      );
    },
  };
}

export function createJobSearches(database: Pool, deps: JobSearchesDeps): JobSearches {
  const now = deps.now ?? (() => new Date());

  async function jobSearchFrom(candidateId: string, row: JobSearchRow): Promise<JobSearch | null> {
    const profile = await deps.profiles.get(candidateId, row.profile_id);
    if (!profile) return null;
    const timedOut = row.status === "searching" && now().getTime() - row.started_at.getTime() > SEARCH_TIMEOUT_MS;
    const status = timedOut ? "failed" : row.status;

    let results: JobSearchResult[] = [];
    if (status === "done" && row.job_offer_ids.length > 0) {
      const [found, saved] = await Promise.all([
        Promise.all(row.job_offer_ids.map((id) => deps.jobOffers.get(id))),
        deps.applications.list(candidateId),
      ]);
      const applicationOf = new Map(saved.map((application) => [application.jobOffer.id, application.id]));
      results = found
        .filter((jobOffer): jobOffer is JobOffer => jobOffer !== null)
        .map((jobOffer) => ({
          jobOffer,
          matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
          applicationId: applicationOf.get(jobOffer.id) ?? null,
        }))
        // Stable: equal Match Scores keep the order Job discovery found them in.
        .sort((a, b) => b.matchScore.score - a.matchScore.score);
    }
    return { id: row.id, profile: { id: profile.id, name: profile.name }, status, startedAt: row.started_at, results };
  }

  async function get(candidateId: string, jobSearchId: string): Promise<JobSearch | null> {
    if (!UUID.test(jobSearchId)) return null;
    const { rows } = await database.query<JobSearchRow>(
      "SELECT id, profile_id, status, job_offer_ids, started_at FROM job_search WHERE id = $1 AND candidate_id = $2",
      [jobSearchId, candidateId],
    );
    return rows[0] ? jobSearchFrom(candidateId, rows[0]) : null;
  }

  const { record } = createJobSearchReports(database, { now });

  return {
    async start(candidateId, input) {
      const parsed = startSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { profileId } = parsed.data;
      const profile = await deps.profiles.get(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      if (profile.archived) return { ok: false, error: "archived" };

      const decision = await deps.quotas.use(candidateId, "jobSearches");
      if (!decision.allowed) return { ok: false, error: "quota_exceeded", refusal: decision };

      const { rows } = await database.query<JobSearchRow>(
        `INSERT INTO job_search (candidate_id, profile_id, started_at) VALUES ($1, $2, $3)
         RETURNING id, profile_id, status, job_offer_ids, started_at`,
        [candidateId, profile.id, now()],
      );
      const row = rows[0]!;
      try {
        await deps.queue.send(JOB_DISCOVERY_QUEUE, { candidateId, profileId: profile.id, jobSearchId: row.id });
      } catch (error) {
        console.warn("[job-searches] could not queue Job discovery:", error instanceof Error ? error.message : error);
        await record(row.id, { failed: "queue_unavailable" });
        row.status = "failed";
      }
      return { ok: true, jobSearch: { id: row.id, profile: { id: profile.id, name: profile.name }, status: row.status, startedAt: row.started_at, results: [] } };
    },
    get,
    record,
  };
}
