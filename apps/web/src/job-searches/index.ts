/**
 * Job Searches: Job discovery the Candidate asks the AI Coach for, on demand,
 * for one of their Profiles, and the Job Offers it found, ranked by Match Score.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createJobSearches(database, deps)`:
 *    - `start` a Job Search for a Profile (from the Profile page or the Coach
 *      Panel). It counts against the Plan Quota first, then queues Job discovery
 *      for the worker. A Job Search that ends failed gives its use back;
 *    - `get` one, the `latest` done one of a Profile or the one it is `searching` for, with its results: each Job Offer found, the Match Score of the
 *      Profile's current Master CV against it, and the Application the Candidate
 *      already has for it, best Match Score first (an undated Job Offer after a
 *      dated one with an equal Match Score). Expired Job Offers are left out,
 *      even one that expired after the search;
 *    - `record` what Job discovery found (or why it could not run): the worker's
 *      side, also alone as `createJobSearchReports(database, { quotas })`, with
 *      `progress` and `expireTimedOut`, which the worker runs on a schedule. Every finished or
 *      failed Job Search keeps its metrics: what Job discovery measured (zero
 *      when it never ran) and how long the Candidate waited; and its Provenance
 *      (ADR-0034), when the run kept one: its job title variants, each source, web
 *      search, page read and summary, and its Match Scores, folded, with its wall-clock time;
 *    - `progress`: while it searches, the worker writes its live steps after each one starts
 *      and ends (the same events as the web streams'), and `notifications`, which every page
 *      polls while one is searching, gives them back (« En cours ailleurs »), until it is over.
 *    - `stop` one still searching (#331), the Candidate's own only: the worker, asking `stopRequested`
 *      as it searches, stops between two steps and the AI call on its way, and records it 'stopped'
 *      with the Job Offers found until then (a failed one keeps them too). A stop that kept no Job
 *      Offer gives its Plan Quota use back.
 *  - `migrateJobSearches(database)` creates / upgrades the table.
 * Every read is scoped to the Candidate; `start`'s input is untrusted (it comes
 * from the browser) and problems come back as results, never exceptions. A
 * search the worker never answered fails ('timeout') after SEARCH_TIMEOUT_MS,
 * when it is next read or expired, whichever comes first, and gives its use back.
 * Job Searches belong to their Profile and are deleted with it (ADR-0010); the
 * Job Offers they found are kept.
 */
import {
  noDiscoveryMetrics,
  rankByMatchScore,
  readProvenance,
  readRunProgress,
  scoreMatch,
  type Activity,
  type DiscoveryMetrics,
  type JobOffer,
  type MatchScore,
  type Provenance,
  type ProvenanceEvent,
  type ProvenanceStep,
  type WeeklyQuota,
  type SearchCriteria,
} from "@jobhub/shared";
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

/** `stopped`: the Candidate stopped it while it searched (#331); it keeps what it had found. */
export type JobSearchStatus = "searching" | "done" | "failed" | "stopped";

/** Why a Job Search failed. */
export type JobSearchFailure = "timeout" | "queue_unavailable" | "profile_unavailable" | "unavailable" | "discovery_failed" | "other";

/** One Job Offer a Job Search found. */
export interface JobSearchResult {
  jobOffer: JobOffer;
  /** The Profile's current Master CV against the Job Offer and the Profile's Search Criteria. */
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it (with any Profile). */
  applicationId: string | null;
}

/** What a finished or failed Job Search measured, to see where Job Offers are lost and what it cost. */
export interface JobSearchMetrics extends DiscoveryMetrics {
  /** From the Candidate starting it to its outcome (time to results). */
  durationMs: number;
}

