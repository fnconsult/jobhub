/**
 * Job discovery runs (#404, ADR-0042): every run of Job discovery, for a Job Search or a Job Digest top-up, as
 * Activité › Recherches shows it. One deep module in front of Postgres:
 *
 *   const runs = createDiscoveryRuns(database, { backOffice });
 *   await runs.record(run);           // the worker, once a run ends (failed or stopped ones too)
 *   await runs.list(query);           // newest first, filtered by trigger, period and fallback (untrusted input)
 *   await runs.get(id);               // one run, its Discovery metrics and each search
 *   await runs.openJobSearch(admin, id)  // the Job Search behind it, the view written to the Back Office Audit
 *
 * A run is kept in two parts, each with its own retention:
 *  - its figures (when, trigger, duration, stop reason, Discovery metrics, and per search its kind, site, page,
 *    provider, fallback, results, new Job Offers and cost) name no one and are kept RETENTION_MONTHS;
 *  - what ties it to a Candidate (their Profile, its Search Criteria, the query texts sent and the Job Search) is kept
 *    QUERY_RETENTION_DAYS, is in the Candidate's Data export (`discoveryRunsOf`) and goes with their account or Profile.
 * `purgeExpiredDiscoveryRuns` applies both, nightly.
 *
 * The Profile is shown by a pseudonym, the same for each of its runs: never the Candidate's name or email.
 */
import { createHash } from "node:crypto";
import {
  DISCOVERY_SEARCH_KINDS,
  DISCOVERY_STOP_REASONS,
  type DiscoveryMetrics,
  type DiscoverySearch,
  type DiscoveryStopReason,
  type SearchCriteria,
  type SearchFallbackMetrics,
} from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { BackOffice, BackOfficeActor } from "../admin/back-office";

/** How long a run's query texts, criteria and link to its Job Search are kept. */
export const QUERY_RETENTION_DAYS = 30;
/** How long a run's figures are kept. */
export const RETENTION_MONTHS = 24;
/** How many runs the list shows at most. */
export const LIST_LIMIT = 200;

/** What started a run: a Job Search, or a Job Digest topping up its Job Offers. */
export const DISCOVERY_RUN_TRIGGERS = ["job_search", "job_digest"] as const;
export type DiscoveryRunTrigger = (typeof DISCOVERY_RUN_TRIGGERS)[number];

/** The periods the list is filtered by: today (Paris), the last 7 or 30 days, or everything kept. */
export const DISCOVERY_RUN_PERIODS = ["today", "7d", "30d", "all"] as const;
export type DiscoveryRunPeriod = (typeof DISCOVERY_RUN_PERIODS)[number];
export const DEFAULT_PERIOD: DiscoveryRunPeriod = "7d";

/** One run, as the worker records it when it ends. */
export interface DiscoveryRunRecord {
  trigger: DiscoveryRunTrigger;
  startedAt: Date;
  /** From its start to its end, as the Candidate waited (a Job Search's) or the worker ran it. */
  durationMs: number;
  candidateId: string;
  profileId: string;
  /** The Job Search it ran for; null for a Job Digest's. */
  jobSearchId: string | null;
  /** The Search Criteria it searched with. */
  criteria: SearchCriteria;
  metrics: DiscoveryMetrics;
  stopReason: DiscoveryStopReason;
  newJobOffers: number;
  searches: DiscoverySearch[];
}

/** One row of Activité › Recherches. */
export interface DiscoveryRunSummary {
  id: string;
  startedAt: Date;
  trigger: DiscoveryRunTrigger;
  /** Its Profile, by pseudonym, with what it searched; null once purged (QUERY_RETENTION_DAYS) or the account deleted. */
  profile: { pseudonym: string; targetRole: string; locations: string[] } | null;
  /** How many web searches it made. */
  searches: number;
  /** The Search providers that served its searches, in order of first use. */
  providers: string[];
  /** Its switch to the fallback Search provider; null when it did not switch. */
  fallback: SearchFallbackMetrics | null;
  pagesRead: number;
  newJobOffers: number;
  extracted: number;
  stopReason: DiscoveryStopReason;
  durationMs: number;
  /** Estimated, in €: its AI calls and Fantastic.jobs' jobs. */
  costEur: number;
}

