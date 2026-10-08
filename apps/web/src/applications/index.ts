/**
 * Applications: the link between one of a Candidate's Profiles and one Job
 * Offer, created when the Candidate saves the offer, and followed through its
 * Application Status.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createApplications(database, { jobOffers, profiles })`:
 *    - `save` a Job Offer with one of the Candidate's Profiles. A Candidate has at
 *      most one Application per Job Offer: saving it again returns the one they have.
 *    - `list` the Candidate's Applications (newest first) for the list and board views;
 *    - `get` one Application with its Job Offer, Profile, Interviews and the Match
 *      Score of the Profile's current Master CV against the Job Offer;
 *    - `change` its Application Status (only ever by the Candidate) or the Profile it uses;
 *    - `addInterview` (only while it is at "Entretien") and `removeInterview`. Interviews
 *      are kept when the Application moves on.
 * Every read and change is scoped to the Candidate; inputs are untrusted (they
 * come from the browser) and problems come back as results, never exceptions.
 * Applications are deleted with the account (ADR-0010), their Job Offers are kept.
 */
import { APPLICATION_STATUSES, scoreMatch, type ApplicationStatus, type JobOffer, type MatchScore } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { JobOffers } from "../job-offers";
import type { Profiles } from "../profiles";
import { fieldErrors, type FieldError } from "../validation";

export type { FieldError as ApplicationFieldError } from "../validation";

/** One dated interview round within an Application. */
export interface Interview {
  id: string;
  scheduledAt: Date;
  /** What the Candidate noted about it, e.g. "avec la DRH". Empty when nothing. */
  note: string;
}

export interface Application {
  id: string;
  status: ApplicationStatus;
  /** When the Application Status last changed (or the Application was saved). */
  statusChangedAt: Date;
  createdAt: Date;
  jobOffer: JobOffer;
  /** The Profile the Application uses. */
  profile: { id: string; name: string };
  /** Oldest first. */
  interviews: Interview[];
  /** The Profile's current Master CV, scored against the Job Offer and the Profile's Search Criteria. */
  matchScore: MatchScore;
}

export type SaveApplicationResult =
  /** `created` is false when the Candidate had already saved this Job Offer: the Application they have comes back. */
  | { ok: true; created: boolean; application: Application }
  | { ok: false; errors: FieldError[] }
  /** No such Job Offer, or no such Profile for this Candidate. */
  | { ok: false; error: "not_found" };

/** An Application as the list and board views show it. */
export interface ApplicationSummary {
  id: string;
  status: ApplicationStatus;
  statusChangedAt: Date;
  jobOffer: Pick<JobOffer, "id" | "title" | "employer" | "location">;
  profile: { id: string; name: string };
  /** Oldest first. */
  interviews: Interview[];
}

/** The outcome of changing an Application. "not_found" also covers someone else's Application (or Profile). */
export type ApplicationChangeResult =
  | { ok: true; application: Application }
  | { ok: false; errors: FieldError[] }
  | { ok: false; error: "not_found" };

/** Interviews are added only to an Application at "Entretien" (`interview`). */
export type AddInterviewResult = ApplicationChangeResult | { ok: false; error: "not_in_interview" };

export interface Applications {
  /** Saves a Job Offer as an Application ("À postuler"). `input`: { jobOfferId, profileId }. */
  save(candidateId: string, input: unknown): Promise<SaveApplicationResult>;
  /** The Application, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<Application | null>;
  /** Every Application of the Candidate, newest first. */
  list(candidateId: string): Promise<ApplicationSummary[]>;
  /** Changes the Application Status or the Profile used. `input`: { status } or { profileId }. */
  change(candidateId: string, applicationId: string, input: unknown): Promise<ApplicationChangeResult>;
  /** Adds a dated Interview. `input`: { scheduledAt (ISO 8601 date and time), note? }. */
  addInterview(candidateId: string, applicationId: string, input: unknown): Promise<AddInterviewResult>;
  /** Removes one of the Application's Interviews. */
  removeInterview(candidateId: string, applicationId: string, interviewId: string): Promise<ApplicationChangeResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().trim().min(1);
const saveSchema = z.object({ jobOfferId: id, profileId: id });
const changeSchema = z.union([z.object({ status: z.enum(APPLICATION_STATUSES) }), z.object({ profileId: id })]);
/** Told apart by `profileId`, so field errors name the field the caller meant. */
const parseChange = (input: unknown) =>
  typeof input === "object" && input !== null && "profileId" in input
    ? changeSchema.options[1].safeParse(input, { reportInput: true })
    : changeSchema.options[0].safeParse(input, { reportInput: true });

/** Interviews are in France: a date and time typed without an offset is French time. */
export const INTERVIEW_TIME_ZONE = "Europe/Paris";

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - (instant - (instant % 1000));
}

