/**
 * Human Coaches (CONTEXT.md): the HR professionals Jobbbox selects, whom a
 * Candidate books for paid Coaching Sessions and may grant Coach Access to.
 *
 * One deep module. `createHumanCoaches(database, deps)` answers:
 *  - who are the Human Coaches?        `add`, `list`, `retire` (Back Office), `coachSignedIn`
 *  - whom may they read?               `grantAccess`, `revokeAccess`, `accessGranted` (the Candidate's Coach Access)
 *  - what do they read?                `candidates`, `candidateFile`, `application` (read only)
 * and `migrateHumanCoaches(database)` creates its tables.
 */
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications, ApplicationSummary } from "../applications";
import type { Profile, Profiles } from "../profiles";
import type { SavedTailoredCv, TailoredCvs } from "../tailored-cv";
import type { CoverLetter, OutreachMessage, TailoredDocuments } from "../tailored-documents";
import { fieldErrors, type FieldError } from "../validation";

export interface HumanCoach {
  id: string;
  name: string;
  /** The address they sign in with to read what Candidates granted them Coach Access to. */
  email: string;
  /** Their public Cal.com booking page, shown to a Candidate once a Coaching Session is paid. */
  bookingUrl: string;
  /** A few words for Candidates choosing a Human Coach. Empty when none. */
  bio: string;
}

export type AddHumanCoachResult =
  | { ok: true; coach: HumanCoach }
  | { ok: false; errors: FieldError[] }
  /** Another (not retired) Human Coach already has this email. */
  | { ok: false; error: "email_taken" };

/** A Candidate who granted a Human Coach Coach Access, as that Human Coach sees them. */
export interface CoachedCandidate {
  id: string;
  /** Empty when the Candidate gave none. */
  name: string;
  email: string;
}

/** What a Human Coach reads of a Candidate who granted them Coach Access. */
export interface CandidateFile {
  candidate: CoachedCandidate;
  /** Every Profile, archived ones included, oldest first. */
  profiles: Profile[];
  /** Newest first. */
  applications: ApplicationSummary[];
}

/** One Application as a Human Coach reads it, with its Tailored Documents. */
export interface CoachedApplication {
  application: Application;
  /** The Tailored CV the Candidate saved, or null. Proposals still under the Candidate's review are not shown. */
  tailoredCv: SavedTailoredCv | null;
  coverLetter: CoverLetter | null;
  outreachMessage: OutreachMessage | null;
}

export interface HumanCoachesDeps {
  profiles: Pick<Profiles, "list" | "get">;
  applications: Pick<Applications, "list" | "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
}

export interface HumanCoaches {
  /** Adds a Human Coach (Back Office). `input` is untrusted: { name, email, bookingUrl, bio? }. */
  add(input: unknown): Promise<AddHumanCoachResult>;
  /** The Human Coaches Candidates can choose from, by name. */
  list(): Promise<HumanCoach[]>;
  /** Retires a Human Coach: no longer listed, and no longer reads anything. Their past Coaching Sessions are kept. */
  retire(coachId: string): Promise<void>;
  /** The (not retired) Human Coach a signed-in person is, by their verified email, or null. */
  coachSignedIn(person: { email: string; emailVerified: boolean }): Promise<HumanCoach | null>;

  /** The Candidate grants a Human Coach Coach Access. False for an unknown or retired Human Coach. Granting twice is harmless. */
  grantAccess(candidateId: string, coachId: string): Promise<boolean>;
  /** The Candidate takes Coach Access back; it ends at once. */
  revokeAccess(candidateId: string, coachId: string): Promise<void>;
  /** The ids of the Human Coaches the Candidate granted Coach Access to (retired ones left out). */
  accessGranted(candidateId: string): Promise<string[]>;

  /** The Candidates who granted the Human Coach Coach Access, by email. */
  candidates(coachId: string): Promise<CoachedCandidate[]>;
  /** The Candidate's Profiles and Applications, or null without Coach Access. Read only. */
  candidateFile(coachId: string, candidateId: string): Promise<CandidateFile | null>;
  /** One of the Candidate's Applications with its Tailored Documents, or null without Coach Access (or no such Application). Read only. */
  application(coachId: string, candidateId: string, applicationId: string): Promise<CoachedApplication | null>;
}

/** Cal.com's hosted sites (cal.com, its EU instance cal.eu, and their subdomains). */
const CAL_COM_HOSTS = /(^|\.)cal\.(com|eu)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Cal.com booking page: https, on Cal.com, naming someone (a path past "/"). */
function isCalComBookingPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CAL_COM_HOSTS.test(url.hostname) && url.pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}

const coachSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().trim().toLowerCase().max(320),
  bookingUrl: z.string().trim().max(500).refine(isCalComBookingPage),
  bio: z.string().trim().max(2000).default(""),
});

interface CoachRow {
  id: string;
  name: string;
  email: string;
  booking_url: string;
  bio: string;
}

const COACH_COLUMNS = "id, name, email, booking_url, bio";
const coachFrom = (row: CoachRow): HumanCoach => ({ id: row.id, name: row.name, email: row.email, bookingUrl: row.booking_url, bio: row.bio });

