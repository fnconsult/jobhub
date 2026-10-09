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
import { MAX_REVIEW_LENGTH, REVIEWED_DOCUMENTS, type ReviewedDocument } from "./kinds";

export { MAX_REVIEW_LENGTH, REVIEWED_DOCUMENTS, type ReviewedDocument } from "./kinds";

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
  /** Every Coach Review of the Application, oldest first, whichever Human Coach gave it. */
  reviews: CoachReview[];
}

/** A Human Coach's feedback on one Tailored Document of an Application, for the Candidate. */
export interface CoachReview {
  id: string;
  coach: { id: string; name: string };
  document: ReviewedDocument;
  text: string;
  createdAt: Date;
}

/** A Coaching Session the Candidate paid for (ADR-0014 style: recorded from Stripe's signed webhook only). */
export interface CoachingSession {
  id: string;
  /** With their booking link, where the Candidate picks the session's time on Cal.com. */
  coach: HumanCoach;
  /** What was paid, in the currency's smallest unit (cents). */
  amount: number;
  currency: string;
  paidAt: Date;
}

/** A Coaching Session payment Stripe confirmed. */
export interface PaidCoachingSession {
  /** The Stripe Checkout Session it was paid through: one Coaching Session per Checkout Session. */
  checkoutSessionId: string;
  candidateId: string;
  coachId: string;
  amount: number;
  currency: string;
}

export type CoachReviewResult =
  | { ok: true; review: CoachReview }
  | { ok: false; errors: FieldError[] }
  /** No Coach Access, no such Application, or no such Tailored Document on it yet. */
  | { ok: false; error: "not_found" };

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
  /**
   * A Human Coach with Coach Access reviews one of the Application's Tailored Documents.
   * `input` is untrusted: { document, text }. The document must exist (a saved Tailored CV, a drafted letter or message).
   */
  review(coachId: string, candidateId: string, applicationId: string, input: unknown): Promise<CoachReviewResult>;
  /** The Coach Reviews of the Candidate's Application, oldest first; kept after Coach Access is revoked. */
  reviews(candidateId: string, applicationId: string): Promise<CoachReview[]>;

  /**
   * Records a Coaching Session Stripe confirmed as paid. Idempotent per Checkout Session, safe
   * under concurrent deliveries. False (nothing recorded) for an unknown Human Coach or Candidate.
   */
  recordPaidSession(paid: PaidCoachingSession): Promise<boolean>;
  /** The Candidate's paid Coaching Sessions, newest first, retired Human Coaches included. */
  sessions(candidateId: string): Promise<CoachingSession[]>;
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

const reviewSchema = z.object({
  document: z.enum(REVIEWED_DOCUMENTS),
  text: z.string().trim().min(1).max(MAX_REVIEW_LENGTH),
});

interface ReviewRow {
  id: string;
  coach_id: string;
  coach_name: string;
  document: ReviewedDocument;
  text: string;
  created_at: Date;
}

const reviewFrom = (row: ReviewRow): CoachReview => ({
  id: row.id,
  coach: { id: row.coach_id, name: row.coach_name },
  document: row.document,
  text: row.text,
  createdAt: row.created_at,
});

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

  async function reviewsOf(candidateId: string, applicationId: string): Promise<CoachReview[]> {
    if (!UUID.test(applicationId)) return [];
    const { rows } = await database.query<ReviewRow>(
      `SELECT r.id, r.coach_id, h.name AS coach_name, r.document, r.text, r.created_at
       FROM coach_review r JOIN human_coach h ON h.id = r.coach_id
       WHERE r.candidate_id = $1 AND r.application_id = $2 ORDER BY r.created_at, r.id`,
      [candidateId, applicationId],
    );
    return rows.map(reviewFrom);
  }

  /** The Application as the Human Coach may read it, or null. */
  async function coachedApplication(coachId: string, candidateId: string, applicationId: string): Promise<CoachedApplication | null> {
    if (!(await coachedCandidate(coachId, candidateId))) return null;
    const application = await deps.applications.get(candidateId, applicationId);
    if (!application) return null;
    const [drafts, tailoredCv, reviews] = await Promise.all([
      deps.tailoredDocuments.get(candidateId, applicationId),
      deps.tailoredCvs.get(candidateId, applicationId),
      reviewsOf(candidateId, applicationId),
    ]);
    return {
      application,
      tailoredCv: tailoredCv?.saved ?? null,
      coverLetter: drafts?.coverLetter ?? null,
      outreachMessage: drafts?.outreachMessage ?? null,
      reviews,
    };
  }

  const DOCUMENT_OF = { tailored_cv: "tailoredCv", cover_letter: "coverLetter", outreach_message: "outreachMessage" } as const;

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

    application: coachedApplication,

    async review(coachId, candidateId, applicationId, input) {
      const parsed = reviewSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { document, text } = parsed.data;
      const application = await coachedApplication(coachId, candidateId, applicationId);
      if (!application?.[DOCUMENT_OF[document]]) return { ok: false, error: "not_found" };
      const { rows } = await database.query<ReviewRow>(
        `WITH inserted AS (
           INSERT INTO coach_review (candidate_id, application_id, coach_id, document, text) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, coach_id, document, text, created_at
         )
         SELECT inserted.*, h.name AS coach_name FROM inserted JOIN human_coach h ON h.id = inserted.coach_id`,
        [candidateId, applicationId, coachId, document, text],
      );
      return { ok: true, review: reviewFrom(rows[0]!) };
    },

    reviews: reviewsOf,

    async recordPaidSession({ checkoutSessionId, candidateId, coachId, amount, currency }) {
      if (!UUID.test(coachId)) return false;
      const { rows } = await database.query(
        `INSERT INTO coaching_session (stripe_checkout_session_id, candidate_id, coach_id, amount, currency)
         SELECT $1, c.id, h.id, $4, $5 FROM candidate c, human_coach h WHERE c.id = $2 AND h.id = $3
         ON CONFLICT (stripe_checkout_session_id) DO UPDATE SET stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id
         RETURNING id`,
        [checkoutSessionId, candidateId, coachId, amount, currency.toLowerCase()],
      );
      return rows.length > 0;
    },

    async sessions(candidateId) {
      const { rows } = await database.query<CoachRow & { session_id: string; amount: number; currency: string; paid_at: Date }>(
        `SELECT s.id AS session_id, s.amount, s.currency, s.paid_at, h.id, h.name, h.email, h.booking_url, h.bio
         FROM coaching_session s JOIN human_coach h ON h.id = s.coach_id
         WHERE s.candidate_id = $1 ORDER BY s.paid_at DESC, s.id`,
        [candidateId],
      );
      return rows.map((row) => ({ id: row.session_id, coach: coachFrom(row), amount: row.amount, currency: row.currency, paidAt: row.paid_at }));
    },
  };
}

/** Creates or upgrades the Human Coach tables. Run after the Candidate and Application tables. Safe to run repeatedly. */
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
    CREATE TABLE IF NOT EXISTS coach_review (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      coach_id uuid NOT NULL REFERENCES human_coach (id),
      document text NOT NULL CHECK (document IN (${REVIEWED_DOCUMENTS.map((kind) => `'${kind}'`).join(", ")})),
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS coach_review_application_id_idx ON coach_review (application_id);
    CREATE TABLE IF NOT EXISTS coaching_session (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      stripe_checkout_session_id text NOT NULL UNIQUE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      coach_id uuid NOT NULL REFERENCES human_coach (id),
      amount integer NOT NULL CHECK (amount >= 0),
      currency text NOT NULL,
      paid_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS coaching_session_candidate_id_idx ON coaching_session (candidate_id);
  `);
}
