/**
 * The Offer box (« Offres à traiter », ADR-0090): every Job Offer that reached a Candidate, one Offer box entry each,
 * until they decide on it.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `recordArrivals(database, arrival)`: Job Offers reaching a Candidate's Offer box from one Arrival source (a Job
 *    Search's results, a Job Digest sent, a Received offer email's new offers, a Job Offer link's card). The first
 *    Arrival of a Job Offer makes its entry, with that Arrival's Profile (none: « Non classée ») and day; a later one
 *    adds its source, with its date, and moves nothing. A Job Offer private to another Candidate (ADR-0049) makes no
 *    entry. Each door calls it where it records what it brought, in the same transaction when it has one; each door's
 *    migration creates the table (`migrateOfferBox`) for that reason.
 *  - `createOfferBox(database, deps).read(candidateId)`: the Candidate's entries, the most recent first Arrival first,
 *    each with its Job Offer, its Match Score (rules only, scoreMatch: against its Profile's current Master CV, or for a
 *    « Non classée » one the active Profile it matches best), and where it stands. « Suivie » is read from the
 *    Application, not stored: an Application made anywhere (« Suivre », a Job Search's page, the extension, a Coach
 *    Action) makes its entry « Suivie » while it exists, and its deletion puts the entry back to à traiter. Making it
 *    replaces a dismissal (`dismissalReplacedBy`, which `applications.save` runs): the latest decision wins, so an entry
 *    écartée then suivie is à traiter, with no decision, once its Application is deleted. An entry
 *    écartée more than OFFER_BOX_DISMISSED_DAYS days ago is left out: « Écartées » shows the last 30 days'.
 *  - `.dismiss(candidateId, entryId, { reason })`: « Écarter » (#816), with a Dismissal reason or none; refused for an
 *    entry « Suivie », which is undone only by deleting its Application. Arriving again moves nothing: it stays écartée.
 *    `.reconsider(candidateId, entryId)`: « Revenir sur ce choix », the entry à traiter again, its reason forgotten.
 *  - `dismissedJobOffers(candidate)`: the SQL listing the Job Offers a Candidate écarta (and did not follow since), which the doors read so that an
 *    écartée Job Offer counts as already seen everywhere (ADR-0090): a Job Digest never sends it again, Email intake
 *    counts it « déjà vue », a Job Search's results show it « Écartée ». The shared Job Offer and other Candidates'
 *    entries are untouched.
 *  - `backfillOfferBox(database, now)`: at launch, the last 30 days' Arrivals the other tables already hold, without the
 *    Job Offers posted more than 30 days ago. Idempotent: run again, it changes nothing.
 *  - `purgeExpiredOfferBoxEntries(database, now)`: entries 12 months after their first Arrival, which the worker runs daily.
 *  - `offerBoxOf(database, candidateId)`: the Candidate's entries for their Data export.
 *  - `offersToHandle(database, candidateId, now)`, or `.toHandle(candidateId)`: « N à traiter » without reading the
 *    entries (#818), the count the Sidebar's « Recherches d'offres », the app's menu and icon badge, the Push
 *    notifications and the Job Digest's line show: neither « Suivie » nor « Écartée », « Plus tard » included, « Expirée
 *    sans décision » not.
 * An entry is the Candidate's (ADR-0010): deleted with their account, and with its Profile. Never read by the Back
 * Office nor given to the AI Coach.
 */
import { MAX_POSTING_AGE_DAYS, matchScoreReliability, scoreMatch, type ArrivalSource, type JobOffer, type MatchScore } from "@jobhub/shared";
import { DISMISSAL_REASONS, type DismissalReason } from "@jobhub/shared/reads";
import type { Pool } from "pg";
import { utcBefore } from "../database/before";
import type { Queryable } from "../database/pool";
import { visibleTo, type JobOffers } from "../job-offers";
import type { Profiles } from "../profiles";

/** How long an entry is kept after its first Arrival (ADR-0090). */
export const OFFER_BOX_RETENTION_MONTHS = 12;