export interface JobSearch {
  id: string;
  /** The Profile searched for, with the Search Criteria its Match Scores are against: its current ones. */
  profile: { id: string; name: string; searchCriteria: SearchCriteria };
  status: JobSearchStatus;
  /** Why it failed; null unless it failed. */
  failure: JobSearchFailure | null;
  startedAt: Date;
  /**
   * Best Match Score first; at an equal one, dated Job Offers before undated ones, then in the order
   * Job discovery found them. Empty while it searches; a stopped or failed one has those it had found.
   */
  results: JobSearchResult[];
  /** Null while it is searching (and for Job Searches finished before metrics were kept). */
  metrics: JobSearchMetrics | null;
  /**
   * What served it (ADR-0034): null while it is searching, when it failed before Job discovery ran, and for
   * one finished before Provenance was kept (« modèle non enregistré »).
   */
  provenance: Provenance | null;
}

export type StartJobSearchResult =
  | { ok: true; jobSearch: JobSearch }
  | { ok: false; errors: FieldError[] }
  /** No such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** Archived Profiles are set aside: restore it to search for it. */
  | { ok: false; error: "archived" }
  /** The Plan Quota of Job Searches is used up this week. */
  | { ok: false; error: "quota_exceeded"; refusal: Extract<QuotaDecision, { allowed: false }> };

/**
 * What Job discovery reported for a Job Search, with what it measured and the run's Provenance (none: it did not run):
 * the Job Offers found, or why it failed, or that the Candidate stopped it (#331), each with the Job Offers found until then.
 */
export type JobSearchOutcome = (
  | { jobOfferIds: string[] }
  | { failed: string; jobOfferIds?: string[] }
  | { stopped: true; jobOfferIds: string[] }
) & { metrics?: DiscoveryMetrics; provenance?: Provenance };

/** A Job Search still searching, with its live steps so far, for AI Activity on any page (« En cours ailleurs »). */
export interface RunningJobSearch {
  jobSearchId: string;
  profile: { id: string; name: string };
  /** ISO: the same over the poll's JSON as in the page's first render. */
  startedAt: string;
  /** Each step's latest event, in order: started, or ended in its place. None before the worker's first step. */
  steps: ProvenanceEvent[];
}

/**
 * What the Candidate is told, on any page, once a Job Search they started has
 * finished: how many Job Offers it found; or when they stopped it (« Recherche arrêtée à 10:42 »), or when it failed
 * (« Recherche échouée à 12:04 »), at which step and why, each with the Job Offers it kept (#331).
 */
export interface JobSearchNotification {
  jobSearchId: string;
  profile: { id: string; name: string };
  outcome:
    /**
     * `at`: ISO, when it was done: with its start, AI Activity's wall-clock time (« ✓ Dernière recherche · 16 s »);
     * `steps`: its Provenance's, folded (« Lecture · 12 pages lues »), the steps AI Activity shows it done with (none when it kept none).
     */
    | { status: "done"; at: string; found: number; steps: ProvenanceStep[] }
    /** `at`: ISO, when it stopped. */
    | { status: "stopped"; at: string; found: number }
    /** `at`: ISO, when it failed; `step`: the Activity of the last step that failed in its run, null when none did (or it kept no run). */
    | { status: "failed"; failure: JobSearchFailure; at: string; step: Activity | null; found: number };
}

export interface JobSearches {
  /** Starts a Job Search. `input`: { profileId }. */
  start(candidateId: string, input: unknown): Promise<StartJobSearchResult>;
  /** The Job Search, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, jobSearchId: string): Promise<JobSearch | null>;
  /** The Profile's latest done Job Search, with its results (as `get` gives them), or null. */
  latest(candidateId: string, profileId: string): Promise<JobSearch | null>;
  /** The Profile's Job Search still searching (the latest one, if several), or null. One past its time is failed first, so not given. */
  searching(candidateId: string, profileId: string): Promise<JobSearch | null>;
  /**
   * Records the outcome of Job discovery for a Job Search still searching; later reports are ignored.
   * A failure, or a stop that kept no Job Offer, gives the Job Search's Plan Quota use back, at most once per Job Search.
   */
  record(jobSearchId: string, outcome: JobSearchOutcome): Promise<void>;
  /**
   * The Candidate's Job Search notifications not dismissed yet, newest first, whether one of their Job Searches
   * is still searching (more may come), and those searching, with their live steps: what every page polls,
   * every 1.5 s while one is searching, and no more once none is.
   */
  notifications(candidateId: string): Promise<{ notifications: JobSearchNotification[]; searching: boolean; running: RunningJobSearch[] }>;
  /**
   * Asks the worker to stop the Candidate's Job Search still searching (#331): it stops between two steps, and the AI
   * call on its way, then records it 'stopped' with the Job Offers found until then. `forbidden`: another Candidate's;
   * `over`: it is no longer searching. Asking again changes nothing.
   */
  stop(candidateId: string, jobSearchId: string): Promise<StopJobSearchResult>;
  /**
   * Stops telling the Candidate about their finished Job Search (they closed the
   * notification, or opened the Job Search). Nothing for anyone else's, or one still searching.
   */
  dismissNotification(candidateId: string, jobSearchId: string): Promise<void>;
}

