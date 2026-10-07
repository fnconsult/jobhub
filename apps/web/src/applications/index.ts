/**
 * Applications: the link between one of a Candidate's Profiles and one Job
 * Offer, created when the Candidate saves the offer, and followed through its
 * Application Status.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createApplications(database, { jobOffers, profiles })`:
 *    - `save` a Job Offer with one of the Candidate's Profiles. A Candidate has at
 *      most one Application per Job Offer: saving it again returns the one they have.
 *    - `get` one Application with its Job Offer, Profile, Interviews and the Match
 *      Score of the Profile's current Master CV against the Job Offer.
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

export interface Applications {
  /** Saves a Job Offer as an Application ("À postuler"). `input`: { jobOfferId, profileId }. */
  save(candidateId: string, input: unknown): Promise<SaveApplicationResult>;
  /** The Application, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<Application | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().trim().min(1);
const saveSchema = z.object({ jobOfferId: id, profileId: id });

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
  async function interviewsOf(applicationId: string): Promise<Interview[]> {
    const { rows } = await database.query<{ id: string; scheduled_at: Date; note: string }>(
      `SELECT id, scheduled_at, note FROM interview WHERE application_id = $1 ORDER BY scheduled_at, created_at`,
      [applicationId],
    );
    return rows.map((row) => ({ id: row.id, scheduledAt: row.scheduled_at, note: row.note }));
  }

  async function applicationFrom(candidateId: string, row: ApplicationRow): Promise<Application> {
    const [jobOffer, profile, interviews] = await Promise.all([
      jobOffers.get(row.job_offer_id),
      profiles.get(candidateId, row.profile_id),
      interviewsOf(row.id),
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
      interviews,
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