/** How far back the launch's backfill looks, and how old a posting it takes (ADR-0090). */
export const OFFER_BOX_BACKFILL_DAYS = 30;

/** How long « Écartées » shows an entry after it was écartée (ADR-0090). */
export const OFFER_BOX_DISMISSED_DAYS = 30;

/** Job Offers reaching a Candidate from one Arrival source, at `at`, for a Profile (null: « Non classée »). */
export interface Arrival {
  candidateId: string;
  profileId: string | null;
  source: ArrivalSource;
  at: Date;
  jobOfferIds: readonly string[];
}

/** One Offer box entry as the page and `/api` read it. */
export interface OfferBoxEntry {
  id: string;
  jobOffer: JobOffer;
  /** The entry's Profile, the first Arrival's; null: « Non classée ». */
  profile: { id: string; name: string } | null;
  /** The Profile its Match Score is against, and « Suivre » saves it with; null when the Candidate has no active Profile. */
  scoredWith: { id: string; name: string } | null;
  /** Null when there is no Profile to score it against. */
  matchScore: MatchScore | null;
  firstArrivalAt: Date;
  /** The day of its first Arrival, in French time ("2026-11-05"). */
  arrivalDay: string;
  /** Each Arrival source, with when it first brought the Job Offer, oldest first. */
  sources: { source: ArrivalSource; at: Date }[];
  state: "to_handle" | "followed" | "dismissed";
  applicationId: string | null;
  followedAt: Date | null;
  /** Once « Écartée »: its Dismissal reason (null: « Écarter sans motif ») and when. */
  dismissalReason: DismissalReason | null;
  dismissedAt: Date | null;
}

export interface OfferBoxContents {
  /** Today in French time, which « Aujourd'hui » is read against. */
  today: string;
  /** The entries still à traiter. */
  toHandle: number;
  entries: OfferBoxEntry[];
}

/** What « Écarter » and « Revenir sur ce choix » answer. */
export type OfferBoxDecision = { ok: true } | { ok: false; error: "not_found" | "followed" | "invalid_reason" };

export interface OfferBox {
  /** The Candidate's Offer box, the most recent first Arrival first. */
  read(candidateId: string): Promise<OfferBoxContents>;
  /** « Écarter » one of the Candidate's entries, with a Dismissal reason or none (`reason` absent or null). */
  dismiss(candidateId: string, entryId: string, input: { reason?: unknown }): Promise<OfferBoxDecision>;
  /** « Revenir sur ce choix »: one of the Candidate's entries écartée back to à traiter (one not écartée is left as it is). */
  reconsider(candidateId: string, entryId: string): Promise<{ ok: true } | { ok: false; error: "not_found" }>;
  /** How many of the Candidate's entries are à traiter now: `offersToHandle`. */
  toHandle(candidateId: string): Promise<number>;
}

/** An Offer box entry as the Candidate's Data export holds it. */
export interface ExportedOfferBoxEntry {
  jobOfferId: string;
  /** Null: « Non classée ». */
  profileId: string | null;
  firstArrivalAt: Date;
  arrivalSources: { source: ArrivalSource; at: Date }[];
  /** « Suivie » while an Application of the Job Offer exists. */
  state: "to_handle" | "later" | "dismissed" | "followed";
  decidedAt: Date | null;
  dismissalReason: string | null;
  laterUntil: Date | null;
}

export { DISMISSAL_REASONS, type DismissalReason };

/**
 * The SQL listing the Job Offers the Candidate named by `candidate` (a parameter, "$1") écarta from their Offer box, one
 * `job_offer_id` each: what the doors leave out or mark, so that « Écartée » means already seen everywhere (ADR-0090).
 */
export function dismissedJobOffers(candidate: string): string {
  return `SELECT e.job_offer_id FROM offer_box_entry e
           WHERE e.candidate_id = ${candidate} AND e.state = 'dismissed'
             AND NOT EXISTS (SELECT 1 FROM application a WHERE a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id)`;
}