export type StopJobSearchResult = { ok: true } | { ok: false; error: "not_found" | "forbidden" | "over" };

/** The worker's side of Job Searches: Job discovery's reports, and the searches it never answered. */
export interface JobSearchReports extends Pick<JobSearches, "record"> {
  /** Whether the Candidate asked to stop this Job Search (#331): the worker asks while it searches. */
  stopRequested(jobSearchId: string): Promise<boolean>;
  /** Writes the live steps of a Job Search still searching (each step's latest event); nothing once it is over. */
  progress(jobSearchId: string, steps: ProvenanceEvent[]): Promise<void>;
  /**
   * Fails ('timeout') every Job Search still searching after SEARCH_TIMEOUT_MS and
   * gives each one's Plan Quota use back. Returns how many it failed.
   */
  expireTimedOut(): Promise<number>;
}

export interface JobSearchesDeps {
  profiles: Pick<Profiles, "get">;
  jobOffers: Pick<JobOffers, "get">;
  applications: Pick<Applications, "list">;
  /** The billing module's weekly quotas. */
  quotas: JobSearchQuotas;
  /** Where background jobs are queued for the worker. */
  queue: { send(name: string, data: object): Promise<void> };
  now?: () => Date;
}

/** What Job Searches need of the billing module's weekly quotas: use one to start, give it back on failure. */
export interface JobSearchQuotas {
  use(candidateId: string, quota: WeeklyQuota): Promise<QuotaDecision>;
  release(candidateId: string, quota: WeeklyQuota): Promise<void>;
}