/** The instant a wall-clock time ("2026-11-12T14:30") stands for in `timeZone`. */
function wallClockIn(local: string, timeZone: string): Date {
  const asUtc = Date.parse(`${local}Z`);
  const guess = asUtc - offsetAt(asUtc, timeZone);
  return new Date(asUtc - offsetAt(guess, timeZone));
}

const interviewSchema = z.object({
  scheduledAt: z.iso
    .datetime({ offset: true, local: true })
    .transform((value) => (/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? new Date(value) : wallClockIn(value, INTERVIEW_TIME_ZONE))),
  note: z.string().trim().max(500).default(""),
});

const NOT_FOUND = { ok: false, error: "not_found" } as const;
const found = (application: Application | null): ApplicationChangeResult => (application ? { ok: true, application } : NOT_FOUND);

interface ApplicationRow {
  id: string;
  job_offer_id: string;
  profile_id: string;
  status: ApplicationStatus;
  status_changed_at: Date;
  created_at: Date;
}

const COLUMNS = "id, job_offer_id, profile_id, status, status_changed_at, created_at";

export function createApplications(
  database: Pool,
  { jobOffers, profiles }: { jobOffers: Pick<JobOffers, "get">; profiles: Pick<Profiles, "get"> },
): Applications {
  /** The Interviews of each Application, oldest first. */
  async function interviewsOf(applicationIds: string[]): Promise<Map<string, Interview[]>> {
    const { rows } = await database.query<{ id: string; application_id: string; scheduled_at: Date; note: string }>(
      `SELECT id, application_id, scheduled_at, note FROM interview WHERE application_id = ANY($1) ORDER BY scheduled_at, created_at`,
      [applicationIds],
    );
    const byApplication = new Map(applicationIds.map((applicationId) => [applicationId, [] as Interview[]]));
    for (const row of rows) byApplication.get(row.application_id)!.push({ id: row.id, scheduledAt: row.scheduled_at, note: row.note });
    return byApplication;
  }

  async function applicationFrom(candidateId: string, row: ApplicationRow): Promise<Application> {
    const [jobOffer, profile, interviews] = await Promise.all([
      jobOffers.get(row.job_offer_id),
      profiles.get(candidateId, row.profile_id),
      interviewsOf([row.id]),
    ]);
    // Both are kept as long as the Application: Job Offers are never deleted, Profiles only with the account.
    if (!jobOffer || !profile) throw new Error(`Application ${row.id} lost its Job Offer or Profile`);
    return {
      id: row.id,
      status: row.status,
      statusChangedAt: row.status_changed_at,
      createdAt: row.created_at,
      jobOffer,
      profile: { id: profile.id, name: profile.name },
      interviews: interviews.get(row.id)!,
      matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
    };
  }

  async function get(candidateId: string, applicationId: string): Promise<Application | null> {
    if (!UUID.test(applicationId)) return null;
    const { rows } = await database.query<ApplicationRow>(`SELECT ${COLUMNS} FROM application WHERE id = $1 AND candidate_id = $2`, [
      applicationId,
      candidateId,
    ]);
    return rows[0] ? applicationFrom(candidateId, rows[0]) : null;
  }

  return {
    async save(candidateId, input) {
      const parsed = saveSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { jobOfferId, profileId } = parsed.data;
      const [jobOffer, profile] = await Promise.all([jobOffers.get(jobOfferId), profiles.get(candidateId, profileId)]);
      if (!jobOffer || !profile) return { ok: false, error: "not_found" };

      const inserted = await database.query<ApplicationRow>(
        `INSERT INTO application (candidate_id, job_offer_id, profile_id) VALUES ($1, $2, $3)
         ON CONFLICT (candidate_id, job_offer_id) DO NOTHING
         RETURNING ${COLUMNS}`,
        [candidateId, jobOffer.id, profile.id],
      );
      if (inserted.rows[0]) return { ok: true, created: true, application: await applicationFrom(candidateId, inserted.rows[0]) };
      const existing = await database.query<ApplicationRow>(
        `SELECT ${COLUMNS} FROM application WHERE candidate_id = $1 AND job_offer_id = $2`,
        [candidateId, jobOffer.id],
      );
      return { ok: true, created: false, application: await applicationFrom(candidateId, existing.rows[0]!) };
    },

    get,

    async list(candidateId) {
      const { rows } = await database.query<
        ApplicationRow & { title: string; employer: string | null; location: string | null; profile_name: string }
      >(
        `SELECT a.id, a.job_offer_id, a.profile_id, a.status, a.status_changed_at, a.created_at,
                o.title, o.employer, o.location, p.name AS profile_name
           FROM application a
           JOIN job_offer o ON o.id = a.job_offer_id
           JOIN profile p ON p.id = a.profile_id
          WHERE a.candidate_id = $1
          ORDER BY a.created_at DESC, a.id`,
        [candidateId],
      );
      const interviews = await interviewsOf(rows.map((row) => row.id));
      return rows.map((row) => {
        const jobOffer: ApplicationSummary["jobOffer"] = { id: row.job_offer_id, title: row.title };
        if (row.employer !== null) jobOffer.employer = row.employer;
        if (row.location !== null) jobOffer.location = row.location;
        return {
          id: row.id,
          status: row.status,
          statusChangedAt: row.status_changed_at,
          jobOffer,
          profile: { id: row.profile_id, name: row.profile_name },
          interviews: interviews.get(row.id)!,
        };
      });
    },

    async change(candidateId, applicationId, input) {
      const parsed = parseChange(input);
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(applicationId)) return NOT_FOUND;
      const change = parsed.data;
      if ("profileId" in change) {
        const profile = await profiles.get(candidateId, change.profileId);
        if (!profile) return NOT_FOUND;
        await database.query(`UPDATE application SET profile_id = $3 WHERE id = $1 AND candidate_id = $2`, [applicationId, candidateId, profile.id]);
      } else {
        // Choosing the status it already has changes nothing, so its date is kept.
        await database.query(
          `UPDATE application SET status = $3, status_changed_at = now() WHERE id = $1 AND candidate_id = $2 AND status <> $3`,
          [applicationId, candidateId, change.status],
        );
      }
      return found(await get(candidateId, applicationId));
    },

    async addInterview(candidateId, applicationId, input) {
      const parsed = interviewSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(applicationId)) return NOT_FOUND;
      const { rows } = await database.query<{ status: ApplicationStatus }>(
        `SELECT status FROM application WHERE id = $1 AND candidate_id = $2`,
        [applicationId, candidateId],
      );
      if (!rows[0]) return NOT_FOUND;
      if (rows[0].status !== "interview") return { ok: false, error: "not_in_interview" };
      await database.query(`INSERT INTO interview (application_id, scheduled_at, note) VALUES ($1, $2, $3)`, [
        applicationId,
        parsed.data.scheduledAt,
        parsed.data.note,
      ]);
      return found(await get(candidateId, applicationId));
    },

    async removeInterview(candidateId, applicationId, interviewId) {
      if (!UUID.test(applicationId) || !UUID.test(interviewId)) return NOT_FOUND;
      const { rowCount } = await database.query(
        `DELETE FROM interview i USING application a
          WHERE i.id = $1 AND i.application_id = a.id AND a.id = $2 AND a.candidate_id = $3`,
        [interviewId, applicationId, candidateId],
      );
      if (rowCount === 0) return NOT_FOUND;
      return found(await get(candidateId, applicationId));
    },
  };
}

/** Creates or upgrades the Application and Interview tables. Run after the Candidate, Profile and Job Offer tables. Safe to run repeatedly. */
export async function migrateApplications(database: Pool): Promise<void> {
  const statuses = APPLICATION_STATUSES.map((status) => `'${status}'`).join(", ");
  await database.query(`
    CREATE TABLE IF NOT EXISTS application (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      job_offer_id uuid NOT NULL REFERENCES job_offer (id),
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'to_apply' CHECK (status IN (${statuses})),
      status_changed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (candidate_id, job_offer_id)
    );
    CREATE TABLE IF NOT EXISTS interview (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      scheduled_at timestamptz NOT NULL,
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS interview_application_id_idx ON interview (application_id);
  `);
}