/**
 * The statement that makes an Application's creation replace a dismissal (ADR-0090): an entry has one decision at a time,
 * the latest, so the Candidate's entries écartées for the Job Offers `jobOffers` (SQL giving `job_offer_id`s) lose their
 * « Écartée », its Dismissal reason and its date. Once that Application is deleted, the entry has no decision: à traiter.
 * Run by `applications.save` in the statement that creates the Application.
 */
export function dismissalReplacedBy(candidate: string, jobOffers: string): string {
  return `UPDATE offer_box_entry SET state = 'to_handle', decided_at = NULL, dismissal_reason = NULL
           WHERE candidate_id = ${candidate} AND state = 'dismissed' AND job_offer_id IN (${jobOffers})`;
}

/** Creates or upgrades the Offer box table. Run after the Candidate, Profile and Job Offer tables. Safe to run repeatedly. */
export async function migrateOfferBox(database: Queryable): Promise<void> {
  await database.query(`
    -- One row per Candidate and Job Offer (ADR-0090): its Profile (null: « Non classée »), its first Arrival and each
    -- Arrival source with the date it first brought it ({ "job_search": "2026-11-05T08:00:00.000Z", … }), and the
    -- Candidate's decision: « Plus tard » until later_until, or « Écartée » with its Dismissal reason, decided_at. « Suivie »
    -- is not stored: it is the Application's existence.
    CREATE TABLE IF NOT EXISTS offer_box_entry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      job_offer_id uuid NOT NULL REFERENCES job_offer (id) ON DELETE CASCADE,
      profile_id uuid REFERENCES profile (id) ON DELETE CASCADE,
      first_arrival_at timestamptz NOT NULL,
      arrival_sources jsonb NOT NULL,
      state text NOT NULL DEFAULT 'to_handle' CHECK (state IN ('to_handle', 'later', 'dismissed')),
      decided_at timestamptz,
      dismissal_reason text CHECK (dismissal_reason IN (${DISMISSAL_REASONS.map((reason) => `'${reason}'`).join(", ")})),
      later_until timestamptz,
      UNIQUE (candidate_id, job_offer_id)
    );
    CREATE INDEX IF NOT EXISTS offer_box_entry_first_arrival_idx ON offer_box_entry (first_arrival_at);
  `);
}