export function createHumanCoaches(database: Pool, deps: HumanCoachesDeps): HumanCoaches {
  /** The Candidate, if they granted this (not retired) Human Coach Coach Access. */
  async function coachedCandidate(coachId: string, candidateId: string): Promise<CoachedCandidate | null> {
    if (!UUID.test(coachId)) return null;
    const { rows } = await database.query<CoachedCandidate>(
      `SELECT c.id, coalesce(c.name, '') AS name, c.email
       FROM coach_access a
       JOIN human_coach h ON h.id = a.coach_id AND h.retired_at IS NULL
       JOIN candidate c ON c.id = a.candidate_id
       WHERE a.coach_id = $1 AND a.candidate_id = $2`,
      [coachId, candidateId],
    );
    return rows[0] ?? null;
  }

  return {
    async add(input) {
      const parsed = coachSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { name, email, bookingUrl, bio } = parsed.data;
      const { rows } = await database.query<CoachRow>(
        `INSERT INTO human_coach (name, email, booking_url, bio) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) WHERE retired_at IS NULL DO NOTHING
         RETURNING ${COACH_COLUMNS}`,
        [name, email, bookingUrl, bio],
      );
      return rows[0] ? { ok: true, coach: coachFrom(rows[0]) } : { ok: false, error: "email_taken" };
    },

    async list() {
      const { rows } = await database.query<CoachRow>(`SELECT ${COACH_COLUMNS} FROM human_coach WHERE retired_at IS NULL ORDER BY name, created_at`);
      return rows.map(coachFrom);
    },

    async retire(coachId) {
      if (!UUID.test(coachId)) return;
      await database.query("UPDATE human_coach SET retired_at = now() WHERE id = $1 AND retired_at IS NULL", [coachId]);
    },

    async coachSignedIn(person) {
      if (!person.emailVerified) return null;
      const { rows } = await database.query<CoachRow>(`SELECT ${COACH_COLUMNS} FROM human_coach WHERE email = $1 AND retired_at IS NULL`, [
        person.email.trim().toLowerCase(),
      ]);
      return rows[0] ? coachFrom(rows[0]) : null;
    },

    async grantAccess(candidateId, coachId) {
      if (!UUID.test(coachId)) return false;
      const { rows } = await database.query(
        `INSERT INTO coach_access (candidate_id, coach_id)
         SELECT $1, id FROM human_coach WHERE id = $2 AND retired_at IS NULL
         ON CONFLICT (candidate_id, coach_id) DO UPDATE SET coach_id = EXCLUDED.coach_id
         RETURNING coach_id`,
        [candidateId, coachId],
      );
      return rows.length > 0;
    },

    async revokeAccess(candidateId, coachId) {
      if (!UUID.test(coachId)) return;
      await database.query("DELETE FROM coach_access WHERE candidate_id = $1 AND coach_id = $2", [candidateId, coachId]);
    },

    async accessGranted(candidateId) {
      const { rows } = await database.query<{ coach_id: string }>(
        `SELECT a.coach_id FROM coach_access a JOIN human_coach h ON h.id = a.coach_id AND h.retired_at IS NULL
         WHERE a.candidate_id = $1 ORDER BY a.granted_at`,
        [candidateId],
      );
      return rows.map((row) => row.coach_id);
    },

    async candidates(coachId) {
      if (!UUID.test(coachId)) return [];
      const { rows } = await database.query<CoachedCandidate>(
        `SELECT c.id, coalesce(c.name, '') AS name, c.email
         FROM coach_access a
         JOIN human_coach h ON h.id = a.coach_id AND h.retired_at IS NULL
         JOIN candidate c ON c.id = a.candidate_id
         WHERE a.coach_id = $1 ORDER BY c.email`,
        [coachId],
      );
      return rows;
    },

    async candidateFile(coachId, candidateId) {
      const candidate = await coachedCandidate(coachId, candidateId);
      if (!candidate) return null;
      const [summaries, applications] = await Promise.all([deps.profiles.list(candidateId), deps.applications.list(candidateId)]);
      const profiles = (await Promise.all(summaries.map((summary) => deps.profiles.get(candidateId, summary.id)))).filter(
        (profile): profile is Profile => profile !== null,
      );
      return { candidate, profiles, applications };
    },

    async application(coachId, candidateId, applicationId) {
      if (!(await coachedCandidate(coachId, candidateId))) return null;
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return null;
      const [drafts, tailoredCv] = await Promise.all([
        deps.tailoredDocuments.get(candidateId, applicationId),
        deps.tailoredCvs.get(candidateId, applicationId),
      ]);
      return {
        application,
        tailoredCv: tailoredCv?.saved ?? null,
        coverLetter: drafts?.coverLetter ?? null,
        outreachMessage: drafts?.outreachMessage ?? null,
      };
    },
  };
}

/** Creates or upgrades the Human Coach tables. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateHumanCoaches(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS human_coach (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL,
      booking_url text NOT NULL,
      bio text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      retired_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS human_coach_email_idx ON human_coach (email) WHERE retired_at IS NULL;
    CREATE TABLE IF NOT EXISTS coach_access (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      coach_id uuid NOT NULL REFERENCES human_coach (id),
      granted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (candidate_id, coach_id)
    );
    CREATE INDEX IF NOT EXISTS coach_access_coach_id_idx ON coach_access (coach_id);
  `);
}
