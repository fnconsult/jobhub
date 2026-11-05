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
 *    Action) makes its entry « Suivie » while it exists, and its deletion puts the entry back to à traiter.
 *  - `backfillOfferBox(database, now)`: at launch, the last 30 days' Arrivals the other tables already hold, without the
 *    Job Offers posted more than 30 days ago. Idempotent: run again, it changes nothing.
 *  - `purgeExpiredOfferBoxEntries(database, now)`: entries 12 months after their first Arrival, which the worker runs daily.
 *  - `offerBoxOf(database, candidateId)`: the Candidate's entries for their Data export.
 * An entry is the Candidate's (ADR-0010): deleted with their account, and with its Profile. Never read by the Back
 * Office nor given to the AI Coach.
 */
import { matchScoreReliability, scoreMatch, type ArrivalSource, type JobOffer, type MatchScore } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import { visibleTo, type JobOffers } from "../job-offers";
import type { Profiles } from "../profiles";

/** How long an entry is kept after its first Arrival (ADR-0090). */
export const OFFER_BOX_RETENTION_MONTHS = 12;

/** How far back the launch's backfill looks, and how old a posting it takes (ADR-0090). */
export const OFFER_BOX_BACKFILL_DAYS = 30;

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
  state: "to_handle" | "followed";
  applicationId: string | null;
  followedAt: Date | null;
}

export interface OfferBoxContents {
  /** Today in French time, which « Aujourd'hui » is read against. */
  today: string;
  /** The entries still à traiter. */
  toHandle: number;
  entries: OfferBoxEntry[];
}

export interface OfferBox {
  /** The Candidate's Offer box, the most recent first Arrival first. */
  read(candidateId: string): Promise<OfferBoxContents>;
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

/** The Dismissal reasons (« Pas pour moi », « Salaire », « Lieu », « Contrat », « Déjà postulé ailleurs »), #816. */
export const DISMISSAL_REASONS = ["not_for_me", "salary", "location", "contract", "applied_elsewhere"] as const;

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
 * cards, without those posted longer ago. Each source at its own date, the earliest Arrival making the entry. Idempotent.
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
        WHERE m.author = 'coach' AND m.job_offer_id IS NOT NULL AND m.created_at >= $1
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
  const { rowCount } = await database.query(`DELETE FROM offer_box_entry WHERE first_arrival_at < $1::timestamptz - make_interval(months => $2)`, [now, OFFER_BOX_RETENTION_MONTHS]);
  return rowCount ?? 0;
}

interface EntryRow {
  id: string;
  job_offer_id: string;
  profile_id: string | null;
  first_arrival_at: Date;
  arrival_sources: Record<string, string>;
  application_id: string | null;
  followed_at: Date | null;
}

/** An entry's Arrival sources, oldest first. */
const sourcesOf = (kept: Record<string, string>) =>
  Object.entries(kept)
    .map(([source, at]) => ({ source: source as ArrivalSource, at: new Date(at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.source.localeCompare(b.source));

/** The Candidate's Offer box entries for their Data export, oldest first Arrival first. */
export async function offerBoxOf(database: Queryable, candidateId: string): Promise<ExportedOfferBoxEntry[]> {
  const { rows } = await database.query<EntryRow & { state: ExportedOfferBoxEntry["state"]; decided_at: Date | null; dismissal_reason: string | null; later_until: Date | null }>(
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

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** A Match Score's figure when it is computable, for picking the best Profile. */
const figure = (score: MatchScore) => (matchScoreReliability(score) === "not_computable" ? -1 : score.score);

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
          `SELECT e.id, e.job_offer_id, e.profile_id, e.first_arrival_at, e.arrival_sources, a.id AS application_id, a.created_at AS followed_at
             FROM offer_box_entry e LEFT JOIN application a ON a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id
            WHERE e.candidate_id = $1 ORDER BY e.first_arrival_at DESC, e.id`,
          [candidateId],
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
          return {
            id: row.id,
            jobOffer,
            profile: own ? { id: own.id, name: own.name } : null,
            scoredWith: best?.profile ?? null,
            matchScore: best?.score ?? null,
            firstArrivalAt: row.first_arrival_at,
            arrivalDay: PARIS_DAY.format(row.first_arrival_at),
            sources: sourcesOf(row.arrival_sources),
            state: row.application_id ? "followed" : "to_handle",
            applicationId: row.application_id,
            followedAt: row.followed_at,
          };
        }),
      );
      const kept = entries.filter((entry) => entry !== null);
      return { today: PARIS_DAY.format(now()), toHandle: kept.filter((entry) => entry.state === "to_handle").length, entries: kept };
    },
  };
}