/** An instant as Arrival sources keep it: ISO 8601 in UTC, so the earliest is the smallest text. */
const ISO = (at: string) => `to_char(${at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Where a row for a Job Offer already there joins it: the earliest first Arrival and its Profile stay, each source keeps
 * the date it first came by.
 */
const MERGE = `
  ON CONFLICT (candidate_id, job_offer_id) DO UPDATE SET
    first_arrival_at = LEAST(offer_box_entry.first_arrival_at, EXCLUDED.first_arrival_at),
    profile_id = CASE WHEN EXCLUDED.first_arrival_at < offer_box_entry.first_arrival_at THEN EXCLUDED.profile_id ELSE offer_box_entry.profile_id END,
    arrival_sources = (
      SELECT jsonb_object_agg(key, value) FROM (
        SELECT key, min(value) AS value
          FROM (SELECT * FROM jsonb_each_text(offer_box_entry.arrival_sources) UNION ALL SELECT * FROM jsonb_each_text(EXCLUDED.arrival_sources)) sources
         GROUP BY key
      ) earliest
    )`;

/** Records an Arrival: an entry for each Job Offer the Candidate can see, or its source added to the one there. */
export async function recordArrivals(database: Queryable, { candidateId, profileId, source, at, jobOfferIds }: Arrival): Promise<void> {
  if (jobOfferIds.length === 0) return;
  await database.query(
    `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
     SELECT $1, o.id, $3::uuid, $4::timestamptz, jsonb_build_object($5::text, ${ISO("$4::timestamptz")})
       FROM job_offer o WHERE o.id = ANY ($2::uuid[]) AND ${visibleTo("$1", "o")}
     ${MERGE}`,
    [candidateId, [...new Set(jobOfferIds)], profileId, at, source],
  );
}

/**
 * Fills the Offer box at launch (ADR-0090) from the last OFFER_BOX_BACKFILL_DAYS days: the Job Offers of the Candidates'
 * Job Searches (those they kept), Job Digests, Received offer emails (the new ones, with their Profile) and Job Offer
 * cards (not a Share capture's set reply: a Share capture enters only once followed), without those posted longer ago.
 * Each source at its own date, the earliest Arrival making the entry. Idempotent.
 */
export async function backfillOfferBox(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query(
    `WITH arrivals (candidate_id, job_offer_id, profile_id, source, at) AS (
       SELECT s.candidate_id, unnest(s.job_offer_ids), s.profile_id, 'job_search', coalesce(s.finished_at, s.started_at)
         FROM job_search s WHERE s.status <> 'searching' AND coalesce(s.finished_at, s.started_at) >= $1
       UNION ALL
       SELECT d.candidate_id, unnest(d.job_offer_ids), d.profile_id, 'job_digest', d.sent_at FROM job_digest d WHERE d.sent_at >= $1
       UNION ALL
       SELECT f.candidate_id, f.job_offer_id, f.profile_id, 'email', coalesce(e.read_at, e.received_at)
         FROM received_offer_email_offer f JOIN received_offer_email e ON e.id = f.received_offer_email_id
        WHERE f.disposition = 'new' AND f.job_offer_id IS NOT NULL AND coalesce(e.read_at, e.received_at) >= $1
       UNION ALL
       SELECT c.candidate_id, m.job_offer_id, c.profile_id, 'job_offer_link', m.created_at
         FROM coach_message m JOIN coach_conversation c ON c.id = m.conversation_id
        WHERE m.author = 'coach' AND m.job_offer_id IS NOT NULL AND NOT m.blocked AND NOT m.share_capture AND m.created_at >= $1
     ),
     kept AS (
       SELECT a.* FROM arrivals a JOIN job_offer o ON o.id = a.job_offer_id
        WHERE ${visibleTo("a.candidate_id", "o")} AND (o.posted_at IS NULL OR o.posted_at >= $1)
     ),
     per_source AS (SELECT candidate_id, job_offer_id, source, min(at) AS at FROM kept GROUP BY candidate_id, job_offer_id, source),
     entries AS (
       SELECT candidate_id, job_offer_id, min(at) AS first_arrival_at, jsonb_object_agg(source, ${ISO("at")}) AS arrival_sources
         FROM per_source GROUP BY candidate_id, job_offer_id
     ),
     firsts AS (SELECT DISTINCT ON (candidate_id, job_offer_id) candidate_id, job_offer_id, profile_id FROM kept ORDER BY candidate_id, job_offer_id, at, source)
     INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
     SELECT e.candidate_id, e.job_offer_id, f.profile_id, e.first_arrival_at, e.arrival_sources FROM entries e JOIN firsts f USING (candidate_id, job_offer_id)
     ${MERGE}`,
    [new Date(now.getTime() - OFFER_BOX_BACKFILL_DAYS * 24 * 60 * 60 * 1000)],
  );
  return rowCount ?? 0;
}

/** Deletes the entries whose first Arrival is OFFER_BOX_RETENTION_MONTHS old. Returns how many. */
export async function purgeExpiredOfferBoxEntries(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query(`DELETE FROM offer_box_entry WHERE first_arrival_at < ${utcBefore("$1", "make_interval(months => $2)")}`, [now, OFFER_BOX_RETENTION_MONTHS]);
  return rowCount ?? 0;
}

/**
 * How many of the Candidate's Offer box entries are à traiter at `now` (#818, ADR-0090): neither « Suivie » (an
 * Application of its Job Offer exists) nor « Écartée »; « Plus tard » counts, it is not a decision; « Expirée sans
 * décision » does not: its Posting date, or its first Arrival when that is unknown, more than MAX_POSTING_AGE_DAYS French
 * days before `now`. One query, no Match Score: cheap enough for every page's Sidebar and every Push notification.
 */
export async function offersToHandle(database: Queryable, candidateId: string, now: Date): Promise<number> {
  const parisDay = (instant: string) => `(${instant} AT TIME ZONE 'Europe/Paris')::date`;
  const { rows } = await database.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM offer_box_entry e JOIN job_offer o ON o.id = e.job_offer_id
      WHERE e.candidate_id = $1 AND e.state <> 'dismissed' AND ${visibleTo("$1", "o")}
        AND NOT EXISTS (SELECT 1 FROM application a WHERE a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id)
        AND ${parisDay("$2::timestamptz")} - ${parisDay("coalesce(o.posted_at, e.first_arrival_at)")} <= $3`,
    [candidateId, now, MAX_POSTING_AGE_DAYS],
  );
  return rows[0]?.count ?? 0;
}