/** One run, opened: its Discovery metrics and each search, query texts while they are kept. */
export interface DiscoveryRun extends Omit<DiscoveryRunSummary, "searches"> {
  metrics: DiscoveryMetrics;
  /** Each search with its figures; its `queries` are empty once purged. */
  searches: DiscoverySearch[];
  /** Whether its query texts, criteria and Job Search link are still kept. */
  queriesKept: boolean;
  /** For the links to its Appels IA (super-admins); null once purged. */
  candidateId: string | null;
  /** Whether the Job Search behind it can be opened. */
  hasJobSearch: boolean;
}

/** A run as the Candidate's Data export holds it. */
export interface ExportedDiscoveryRun {
  id: string;
  profileId: string;
  startedAt: Date;
  trigger: DiscoveryRunTrigger;
  jobSearchId: string | null;
  criteria: SearchCriteria;
  /** Each search: what it was for, the query texts sent, which page and the provider. */
  searches: (Pick<DiscoverySearch, "kind" | "site" | "queries" | "page" | "provider">)[];
}

export interface DiscoveryRuns {
  /** Records a run that ended; its id. */
  record(run: DiscoveryRunRecord): Promise<string>;
  /** The newest runs first, at most LIST_LIMIT. `filter` is untrusted (the page's query string): `{ trigger?, period?, fallback? }`. */
  list(filter?: unknown): Promise<DiscoveryRunSummary[]>;
  get(id: string): Promise<DiscoveryRun | null>;
  /**
   * The Job Search behind a run, for a super-admin, the view written to the Back Office Audit in the same transaction;
   * null (nothing written) when there is none: a Job Digest's run, its link purged, or no such run.
   */
  openJobSearch(actor: BackOfficeActor, id: string): Promise<{ candidateId: string; jobSearchId: string } | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each field on its own: one that cannot be read is dropped, the others still filter. */
const filterSchema = z.object({
  trigger: z.enum(DISCOVERY_RUN_TRIGGERS).optional().catch(undefined),
  period: z.enum(DISCOVERY_RUN_PERIODS).optional().catch(undefined),
  fallback: z
    .enum(["1"])
    .optional()
    .catch(undefined)
    .transform((value) => value === "1"),
});

export interface DiscoveryRunFilter {
  trigger?: DiscoveryRunTrigger;
  period: DiscoveryRunPeriod;
  /** Only the runs that switched to the fallback Search provider. */
  fallback: boolean;
}

/** The filter of an untrusted input, every unreadable field left out; the period is DEFAULT_PERIOD unless one is read. */
export function discoveryRunFilter(input: unknown): DiscoveryRunFilter {
  const parsed = filterSchema.safeParse(typeof input === "object" && input !== null ? input : {});
  if (!parsed.success) return { period: DEFAULT_PERIOD, fallback: false };
  const { trigger, period, fallback } = parsed.data;
  return { ...(trigger ? { trigger } : {}), period: period ?? DEFAULT_PERIOD, fallback };
}

/** A Profile's pseudonym: 4 hex digits of its id's hash, the same for each of its runs, which tells nothing of it. */
const pseudonymOf = (profileId: string) => createHash("sha256").update(profileId).digest("hex").slice(0, 4);

/** The figures of a search, as kept 24 months: no query text. */
type SearchFigures = Omit<DiscoverySearch, "queries">;

interface RunRow {
  id: string;
  started_at: Date;
  trigger: DiscoveryRunTrigger;
  duration_ms: number;
  stop_reason: string;
  new_job_offers: number;
  metrics: DiscoveryMetrics;
  searches: SearchFigures[];
  /** From the 30-day part, null once purged. */
  candidate_id: string | null;
  profile_id: string | null;
  job_search_id: string | null;
  criteria: SearchCriteria | null;
  queries: string[][] | null;
}

const SELECT = `SELECT r.id, r.started_at, r.trigger, r.duration_ms, r.stop_reason, r.new_job_offers, r.metrics, r.searches,
                       d.candidate_id, d.profile_id, d.job_search_id, d.criteria, d.queries
                  FROM discovery_run r LEFT JOIN discovery_run_detail d ON d.run_id = r.id`;

const stopReasonOf = (value: string): DiscoveryStopReason => (DISCOVERY_STOP_REASONS.includes(value as DiscoveryStopReason) ? (value as DiscoveryStopReason) : "exhausted");

function summaryOf(row: RunRow): DiscoveryRunSummary {
  const { metrics } = row;
  return {
    id: row.id,
    startedAt: row.started_at,
    trigger: row.trigger,
    profile: row.profile_id && row.criteria ? { pseudonym: pseudonymOf(row.profile_id), targetRole: row.criteria.targetRole, locations: row.criteria.locations } : null,
    searches: row.searches.length,
    providers: [...new Set(row.searches.map((search) => search.provider))],
    fallback: metrics.searchFallback ?? null,
    pagesRead: metrics.funnel.fetched,
    newJobOffers: row.new_job_offers,
    extracted: metrics.funnel.extracted,
    stopReason: stopReasonOf(row.stop_reason),
    durationMs: row.duration_ms,
    costEur: Math.round((metrics.costEur + (metrics.fantasticJobs?.costEur ?? 0)) * 1e6) / 1e6,
  };
}

function runOf(row: RunRow): DiscoveryRun {
  const { searches: _count, ...summary } = summaryOf(row);
  return {
    ...summary,
    metrics: row.metrics,
    searches: row.searches.map((figures, index) => ({ ...figures, queries: row.queries?.[index] ?? [] })),
    queriesKept: row.queries !== null,
    candidateId: row.candidate_id,
    hasJobSearch: row.job_search_id !== null,
  };
}

/** Only the known kinds of search are kept, whatever the record says. */
const figuresOf = (search: DiscoverySearch): SearchFigures => {
  const { queries: _queries, ...figures } = search;
  return { ...figures, kind: DISCOVERY_SEARCH_KINDS.includes(search.kind) ? search.kind : "plan" };
};

export function createDiscoveryRuns(database: Pool, deps: { backOffice?: Pick<BackOffice, "record">; now?: () => Date } = {}): DiscoveryRuns {
  const now = deps.now ?? (() => new Date());
  return {
    async record(run) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO discovery_run (started_at, trigger, duration_ms, stop_reason, new_job_offers, metrics, searches)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
          [run.startedAt, run.trigger, Math.max(0, Math.round(run.durationMs)), run.stopReason, run.newJobOffers, JSON.stringify(run.metrics), JSON.stringify(run.searches.map(figuresOf))],
        );
        const id = rows[0]!.id;
        await client.query(
          `INSERT INTO discovery_run_detail (run_id, candidate_id, profile_id, job_search_id, criteria, queries)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
          [id, run.candidateId, run.profileId, run.jobSearchId, JSON.stringify(run.criteria), JSON.stringify(run.searches.map((search) => search.queries))],
        );
        await client.query("COMMIT");
        return id;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async list(input) {
      const filter = discoveryRunFilter(input);
      const conditions: string[] = [];
      const params: unknown[] = [];
      const where = (condition: (param: string) => string, value: unknown) => {
        params.push(value);
        conditions.push(condition(`$${params.length}`));
      };
      if (filter.trigger) where((param) => `r.trigger = ${param}`, filter.trigger);
      if (filter.fallback) conditions.push(`jsonb_typeof(r.metrics -> 'searchFallback') = 'object'`);
      if (filter.period === "today") where((param) => `(r.started_at AT TIME ZONE 'Europe/Paris')::date = (${param}::timestamptz AT TIME ZONE 'Europe/Paris')::date`, now());
      if (filter.period === "7d" || filter.period === "30d") where((param) => `r.started_at >= ${param}::timestamptz`, new Date(now().getTime() - (filter.period === "7d" ? 7 : 30) * 86_400_000));
      params.push(LIST_LIMIT);
      const { rows } = await database.query<RunRow>(
        `${SELECT} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY r.started_at DESC, r.id LIMIT $${params.length}`,
        params,
      );
      return rows.map(summaryOf);
    },

    async get(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<RunRow>(`${SELECT} WHERE r.id = $1`, [id]);
      return rows[0] ? runOf(rows[0]) : null;
    },

    async openJobSearch(actor, id) {
      if (!UUID.test(id)) return null;
      if (!deps.backOffice) throw new Error("Opening a run's Job Search needs the Back Office Audit");
      return deps.backOffice.record(
        actor,
        async (within) => {
          const { rows } = await within.query<{ candidateId: string; jobSearchId: string }>(
            `SELECT candidate_id AS "candidateId", job_search_id AS "jobSearchId" FROM discovery_run_detail WHERE run_id = $1 AND job_search_id IS NOT NULL`,
            [id],
          );
          return rows[0] ?? null;
        },
        (found) => (found ? { section: "discovery_runs", target: id, action: "viewed", before: null, after: null } : null),
      );
    },
  };
}

/** The Candidate's runs whose query texts are still kept, newest first: what their Data export holds of them. */
export async function discoveryRunsOf(database: Pool, candidateId: string): Promise<ExportedDiscoveryRun[]> {
  const { rows } = await database.query<RunRow>(`${SELECT} WHERE d.candidate_id = $1 ORDER BY r.started_at DESC, r.id`, [candidateId]);
  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id!,
    startedAt: row.started_at,
    trigger: row.trigger,
    jobSearchId: row.job_search_id,
    criteria: row.criteria!,
    searches: row.searches.map(({ kind, site, page, provider }, index) => ({ kind, ...(site ? { site } : {}), queries: row.queries?.[index] ?? [], page, provider })),
  }));
}

/**
 * Deletes the query texts, criteria and Job Search link of the runs started QUERY_RETENTION_DAYS ago or more, and the
 * runs started RETENTION_MONTHS ago or more. Safe to run again.
 */
export async function purgeExpiredDiscoveryRuns(database: Pick<Pool, "query">, now: Date = new Date()): Promise<{ queries: number; runs: number }> {
  const queries = await database.query(
    `DELETE FROM discovery_run_detail d USING discovery_run r
      WHERE r.id = d.run_id AND r.started_at <= $1::timestamptz - make_interval(days => $2)`,
    [now, QUERY_RETENTION_DAYS],
  );
  const runs = await database.query(`DELETE FROM discovery_run WHERE started_at <= $1::timestamptz - make_interval(months => $2)`, [now, RETENTION_MONTHS]);
  return { queries: queries.rowCount ?? 0, runs: runs.rowCount ?? 0 };
}

export async function migrateDiscoveryRuns(database: Pool): Promise<void> {
  await database.query(`
    -- The figures of a run (#404): no Candidate, kept 24 months.
    CREATE TABLE IF NOT EXISTS discovery_run (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at timestamptz NOT NULL,
      trigger text NOT NULL,
      duration_ms integer NOT NULL,
      stop_reason text NOT NULL,
      new_job_offers integer NOT NULL,
      metrics jsonb NOT NULL,
      searches jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discovery_run_started_at_idx ON discovery_run (started_at DESC);
    -- What ties a run to its Candidate: kept 30 days, in their Data export, deleted with their account or Profile.
    CREATE TABLE IF NOT EXISTS discovery_run_detail (
      run_id uuid PRIMARY KEY REFERENCES discovery_run (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      job_search_id uuid REFERENCES job_search (id) ON DELETE CASCADE,
      criteria jsonb NOT NULL,
      queries jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discovery_run_detail_candidate_idx ON discovery_run_detail (candidate_id);
  `);
}