/** Creates or upgrades the Job Search table. Run after the Profiles' and Job Offers' migrations. */
export async function migrateJobSearches(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS job_search (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'searching',
      job_offer_ids uuid[] NOT NULL DEFAULT '{}',
      failure text,
      started_at timestamptz NOT NULL,
      finished_at timestamptz
    );
    -- JobSearchMetrics, set with the outcome.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS metrics jsonb;
    -- Set when it finishes, until the Candidate dismisses its notification (or opens it).
    -- Job Searches finished before notifications existed have none.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS notification_pending boolean NOT NULL DEFAULT false;
    -- What served it (ADR-0034), set with the outcome; null: « modèle non enregistré ».
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS provenance jsonb;
    -- Its live steps while it searches (each step's latest event), written by the worker; null once it is over.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS progress jsonb;
    -- A Job Search the Candidate stopped (#331): asked at stop_requested_at, 'stopped' once the worker stops.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;
    ALTER TABLE job_search DROP CONSTRAINT IF EXISTS job_search_status_check;
    ALTER TABLE job_search ADD CONSTRAINT job_search_status_check CHECK (status IN ('searching', 'done', 'failed', 'stopped'));
    CREATE INDEX IF NOT EXISTS job_search_candidate_profile_idx ON job_search (candidate_id, profile_id, started_at DESC);
  `);
}

interface JobSearchRow {
  id: string;
  profile_id: string;
  status: JobSearchStatus;
  failure: string | null;
  job_offer_ids: string[];
  started_at: Date;
  metrics: JobSearchMetrics | null;
  provenance?: unknown;
}

/** The metrics column for an outcome reported at $at: what was measured, and the time since the Job Search started. */
const METRICS_AT = (measured: string, at: string) =>
  `${measured}::jsonb || jsonb_build_object('durationMs', round(extract(epoch FROM ${at}::timestamptz - started_at) * 1000))`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const startSchema = z.object({ profileId: z.string().trim().min(1) });

/**
 * The worker's side of Job Searches alone: recording what Job discovery found.
 * The same as `createJobSearches(...).record`, without the web app's modules.
 */
export function createJobSearchReports(
  database: Pool,
  { quotas, now = () => new Date() }: { quotas: Pick<JobSearchQuotas, "release">; now?: () => Date },
): JobSearchReports {
  return {
    async record(jobSearchId, outcome) {
      if (!UUID.test(jobSearchId)) return;
      const status: JobSearchStatus = "failed" in outcome ? "failed" : "stopped" in outcome ? "stopped" : "done";
      // A stopped or failed Job Search keeps the Job Offers it had found.
      const jobOfferIds = (outcome.jobOfferIds ?? []).filter((id) => UUID.test(id));
      // A Provenance naming an id, or of a shape this version does not know, is not kept.
      const provenance = readProvenance(outcome.provenance);
      // Only the one report that moves the Job Search out of 'searching' gets a row back.
      const { rows } = await database.query<{ candidate_id: string }>(
        `UPDATE job_search SET status = $2, job_offer_ids = $3, failure = $4, finished_at = $5, metrics = ${METRICS_AT("$6", "$5")}, notification_pending = true,
                provenance = $7::jsonb, progress = NULL
         WHERE id = $1 AND status = 'searching'
         RETURNING candidate_id`,
        [
          jobSearchId,
          status,
          jobOfferIds,
          "failed" in outcome ? outcome.failed : null,
          now(),
          JSON.stringify(outcome.metrics ?? noDiscoveryMetrics()),
          provenance ? JSON.stringify(provenance) : null,
        ],
      );
      // A failed Job Search is not counted; a stopped one only when it kept a Job Offer.
      const counted = status === "done" || (status === "stopped" && jobOfferIds.length > 0);
      if (!counted && rows[0]) await quotas.release(rows[0].candidate_id, "jobSearches");
    },
    async progress(jobSearchId, steps) {
      if (!UUID.test(jobSearchId)) return;
      // Only steps' events are written: nothing a Provenance never keeps.
      await database.query("UPDATE job_search SET progress = $2::jsonb WHERE id = $1 AND status = 'searching'", [jobSearchId, JSON.stringify(readRunProgress(steps))]);
    },
    async stopRequested(jobSearchId) {
      if (!UUID.test(jobSearchId)) return false;
      const { rows } = await database.query("SELECT 1 FROM job_search WHERE id = $1 AND stop_requested_at IS NOT NULL", [jobSearchId]);
      return rows.length > 0;
    },
    expireTimedOut: () => expireTimedOut(database, { quotas, now }),
  };
}

/**
 * Fails ('timeout') the Job Searches still searching after SEARCH_TIMEOUT_MS, every
 * Candidate's or only `candidateId`'s, and gives each one's Plan Quota use back.
 */
async function expireTimedOut(
  database: Pool,
  { quotas, now }: { quotas: Pick<JobSearchQuotas, "release">; now: () => Date },
  candidateId?: string,
): Promise<number> {
  const { rows } = await database.query<{ candidate_id: string }>(
    `UPDATE job_search SET status = 'failed', failure = 'timeout', finished_at = $1, metrics = ${METRICS_AT("$3", "$1")}, notification_pending = true, progress = NULL
     WHERE status = 'searching' AND started_at < $2 AND ($4::text IS NULL OR candidate_id = $4)
     RETURNING candidate_id`,
    [now(), new Date(now().getTime() - SEARCH_TIMEOUT_MS), JSON.stringify(noDiscoveryMetrics()), candidateId ?? null],
  );
  for (const { candidate_id } of rows) await quotas.release(candidate_id, "jobSearches");
  return rows.length;
}

export function createJobSearches(database: Pool, deps: JobSearchesDeps): JobSearches {
  const now = deps.now ?? (() => new Date());
  const { record } = createJobSearchReports(database, { quotas: deps.quotas, now });


  async function jobSearchFrom(candidateId: string, row: JobSearchRow): Promise<JobSearch | null> {
    const profile = await deps.profiles.get(candidateId, row.profile_id);
    if (!profile) return null;
    const timedOut = row.status === "searching" && now().getTime() - row.started_at.getTime() > SEARCH_TIMEOUT_MS;
    // Failing it for real (not only showing it failed) is what gives its Plan Quota use back.
    if (timedOut) {
      await record(row.id, { failed: "timeout" });
      return get(candidateId, row.id);
    }
    const status = row.status;

    let results: JobSearchResult[] = [];
    if (status !== "searching" && row.job_offer_ids.length > 0) {
      const [found, saved] = await Promise.all([
        Promise.all(row.job_offer_ids.map((id) => deps.jobOffers.get(id))),
        deps.applications.list(candidateId),
      ]);
      const applicationOf = new Map(saved.map((application) => [application.jobOffer.id, application.id]));
      results = rankByMatchScore(
        found
          // An Expired Job Offer is no longer published at its source: nothing to apply to any more.
          .filter((jobOffer): jobOffer is JobOffer => jobOffer !== null && !jobOffer.expiredAt)
          .map((jobOffer) => ({
            jobOffer,
            matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
            applicationId: applicationOf.get(jobOffer.id) ?? null,
          })),
      );
    }
    const failure = status === "failed" ? failureOf(row.failure) : null;
    return {
      id: row.id,
      profile: { id: profile.id, name: profile.name, searchCriteria: profile.searchCriteria },
      status,
      failure,
      startedAt: row.started_at,
      results,
      metrics: row.metrics,
      provenance: readProvenance(row.provenance),
    };
  }

  async function get(candidateId: string, jobSearchId: string): Promise<JobSearch | null> {
    if (!UUID.test(jobSearchId)) return null;
    const { rows } = await database.query<JobSearchRow>(
      "SELECT id, profile_id, status, failure, job_offer_ids, started_at, metrics, provenance FROM job_search WHERE id = $1 AND candidate_id = $2",
      [jobSearchId, candidateId],
    );
    return rows[0] ? jobSearchFrom(candidateId, rows[0]) : null;
  }

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
         RETURNING id, profile_id, status, failure, job_offer_ids, started_at, metrics`,
        [candidateId, profile.id, now()],
      );
      const row = rows[0]!;
      try {
        await deps.queue.send(JOB_DISCOVERY_QUEUE, { candidateId, profileId: profile.id, jobSearchId: row.id });
      } catch (error) {
        console.warn("[job-searches] could not queue Job discovery:", error instanceof Error ? error.message : error);
        await record(row.id, { failed: "queue_unavailable" });
        row.status = "failed";
        const failed = await get(candidateId, row.id);
        if (failed) return { ok: true, jobSearch: failed };
      }
      const { id, status, started_at: startedAt, metrics } = row;
      return { ok: true, jobSearch: { id, profile: { id: profile.id, name: profile.name, searchCriteria: profile.searchCriteria }, status, failure: null, startedAt, results: [], metrics, provenance: null } };
    },
    get,
    async latest(candidateId, profileId) {
      if (!UUID.test(profileId)) return null;
      const { rows } = await database.query<JobSearchRow>(
        `SELECT id, profile_id, status, job_offer_ids, started_at, metrics, provenance FROM job_search
         WHERE candidate_id = $1 AND profile_id = $2 AND status = 'done' ORDER BY started_at DESC LIMIT 1`,
        [candidateId, profileId],
      );
      return rows[0] ? jobSearchFrom(candidateId, rows[0]) : null;
    },
    async searching(candidateId, profileId) {
      if (!UUID.test(profileId)) return null;
      const { rows } = await database.query<JobSearchRow>(
        `SELECT id, profile_id, status, failure, job_offer_ids, started_at, metrics, provenance FROM job_search
         WHERE candidate_id = $1 AND profile_id = $2 AND status = 'searching' ORDER BY started_at DESC LIMIT 1`,
        [candidateId, profileId],
      );
      const jobSearch = rows[0] ? await jobSearchFrom(candidateId, rows[0]) : null;
      return jobSearch?.status === "searching" ? jobSearch : null;
    },
    record,
    async notifications(candidateId) {
      // A search the worker never answered is over: say so rather than wait on it.
      await expireTimedOut(database, { quotas: deps.quotas, now }, candidateId);
      const { rows } = await database.query<{
        id: string;
        profile_id: string;
        profile_name: string;
        status: JobSearchStatus;
        failure: string | null;
        found: number;
        started_at: Date;
        finished_at: Date | null;
        progress: unknown;
        provenance: unknown;
      }>(
        `SELECT s.id, s.profile_id, p.name AS profile_name, s.status, s.failure, s.started_at, s.finished_at, s.progress, s.provenance,
                (SELECT count(*)::int FROM job_offer o WHERE o.id = ANY (s.job_offer_ids) AND o.expired_at IS NULL) AS found
         FROM job_search s JOIN profile p ON p.id = s.profile_id
         WHERE s.candidate_id = $1 AND (s.notification_pending OR s.status = 'searching')
         ORDER BY s.finished_at DESC NULLS FIRST, s.started_at DESC`,
        [candidateId],
      );
      const notifications: JobSearchNotification[] = rows
        .filter((row) => row.status !== "searching")
        .map((row) => ({
          jobSearchId: row.id,
          profile: { id: row.profile_id, name: row.profile_name },
          outcome: outcomeOf(row),
        }));
      const running: RunningJobSearch[] = rows
        .filter((row) => row.status === "searching")
        .map((row) => ({ jobSearchId: row.id, profile: { id: row.profile_id, name: row.profile_name }, startedAt: row.started_at.toISOString(), steps: readRunProgress(row.progress) }));
      return { notifications, searching: running.length > 0, running };
    },
    async stop(candidateId, jobSearchId) {
      if (!UUID.test(jobSearchId)) return { ok: false, error: "not_found" };
      const { rowCount } = await database.query(
        "UPDATE job_search SET stop_requested_at = coalesce(stop_requested_at, $3) WHERE id = $1 AND candidate_id = $2 AND status = 'searching'",
        [jobSearchId, candidateId, now()],
      );
      if (rowCount) return { ok: true };
      const { rows } = await database.query<{ candidate_id: string }>("SELECT candidate_id FROM job_search WHERE id = $1", [jobSearchId]);
      if (!rows[0]) return { ok: false, error: "not_found" };
      return { ok: false, error: rows[0].candidate_id === candidateId ? "over" : "forbidden" };
    },
    async dismissNotification(candidateId, jobSearchId) {
      if (!UUID.test(jobSearchId)) return;
      await database.query("UPDATE job_search SET notification_pending = false WHERE id = $1 AND candidate_id = $2", [jobSearchId, candidateId]);
    },
  };
}

/** How a finished Job Search ended, as its notification tells it. */
function outcomeOf(row: { status: JobSearchStatus; failure: string | null; found: number; finished_at: Date | null; provenance: unknown }): JobSearchNotification["outcome"] {
  const { found } = row;
  const at = (row.finished_at ?? new Date(0)).toISOString();
  if (row.status === "done") return { status: "done", at, found, steps: readProvenance(row.provenance)?.steps ?? [] };
  if (row.status === "stopped") return { status: "stopped", at, found };
  const step = (readProvenance(row.provenance)?.steps ?? []).filter((ran) => ran.outcome === "failed").at(-1)?.activity ?? null;
  return { status: "failed", failure: failureOf(row.failure), at, step, found };
}

const FAILURES: readonly JobSearchFailure[] = ["timeout", "queue_unavailable", "profile_unavailable", "unavailable", "discovery_failed"];

/** The failure Job discovery reported, as one the Candidate can be told about. */
function failureOf(reported: string | null): JobSearchFailure {
  return FAILURES.find((failure) => failure === reported) ?? "other";
}