interface EntryRow {
  id: string;
  job_offer_id: string;
  profile_id: string | null;
  first_arrival_at: Date;
  arrival_sources: Record<string, string>;
  application_id: string | null;
  followed_at: Date | null;
  state: "to_handle" | "later" | "dismissed";
  decided_at: Date | null;
  dismissal_reason: DismissalReason | null;
}

/** An entry's Arrival sources, oldest first. */
const sourcesOf = (kept: Record<string, string>) =>
  Object.entries(kept)
    .map(([source, at]) => ({ source: source as ArrivalSource, at: new Date(at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.source.localeCompare(b.source));

/** The Candidate's Offer box entries for their Data export, oldest first Arrival first. */
export async function offerBoxOf(database: Queryable, candidateId: string): Promise<ExportedOfferBoxEntry[]> {
  const { rows } = await database.query<Omit<EntryRow, "state"> & { state: ExportedOfferBoxEntry["state"]; later_until: Date | null }>(
    `SELECT e.job_offer_id, e.profile_id, e.first_arrival_at, e.arrival_sources, e.decided_at, e.dismissal_reason, e.later_until,
            CASE WHEN a.id IS NOT NULL THEN 'followed' ELSE e.state END AS state
       FROM offer_box_entry e LEFT JOIN application a ON a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id
      WHERE e.candidate_id = $1 ORDER BY e.first_arrival_at, e.id`,
    [candidateId],
  );
  return rows.map((row) => ({
    jobOfferId: row.job_offer_id,
    profileId: row.profile_id,
    firstArrivalAt: row.first_arrival_at,
    arrivalSources: sourcesOf(row.arrival_sources),
    state: row.state,
    decidedAt: row.decided_at,
    dismissalReason: row.dismissal_reason,
    laterUntil: row.later_until,
  }));
}

const isDismissalReason = (reason: unknown): reason is DismissalReason => (DISMISSAL_REASONS as readonly unknown[]).includes(reason);

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** A Match Score's figure when it is computable, for picking the best Profile. */
const figure = (score: MatchScore) => (matchScoreReliability(score) === "not_computable" ? -1 : score.score);

/** An entry's id is a uuid: anything else names none (and would make Postgres refuse the query). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OfferBoxDeps {
  profiles: Pick<Profiles, "list" | "get">;
  jobOffers: Pick<JobOffers, "get">;
  now?: () => Date;
}

export function createOfferBox(database: Pool, deps: OfferBoxDeps): OfferBox {
  const now = deps.now ?? (() => new Date());
  return {
    async read(candidateId) {
      const [{ rows }, listed] = await Promise.all([
        database.query<EntryRow>(
          `SELECT e.id, e.job_offer_id, e.profile_id, e.first_arrival_at, e.arrival_sources, e.state, e.decided_at, e.dismissal_reason,
                  a.id AS application_id, a.created_at AS followed_at
             FROM offer_box_entry e LEFT JOIN application a ON a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id
            WHERE e.candidate_id = $1
              AND (e.state <> 'dismissed' OR a.id IS NOT NULL OR e.decided_at >= ${utcBefore("$2", "make_interval(days => $3)")})
            ORDER BY e.first_arrival_at DESC, e.id`,
          [candidateId, now(), OFFER_BOX_DISMISSED_DAYS],
        ),
        deps.profiles.list(candidateId),
      ]);
      // Each Profile and Job Offer read once, however many entries share it.
      const profileReads = new Map<string, ReturnType<Profiles["get"]>>();
      const profileOf = (id: string) => profileReads.get(id) ?? profileReads.set(id, deps.profiles.get(candidateId, id)).get(id)!;
      const active = listed.filter((profile) => !profile.archived);

      const entries = await Promise.all(
        rows.map(async (row): Promise<OfferBoxEntry | null> => {
          const jobOffer = await deps.jobOffers.get(row.job_offer_id, candidateId);
          if (!jobOffer) return null;
          const own = row.profile_id ? await profileOf(row.profile_id) : null;
          const candidates = own ? [own] : (await Promise.all(active.map((profile) => profileOf(profile.id)))).filter((profile) => profile !== null);
          let best: { profile: { id: string; name: string }; score: MatchScore } | null = null;
          for (const profile of candidates) {
            const score = scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer });
            if (!best || figure(score) > figure(best.score)) best = { profile: { id: profile.id, name: profile.name }, score };
          }
          const dismissed = !row.application_id && row.state === "dismissed";
          return {
            id: row.id,
            jobOffer,
            profile: own ? { id: own.id, name: own.name } : null,
            scoredWith: best?.profile ?? null,
            matchScore: best?.score ?? null,
            firstArrivalAt: row.first_arrival_at,
            arrivalDay: PARIS_DAY.format(row.first_arrival_at),
            sources: sourcesOf(row.arrival_sources),
            state: row.application_id ? "followed" : dismissed ? "dismissed" : "to_handle",
            applicationId: row.application_id,
            followedAt: row.followed_at,
            dismissalReason: dismissed ? row.dismissal_reason : null,
            dismissedAt: dismissed ? row.decided_at : null,
          };
        }),
      );
      const kept = entries.filter((entry) => entry !== null);
      return { today: PARIS_DAY.format(now()), toHandle: kept.filter((entry) => entry.state === "to_handle").length, entries: kept };
    },

    async dismiss(candidateId, entryId, { reason = null }) {
      if (reason !== null && !isDismissalReason(reason)) return { ok: false, error: "invalid_reason" };
      if (!UUID.test(entryId)) return { ok: false, error: "not_found" };
      // A data-modifying CTE runs whether or not it is read: one statement, so an Application made meanwhile cannot slip between.
      const { rows } = await database.query<{ followed: boolean }>(
        `WITH own AS (
           SELECT e.id, EXISTS (SELECT 1 FROM application a WHERE a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id) AS followed
             FROM offer_box_entry e WHERE e.id = $1 AND e.candidate_id = $2
         ),
         dismissed AS (
           UPDATE offer_box_entry e SET state = 'dismissed', decided_at = $3, dismissal_reason = $4, later_until = NULL
             FROM own WHERE e.id = own.id AND NOT own.followed
         )
         SELECT followed FROM own`,
        [entryId, candidateId, now(), reason],
      );
      if (!rows[0]) return { ok: false, error: "not_found" };
      return rows[0].followed ? { ok: false, error: "followed" } : { ok: true };
    },

    toHandle: (candidateId) => offersToHandle(database, candidateId, now()),

    async reconsider(candidateId, entryId) {
      if (!UUID.test(entryId)) return { ok: false, error: "not_found" };
      const { rows } = await database.query(
        `WITH own AS (SELECT id FROM offer_box_entry WHERE id = $1 AND candidate_id = $2),
              undone AS (
                UPDATE offer_box_entry e SET state = 'to_handle', decided_at = NULL, dismissal_reason = NULL
                  FROM own WHERE e.id = own.id AND e.state = 'dismissed'
              )
         SELECT id FROM own`,
        [entryId, candidateId],
      );
      return rows[0] ? { ok: true } : { ok: false, error: "not_found" };
    },
  };
}
