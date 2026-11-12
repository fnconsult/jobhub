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
 *    - `live`: while it searches, the worker also writes what it has measured so far (#1001: its sources, pages read,
 *      Job Offers found, its step), kept once it is over; `live` gives it back with the Job Offers found so far (kept,
 *      once over), as the Match Score reads them, for the onboarding's search card to count those matching its criteria.
 *    - `stop` one still searching (#331), the Candidate's own only: the worker, asking `stopRequested`
 *      as it searches, stops between two steps and the AI call on its way, and records it 'stopped'
 *      with the Job Offers found until then (a failed one keeps them too). A stop that kept no Job
 *      Offer gives its Plan Quota use back.
 *    - `startOffered` the Job Search the onboarding offers a Profile it created (ADR-0106, #1000): outside the Plan
 *      Quota, so it uses none, gives none back and « Votre consommation » does not count it; once while its onboarding is
 *      in progress, and once more, a restart, when its target role or locations changed (the first is stopped by a Stop
 *      request). Each is marked on its row (`offered`: 'first' | 'restart'), one of each per Profile, held by a unique index.
 *  - `migrateJobSearches(database)` creates / upgrades the table.
 * Every read is scoped to the Candidate; `start`'s input is untrusted (it comes
 * from the browser) and problems come back as results, never exceptions. A
 * search the worker never answered fails ('timeout') after SEARCH_TIMEOUT_MS,
 * when it is next read or expired, whichever comes first, and gives its use back.
 * The Job Offers a finished, stopped or failed Job Search kept reach the Candidate's Offer box (ADR-0090, `recordArrivals`);
 * one they écarta from it is shown « Écartée » in its results (#816).
 * Job Searches belong to their Profile and are deleted with it (ADR-0010); the
 * Job Offers they found are kept.
 */
import {
  noDiscoveryMetrics,
  rankByMatchScore,
  readLiveDiscoveryMetrics,
  readProvenance,
  readRunProgress,
  scoreMatch,
  type Activity,
  type DiscoveryMetrics,
  type JobOffer,
  type LiveDiscoveryMetrics,
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
import { visibleTo, type JobOffers } from "../job-offers";
import { dismissedJobOffers, migrateOfferBox, recordArrivals } from "../offer-box";
import type { Profiles } from "../profiles";
import type { PushNotifier } from "../push-notifications";
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
  /** Écartée from the Candidate's Offer box (#816): shown « Écartée ». Always set by `get`. */
  dismissed?: boolean;
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
  /** Offered by the onboarding (ADR-0106, #1000), outside the Plan Quota: its first, or its one restart. Absent otherwise. */
  offered?: OfferedJobSearch;
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

/** A Job Search the onboarding offers (ADR-0106, #1000): the Profile's first, or its one restart. */
export type OfferedJobSearch = "first" | "restart";
export const OFFERED_JOB_SEARCHES: readonly OfferedJobSearch[] = ["first", "restart"];

export type StartOfferedJobSearchResult =
  | { ok: true; jobSearch: JobSearch; offered: OfferedJobSearch }
  /** No such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** Archived Profiles are set aside. */
  | { ok: false; error: "archived" }
  /** The Profile's onboarding is not in progress: created otherwise (the extension, a duplicate), or finished. */
  | { ok: false; error: "not_onboarding" }
  /** Its first offered Job Search and its one restart are both spent. */
  | { ok: false; error: "used_up" };

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

/**
 * A Job Search as Recherches d'offres lists it (#606): its Profile, where it stands, how many Job Offers its page shows
 * (not the Expired ones), and whether its outcome is still unseen (its Job Search Notification not dismissed): à traiter.
 */
export interface JobSearchSummary {
  id: string;
  profile: { id: string; name: string };
  status: JobSearchStatus;
  startedAt: Date;
  found: number;
  unseen: boolean;
}

export interface JobSearches {
  /** Starts a Job Search. `input`: { profileId }. */
  start(candidateId: string, input: unknown): Promise<StartJobSearchResult>;
  /**
   * Starts the Job Search the onboarding offers a Profile it created (ADR-0106, #1000), outside the Plan Quota: only while
   * the Profile's onboarding is in progress; its first, then once more at most (`restart`, for a change of its target role
   * or locations), which stops the first if it is still searching (a Stop request). `used_up` beyond.
   */
  startOffered(candidateId: string, profileId: string): Promise<StartOfferedJobSearchResult>;
  /** The Job Search, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, jobSearchId: string): Promise<JobSearch | null>;
  /** The Profile's latest done Job Search, with its results (as `get` gives them), or null. */
  latest(candidateId: string, profileId: string): Promise<JobSearch | null>;
  /** Every Job Search of the Candidate, of any Profile, most recent first (#606). One past its time is failed first. */
  list(candidateId: string): Promise<JobSearchSummary[]>;
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
  /**
   * The Candidate's Job Search as the onboarding's search card polls it (#1001), with the Job Offers found so far but
   * those in `known`; null when it is not theirs. One past its time is failed first.
   */
  live(candidateId: string, jobSearchId: string, known: readonly string[]): Promise<JobSearchLive | null>;
}

/** A Job Offer as the onboarding's search card scores it (#1001): what the Match Score reads of it, and its id. */
export type ScoredJobOffer = Pick<JobOffer, "id" | "title" | "content" | "employer" | "location" | "contractType" | "remoteWork" | "salary" | "skills" | "requiredExperienceYears">;

/**
 * A Job Search as the onboarding's search card polls it (#1001): where it stands, what its run has measured so far (null
 * before the worker's first measure, and for one run before #1001), and the Job Offers found so far (kept, once over),
 * Expired ones and those the card already has (`known`) left out.
 */
export interface JobSearchLive {
  id: string;
  status: JobSearchStatus;
  failure: JobSearchFailure | null;
  live: LiveDiscoveryMetrics | null;
  jobOffers: ScoredJobOffer[];
}

export type StopJobSearchResult = { ok: true } | { ok: false; error: "not_found" | "forbidden" | "over" };

/** The worker's side of Job Searches: Job discovery's reports, and the searches it never answered. */
export interface JobSearchReports extends Pick<JobSearches, "record"> {
  /** Whether the Candidate asked to stop this Job Search (#331): the worker asks while it searches. */
  stopRequested(jobSearchId: string): Promise<boolean>;
  /** Writes the live steps of a Job Search still searching (each step's latest event); nothing once it is over. */
  progress(jobSearchId: string, steps: ProvenanceEvent[]): Promise<void>;
  /** Writes what the run of a Job Search still searching has measured so far (#1001); nothing once it is over. */
  live(jobSearchId: string, metrics: LiveDiscoveryMetrics): Promise<void>;
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

/** Creates or upgrades the Job Search table, and the Offer box its results arrive in. Run after the Profiles' and Job Offers' migrations. */
export async function migrateJobSearches(database: Pool): Promise<void> {
  await migrateOfferBox(database);
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
    -- What its run has measured so far (#1001: sources, pages read, Job Offers found), written by the worker; kept once over.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS live jsonb;
    -- A Job Search the Candidate stopped (#331): asked at stop_requested_at, 'stopped' once the worker stops.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;
    ALTER TABLE job_search DROP CONSTRAINT IF EXISTS job_search_status_check;
    ALTER TABLE job_search ADD CONSTRAINT job_search_status_check CHECK (status IN ('searching', 'done', 'failed', 'stopped'));
    -- Offered by the onboarding (ADR-0106, #1000), outside the Plan Quota: a Profile's first, then its one restart.
    ALTER TABLE job_search ADD COLUMN IF NOT EXISTS offered text;
    ALTER TABLE job_search DROP CONSTRAINT IF EXISTS job_search_offered_check;
    ALTER TABLE job_search ADD CONSTRAINT job_search_offered_check CHECK (offered IN ('first', 'restart'));
    CREATE UNIQUE INDEX IF NOT EXISTS job_search_offered_once_idx ON job_search (profile_id, offered) WHERE offered IS NOT NULL;
    CREATE INDEX IF NOT EXISTS job_search_candidate_profile_idx ON job_search (candidate_id, profile_id, started_at DESC);
    -- The month's runs, for the Back Office Dashboard (#408).
    CREATE INDEX IF NOT EXISTS job_search_started_at_idx ON job_search (started_at);
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
  offered?: string | null;
}

/** The metrics column for an outcome reported at $at: what was measured, and the time since the Job Search started. */
const METRICS_AT = (measured: string, at: string) =>
  `${measured}::jsonb || jsonb_build_object('durationMs', round(extract(epoch FROM ${at}::timestamptz - started_at) * 1000))`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const startSchema = z.object({ profileId: z.string().trim().min(1) });

/**
 * The worker's side of Job Searches alone: recording what Job discovery found.
 * The same as `createJobSearches(...).record`, without the web app's modules. With `push`, a Job Search done with Job
 * Offers tells its Candidate of its new results by a Push notification, once (#699).
 */
export function createJobSearchReports(
  database: Pool,
  { quotas, now = () => new Date(), push }: { quotas: Pick<JobSearchQuotas, "release">; now?: () => Date; push?: PushNotifier },
): JobSearchReports {
  return {
    async record(jobSearchId, outcome) {
      if (!UUID.test(jobSearchId)) return;
      const status: JobSearchStatus = "failed" in outcome ? "failed" : "stopped" in outcome ? "stopped" : "done";
      // A stopped or failed Job Search keeps the Job Offers it had found.
      const jobOfferIds = (outcome.jobOfferIds ?? []).filter((id) => UUID.test(id));
      // A Provenance naming an id, or of a shape this version does not know, is not kept.
      const provenance = readProvenance(outcome.provenance);
      const at = now();
      // Only the one report that moves the Job Search out of 'searching' gets a row back.
      const { rows } = await database.query<{ candidate_id: string; profile_id: string; offered: string | null }>(
        `UPDATE job_search SET status = $2, job_offer_ids = $3, failure = $4, finished_at = $5, metrics = ${METRICS_AT("$6", "$5")}, notification_pending = true,
                provenance = $7::jsonb, progress = NULL
         WHERE id = $1 AND status = 'searching'
         RETURNING candidate_id, profile_id, offered`,
        [
          jobSearchId,
          status,
          jobOfferIds,
          "failed" in outcome ? outcome.failed : null,
          at,
          JSON.stringify(outcome.metrics ?? noDiscoveryMetrics()),
          provenance ? JSON.stringify(provenance) : null,
        ],
      );
      // The Job Offers it kept reach the Candidate's Offer box (ADR-0090), for its Profile.
      if (rows[0]) await recordArrivals(database, { candidateId: rows[0].candidate_id, profileId: rows[0].profile_id, source: "job_search", at, jobOfferIds });
      // A failed Job Search is not counted; a stopped one only when it kept a Job Offer. An offered one used none (#1000).
      const counted = status === "done" || (status === "stopped" && jobOfferIds.length > 0);
      if (!counted && rows[0] && !rows[0].offered) await quotas.release(rows[0].candidate_id, "jobSearches");
      // New results, the Candidate away: their devices hear of them (a stopped one, the Candidate was there).
      if (push && rows[0] && status === "done" && jobOfferIds.length > 0) {
        await push
          .notify(rows[0].candidate_id, { event: "job_search_results", jobSearchId }, { once: `job_search_results:${jobSearchId}` })
          .catch((error) => console.warn("[job-searches] the Push notification could not be queued:", error instanceof Error ? error.message : error));
      }
    },
    async progress(jobSearchId, steps) {
      if (!UUID.test(jobSearchId)) return;
      // Only steps' events are written: nothing a Provenance never keeps.
      await database.query("UPDATE job_search SET progress = $2::jsonb WHERE id = $1 AND status = 'searching'", [jobSearchId, JSON.stringify(readRunProgress(steps))]);
    },
    async live(jobSearchId, metrics) {
      if (!UUID.test(jobSearchId)) return;
      const checked = readLiveDiscoveryMetrics(metrics);
      if (!checked) return;
      await database.query("UPDATE job_search SET live = $2::jsonb WHERE id = $1 AND status = 'searching'", [jobSearchId, JSON.stringify(checked)]);
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
  const { rows } = await database.query<{ candidate_id: string; offered: string | null }>(
    `UPDATE job_search SET status = 'failed', failure = 'timeout', finished_at = $1, metrics = ${METRICS_AT("$3", "$1")}, notification_pending = true, progress = NULL
     WHERE status = 'searching' AND started_at < $2 AND ($4::text IS NULL OR candidate_id = $4)
     RETURNING candidate_id, offered`,
    [now(), new Date(now().getTime() - SEARCH_TIMEOUT_MS), JSON.stringify(noDiscoveryMetrics()), candidateId ?? null],
  );
  // An offered Job Search (#1000) used no Plan Quota: nothing to give back.
  for (const { candidate_id, offered } of rows) if (!offered) await quotas.release(candidate_id, "jobSearches");
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
      const [found, saved, dismissed] = await Promise.all([
        Promise.all(row.job_offer_ids.map((id) => deps.jobOffers.get(id, candidateId))),
        deps.applications.list(candidateId),
        database.query<{ job_offer_id: string }>(dismissedJobOffers("$1"), [candidateId]),
      ]);
      const applicationOf = new Map(saved.map((application) => [application.jobOffer.id, application.id]));
      const dismissedIds = new Set(dismissed.rows.map((one) => one.job_offer_id));
      results = rankByMatchScore(
        found
          // An Expired Job Offer is no longer published at its source: nothing to apply to any more.
          .filter((jobOffer): jobOffer is JobOffer => jobOffer !== null && !jobOffer.expiredAt)
          .map((jobOffer) => ({
            jobOffer,
            matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
            applicationId: applicationOf.get(jobOffer.id) ?? null,
            dismissed: dismissedIds.has(jobOffer.id),
          })),
      );
    }
    const failure = status === "failed" ? failureOf(row.failure) : null;
    const offered = offeredOf(row.offered);
    return {
      id: row.id,
      profile: { id: profile.id, name: profile.name, searchCriteria: profile.searchCriteria },
      status,
      failure,
      startedAt: row.started_at,
      results,
      metrics: row.metrics,
      provenance: readProvenance(row.provenance),
      ...(offered ? { offered } : {}),
    };
  }

  async function get(candidateId: string, jobSearchId: string): Promise<JobSearch | null> {
    if (!UUID.test(jobSearchId)) return null;
    const { rows } = await database.query<JobSearchRow>(
      "SELECT id, profile_id, status, failure, job_offer_ids, started_at, metrics, provenance, offered FROM job_search WHERE id = $1 AND candidate_id = $2",
      [jobSearchId, candidateId],
    );
    return rows[0] ? jobSearchFrom(candidateId, rows[0]) : null;
  }

  /** Queues Job discovery for a Job Search just inserted and gives it back as it starts (failed when it could not be queued). */
  async function queued(candidateId: string, profile: Pick<JobSearch["profile"], "id" | "name" | "searchCriteria">, row: JobSearchRow): Promise<JobSearch> {
    try {
      await deps.queue.send(JOB_DISCOVERY_QUEUE, { candidateId, profileId: profile.id, jobSearchId: row.id });
    } catch (error) {
      console.warn("[job-searches] could not queue Job discovery:", error instanceof Error ? error.message : error);
      await record(row.id, { failed: "queue_unavailable" });
      const failed = await get(candidateId, row.id);
      if (failed) return failed;
    }
    const { id, status, started_at: startedAt, metrics } = row;
    const offered = offeredOf(row.offered);
    return {
      id,
      profile: { id: profile.id, name: profile.name, searchCriteria: profile.searchCriteria },
      status,
      failure: null,
      startedAt,
      results: [],
      metrics,
      provenance: null,
      ...(offered ? { offered } : {}),
    };
  }

  async function live(candidateId: string, jobSearchId: string, known: readonly string[]): Promise<JobSearchLive | null> {
    if (!UUID.test(jobSearchId)) return null;
    const { rows } = await database.query<{ id: string; status: JobSearchStatus; failure: string | null; started_at: Date; live: unknown; job_offer_ids: string[] }>(
      "SELECT id, status, failure, started_at, live, job_offer_ids FROM job_search WHERE id = $1 AND candidate_id = $2",
      [jobSearchId, candidateId],
    );
    const row = rows[0];
    if (!row) return null;
    // A search the worker never answered is over: said failed rather than waited on.
    if (row.status === "searching" && now().getTime() - row.started_at.getTime() > SEARCH_TIMEOUT_MS) {
      await record(row.id, { failed: "timeout" });
      return live(candidateId, jobSearchId, known);
    }
    const metrics = readLiveDiscoveryMetrics(row.live);
    const ids = row.status === "searching" ? (metrics?.jobOfferIds ?? []) : row.job_offer_ids;
    const has = new Set(known);
    const found = await Promise.all(ids.filter((id) => UUID.test(id) && !has.has(id)).map((id) => deps.jobOffers.get(id, candidateId)));
    return {
      id: row.id,
      status: row.status,
      failure: row.status === "failed" ? failureOf(row.failure) : null,
      live: metrics,
      jobOffers: found.filter((jobOffer): jobOffer is JobOffer => jobOffer !== null && !jobOffer.expiredAt).map(scoredJobOffer),
    };
  }

  async function stop(candidateId: string, jobSearchId: string): Promise<StopJobSearchResult> {
    if (!UUID.test(jobSearchId)) return { ok: false, error: "not_found" };
    const { rowCount } = await database.query(
      "UPDATE job_search SET stop_requested_at = coalesce(stop_requested_at, $3) WHERE id = $1 AND candidate_id = $2 AND status = 'searching'",
      [jobSearchId, candidateId, now()],
    );
    if (rowCount) return { ok: true };
    const { rows } = await database.query<{ candidate_id: string }>("SELECT candidate_id FROM job_search WHERE id = $1", [jobSearchId]);
    if (!rows[0]) return { ok: false, error: "not_found" };
    return { ok: false, error: rows[0].candidate_id === candidateId ? "over" : "forbidden" };
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
      return { ok: true, jobSearch: await queued(candidateId, profile, rows[0]!) };
    },
    async startOffered(candidateId, profileId) {
      if (!UUID.test(profileId)) return { ok: false, error: "not_found" };
      const profile = await deps.profiles.get(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      if (profile.archived) return { ok: false, error: "archived" };
      // Only a Profile the onboarding created, while it is in progress: the offer is the onboarding's (ADR-0106).
      if (profile.onboarding !== "in_progress") return { ok: false, error: "not_onboarding" };

      const { rows: before } = await database.query<{ id: string; status: JobSearchStatus }>(
        "SELECT id, status FROM job_search WHERE profile_id = $1 AND offered IS NOT NULL ORDER BY started_at",
        [profile.id],
      );
      const offered = OFFERED_JOB_SEARCHES[before.length];
      if (!offered) return { ok: false, error: "used_up" };
      let row: JobSearchRow;
      try {
        // No Plan Quota use: « Votre consommation », which counts the Plan Quota's uses, does not count it either (ADR-0091).
        const { rows } = await database.query<JobSearchRow>(
          `INSERT INTO job_search (candidate_id, profile_id, started_at, offered) VALUES ($1, $2, $3, $4)
           RETURNING id, profile_id, status, failure, job_offer_ids, started_at, metrics, offered`,
          [candidateId, profile.id, now(), offered],
        );
        row = rows[0]!;
      } catch (error) {
        // Two calls at once: the unique index keeps one of each per Profile.
        if ((error as { code?: string }).code === "23505") return { ok: false, error: "used_up" };
        throw error;
      }
      // The restart replaces the first: still searching, it is stopped, keeping what it had found (#331).
      for (const previous of before) if (previous.status === "searching") await stop(candidateId, previous.id);
      return { ok: true, jobSearch: await queued(candidateId, profile, row), offered };
    },
    get,
    async latest(candidateId, profileId) {
      if (!UUID.test(profileId)) return null;
      const { rows } = await database.query<JobSearchRow>(
        `SELECT id, profile_id, status, job_offer_ids, started_at, metrics, provenance, offered FROM job_search
         WHERE candidate_id = $1 AND profile_id = $2 AND status = 'done' ORDER BY started_at DESC LIMIT 1`,
        [candidateId, profileId],
      );
      return rows[0] ? jobSearchFrom(candidateId, rows[0]) : null;
    },
    async list(candidateId) {
      await expireTimedOut(database, { quotas: deps.quotas, now }, candidateId);
      const { rows } = await database.query<{ id: string; profile_id: string; profile_name: string; status: JobSearchStatus; started_at: Date; found: number; unseen: boolean }>(
        `SELECT s.id, s.profile_id, p.name AS profile_name, s.status, s.started_at, s.notification_pending AND s.status <> 'searching' AS unseen,
                (SELECT count(*)::int FROM job_offer o WHERE o.id = ANY (s.job_offer_ids) AND o.expired_at IS NULL AND ${visibleTo("$1", "o")}) AS found
         FROM job_search s JOIN profile p ON p.id = s.profile_id
         WHERE s.candidate_id = $1
         ORDER BY s.started_at DESC`,
        [candidateId],
      );
      return rows.map((row) => ({
        id: row.id,
        profile: { id: row.profile_id, name: row.profile_name },
        status: row.status,
        startedAt: row.started_at,
        found: row.status === "searching" ? 0 : row.found,
        unseen: row.unseen,
      }));
    },
    async searching(candidateId, profileId) {
      if (!UUID.test(profileId)) return null;
      const { rows } = await database.query<JobSearchRow>(
        `SELECT id, profile_id, status, failure, job_offer_ids, started_at, metrics, provenance, offered FROM job_search
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
                (SELECT count(*)::int FROM job_offer o WHERE o.id = ANY (s.job_offer_ids) AND o.expired_at IS NULL AND ${visibleTo("$1", "o")}) AS found
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
    stop,
    live,
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

/** What the Match Score reads of a Job Offer, for the onboarding's search card (#1001). */
function scoredJobOffer({ id, title, content, employer, location, contractType, remoteWork, salary, skills, requiredExperienceYears }: JobOffer): ScoredJobOffer {
  return {
    id,
    title,
    content,
    ...(employer !== undefined ? { employer } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(contractType !== undefined ? { contractType } : {}),
    ...(remoteWork !== undefined ? { remoteWork } : {}),
    ...(salary !== undefined ? { salary } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(requiredExperienceYears !== undefined ? { requiredExperienceYears } : {}),
  };
}

/** The mark of an offered Job Search (#1000), or null for an ordinary one. */
function offeredOf(stored: string | null | undefined): OfferedJobSearch | null {
  return OFFERED_JOB_SEARCHES.find((offered) => offered === stored) ?? null;
}

const FAILURES: readonly JobSearchFailure[] = ["timeout", "queue_unavailable", "profile_unavailable", "unavailable", "discovery_failed"];

/** The failure Job discovery reported, as one the Candidate can be told about. */
function failureOf(reported: string | null): JobSearchFailure {
  return FAILURES.find((failure) => failure === reported) ?? "other";
}
