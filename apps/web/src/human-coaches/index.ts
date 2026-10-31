/**
 * Human Coaches (CONTEXT.md): the HR professionals Jobbbox selects, whom a
 * Candidate books for paid Coaching Sessions and may grant Coach Access to.
 *
 * One deep module. `createHumanCoaches(database, deps)` answers:
 *  - who are the Human Coaches?        `add`, `list`, `retire` (Back Office), `coachSignedIn`
 *  - whom may they read?               `grantAccess`, `revokeAccess`, `accessGranted` (the Candidate's Coach Access)
 *  - what do they read?                `candidates`, `candidateFile`, `application` (read only)
 *  - what did the Candidate pay for?  `recordPaidSession` (Stripe's webhook), `sessions`, `scheduleSession`, `cancelSession`
 *  - whom does the coach meet?         `coachSessions`, `scheduleCoachedSession`, `cancelCoachedSession` (the Coach space)
 *  - what did the Candidate withdraw from?  `withdrawSession` (a Withdrawal, #511): a withdrawn session leaves every list
 * A date change more than an hour after the date was entered or last changed is a Reschedule, kept in the
 * session's Reschedule history; a cancellation clears the date (back to Unscheduled) and is kept there too.
 * and `migrateHumanCoaches(database)` creates its tables.
 */
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import * as z from "zod";
import { frenchDateTime, type Application, type Applications, type ApplicationSummary } from "../applications";
import type { Profile, Profiles } from "../profiles";
import { migrateRescheduleHistory, rescheduleHistories, setAgendaItemDate, type Reschedule, type RescheduledBy } from "../reschedules";
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
  /** When it takes place, as the Candidate entered it; null while it is an Unscheduled Coaching Session. */
  scheduledAt: Date | null;
  durationMinutes: number | null;
  /** Where it takes place: an http(s) link. */
  videoLink: string | null;
  note: string | null;
  /** Who last entered or changed its date: the Agenda says « modifié par le coach » for "coach". Null while never dated. */
  changedBy: SessionEditor | null;
  /** Its Reschedule history, oldest first: Reschedules, and cancellations (`newAt` null), by the Candidate or the Human Coach. */
  reschedules: Reschedule[];
}

/** Who enters or changes a Coaching Session's date (ADR-0027). */
export type SessionEditor = "candidate" | "coach";

/**
 * One of a Human Coach's own Coaching Sessions, as the Coach space shows it. The session itself is the
 * relationship, so no Coach Access is needed: it names the Candidate (first name and last initial),
 * nothing of their Profiles or Applications, and leaves out their note.
 */
export interface CoachedSession {
  id: string;
  /** "Marie D.": the first name and last initial of the Candidate's account name; empty when they gave none. */
  candidateName: string;
  paidAt: Date;
  /** Null while it is an Unscheduled Coaching Session (« À planifier »). */
  scheduledAt: Date | null;
  durationMinutes: number | null;
  videoLink: string | null;
  /** Its Reschedule history, oldest first, as the Coach space shows it. */
  reschedules: Reschedule[];
}

export type ScheduleCoachedSessionResult =
  | { ok: true; session: CoachedSession }
  | { ok: false; errors: FieldError[] }
  /** No such Coaching Session of this Human Coach, or they are retired. */
  | { ok: false; error: "not_found" };

export type ScheduleSessionResult =
  | { ok: true; session: CoachingSession }
  | { ok: false; errors: FieldError[] }
  /** No such Coaching Session of this Candidate. */
  | { ok: false; error: "not_found" };

/** A Coaching Session payment Stripe confirmed. */
export interface PaidCoachingSession {
  /** The Stripe Checkout Session it was paid through: one Coaching Session per Checkout Session. */
  checkoutSessionId: string;
  candidateId: string;
  coachId: string;
  amount: number;
  currency: string;
}

/** A Coaching Session the Candidate withdrew from (#511), as it was: what refunds it and whom to tell. */
export interface WithdrawnCoachingSession {
  /** The Stripe Checkout Session it was paid through. */
  checkoutSessionId: string;
  amount: number;
  currency: string;
  paidAt: Date;
  /** Its date before it was cancelled (or when it took place, `held`); null when it was Unscheduled. */
  scheduledAt: Date | null;
  /** Whether it had already taken place: withdrawn all the same, bought without the Immediate Performance Request (#512). */
  held: boolean;
  coach: { name: string; email: string };
  /** "Marie D.": how the Candidate is named to the Human Coach; empty when they gave no name. */
  candidateName: string;
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
  /** The clock Coaching Session dates are entered, Rescheduled and cancelled by. */
  now?: () => Date;
}

export interface HumanCoaches {
  /**
   * Adds a Human Coach (Back Office). `input` is untrusted: { name, email, bookingUrl, bio? }.
   * `within` runs it in the caller's transaction.
   */
  add(input: unknown, within?: Queryable): Promise<AddHumanCoachResult>;
  /** The Human Coaches Candidates can choose from, by name. */
  list(): Promise<HumanCoach[]>;
  /**
   * Retires a Human Coach: no longer listed, and no longer reads anything. Their past Coaching
   * Sessions are kept. Returns who was retired, or null (unknown or already retired).
   * `within` runs it in the caller's transaction.
   */
  retire(coachId: string, within?: Queryable): Promise<HumanCoach | null>;
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
  /**
   * The Candidate enters or edits the date of one of their own Coaching Sessions, booked on the
   * Human Coach's Cal.com page (ADR-0027). `input` is untrusted: { scheduledAt (French time without
   * an offset), durationMinutes?, videoLink? (http or https), note? }; it replaces all four.
   * "not_found" for anyone else's session. A Candidate never deletes a Coaching Session.
   */
  scheduleSession(candidateId: string, sessionId: string, input: unknown): Promise<ScheduleSessionResult>;

  /**
   * The (not retired) Human Coach's own Coaching Sessions, with every Candidate, whether or not they
   * granted Coach Access: Unscheduled ones first (oldest paid first), then the dated ones, latest first.
   * Empty for a Retired Human Coach (ADR-0016) or an unknown one.
   */
  coachSessions(coachId: string): Promise<CoachedSession[]>;
  /**
   * The (not retired) Human Coach enters or corrects the date of one of their own Coaching Sessions
   * (ADR-0027). `input` is untrusted: { scheduledAt (French time without an offset), durationMinutes?,
   * videoLink? (http or https) }; it replaces those three and keeps the Candidate's note. The change is
   * recorded as the coach's. "not_found" for another coach's session, or for a Retired Human Coach.
   */
  scheduleCoachedSession(coachId: string, sessionId: string, input: unknown): Promise<ScheduleCoachedSessionResult>;

  /**
   * The Candidate cancels one of their own Coaching Sessions: its date is cleared, so it is Unscheduled again
   * (« À planifier »), and the cancellation is kept in its Reschedule history. Refunds are handled outside
   * Jobbbox. Cancelling an Unscheduled one changes nothing. "not_found" for anyone else's session.
   */
  cancelSession(candidateId: string, sessionId: string): Promise<ScheduleSessionResult>;
  /**
   * The (not retired) Human Coach cancels one of their own Coaching Sessions, as `cancelSession` does,
   * recorded as theirs. "not_found" for another coach's session, or for a Retired Human Coach.
   */
  cancelCoachedSession(coachId: string, sessionId: string): Promise<{ ok: true } | { ok: false; error: "not_found" }>;

  /**
   * The Candidate withdraws from one of their own Coaching Sessions not held yet (Unscheduled, or dated later than now):
   * its date is cleared (the cancellation kept in its Reschedule history) and it leaves the Candidate's sessions, the
   * Agenda and the Coach space. Returns it as it was, to refund it and tell its Human Coach; null for a session held
   * already, withdrawn already, or anyone else's. The refund is the caller's. With `evenIfHeld` (one bought without the
   * Immediate Performance Request, #512), a session held is withdrawn too, keeping its date.
   */
  withdrawSession(candidateId: string, sessionId: string, options?: { evenIfHeld?: boolean }): Promise<WithdrawnCoachingSession | null>;
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

/** An http or https link, as typed. */
function isWebLink(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** An optional text field: blank is none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const scheduleSchema = z.object({
  /** Blank is "required", not "invalid". */
  scheduledAt: z.string().trim().min(1).pipe(frenchDateTime),
  /** Blank is none. */
  durationMinutes: z
    .union([z.number().int().min(5).max(600), z.literal("")])
    .nullish()
    .transform((value) => (typeof value === "number" ? value : null)),
  videoLink: optionalText(500).refine((value) => value === null || isWebLink(value)),
  note: optionalText(500),
});

/** What a Human Coach enters: the Candidate's note is not theirs to change. */
const coachScheduleSchema = scheduleSchema.omit({ note: true });

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

/** "Marie D.": the first word of `fullName` and the initial of its last word. */
function firstNameAndLastInitial(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  if (words.length < 2) return first;
  const initial = Array.from(words.at(-1)!)[0]!.toLocaleUpperCase("fr");
  return `${first} ${initial}.`;
}

const COACH_COLUMNS = "id, name, email, booking_url, bio";
const coachFrom = (row: CoachRow): HumanCoach => ({ id: row.id, name: row.name, email: row.email, bookingUrl: row.booking_url, bio: row.bio });

export function createHumanCoaches(database: Pool, deps: HumanCoachesDeps): HumanCoaches {
  const now = deps.now ?? (() => new Date());

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

  /** The Candidate's Coaching Sessions (or the one `sessionId` names), newest first. */
  async function sessionsOf(candidateId: string, sessionId?: string): Promise<CoachingSession[]> {
    const { rows } = await database.query<
      CoachRow & {
        session_id: string;
        amount: number;
        currency: string;
        paid_at: Date;
        scheduled_at: Date | null;
        duration_minutes: number | null;
        video_link: string | null;
        note: string | null;
        changed_by: SessionEditor | null;
      }
    >(
      `SELECT s.id AS session_id, s.amount, s.currency, s.paid_at, s.scheduled_at, s.duration_minutes, s.video_link, s.note, s.changed_by,
              h.id, h.name, h.email, h.booking_url, h.bio
       FROM coaching_session s JOIN human_coach h ON h.id = s.coach_id
       WHERE s.candidate_id = $1 AND s.withdrawn_at IS NULL AND ($2::uuid IS NULL OR s.id = $2) ORDER BY s.paid_at DESC, s.id`,
      [candidateId, sessionId ?? null],
    );
    const histories = await rescheduleHistories(
      database,
      "coaching_session",
      rows.map((row) => row.session_id),
    );
    return rows.map((row) => ({
      id: row.session_id,
      coach: coachFrom(row),
      amount: row.amount,
      currency: row.currency,
      paidAt: row.paid_at,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      videoLink: row.video_link,
      note: row.note,
      changedBy: row.changed_by,
      reschedules: histories.get(row.session_id)!,
    }));
  }

  /** The (not retired) Human Coach's Coaching Sessions (or the one `sessionId` names), « À planifier » first, then latest first. */
  async function coachSessionsOf(coachId: string, sessionId?: string): Promise<CoachedSession[]> {
    if (!UUID.test(coachId)) return [];
    const { rows } = await database.query<{ id: string; candidate_name: string | null; paid_at: Date; scheduled_at: Date | null; duration_minutes: number | null; video_link: string | null }>(
      `SELECT s.id, c.name AS candidate_name, s.paid_at, s.scheduled_at, s.duration_minutes, s.video_link
         FROM coaching_session s
         JOIN human_coach h ON h.id = s.coach_id AND h.retired_at IS NULL
         JOIN candidate c ON c.id = s.candidate_id
        WHERE s.coach_id = $1 AND s.withdrawn_at IS NULL AND ($2::uuid IS NULL OR s.id = $2)
        ORDER BY s.scheduled_at DESC NULLS FIRST, s.paid_at, s.id`,
      [coachId, sessionId ?? null],
    );
    const histories = await rescheduleHistories(database, "coaching_session", rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      candidateName: firstNameAndLastInitial(row.candidate_name ?? ""),
      paidAt: row.paid_at,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      videoLink: row.video_link,
      reschedules: histories.get(row.id)!,
    }));
  }

  /**
   * Sets the date of the Coaching Session `sessionId` names, if `owned` (a condition on `coaching_session s`
   * with `$1` the session's id) finds it, and `fields`: its duration, video link and note, when given. The
   * date goes through `setAgendaItemDate`, which keeps its Reschedules. False when not found.
   */
  async function setSessionDate(
    sessionId: string,
    owned: { where: string; params: unknown[] },
    change: { to: Date | null; by: RescheduledBy; fields?: { durationMinutes: number | null; videoLink: string | null; note?: string | null } },
  ): Promise<boolean> {
    return inTransaction(database, async (client) => {
      const { rows } = await client.query(`SELECT s.id FROM coaching_session s WHERE s.id = $1 AND s.withdrawn_at IS NULL AND ${owned.where} FOR UPDATE OF s`, [
        sessionId,
        ...owned.params,
      ]);
      if (!rows[0]) return false;
      if (change.fields) {
        const { durationMinutes, videoLink, note } = change.fields;
        if (note === undefined) {
          await client.query(`UPDATE coaching_session SET duration_minutes = $2, video_link = $3 WHERE id = $1`, [sessionId, durationMinutes, videoLink]);
        } else {
          await client.query(`UPDATE coaching_session SET duration_minutes = $2, video_link = $3, note = $4 WHERE id = $1`, [sessionId, durationMinutes, videoLink, note]);
        }
      }
      const changed = await setAgendaItemDate(client, { table: "coaching_session", id: sessionId }, { to: change.to, by: change.by, now: now() });
      // Who last entered or changed the date (« modifié par le coach »), kept beside the Reschedule history.
      if (changed) await client.query(`UPDATE coaching_session SET changed_by = $2 WHERE id = $1`, [sessionId, change.by]);
      return changed;
    });
  }

  /** The Candidate's own session, after a change: the result to give back. */
  async function sessionResult(candidateId: string, sessionId: string, changed: boolean): Promise<ScheduleSessionResult> {
    const session = changed ? (await sessionsOf(candidateId, sessionId))[0] : undefined;
    return session ? { ok: true, session } : { ok: false, error: "not_found" };
  }

  /** The Human Coach's own session, after a change: the result to give back. */
  async function coachSessionResult(coachId: string, sessionId: string, changed: boolean): Promise<ScheduleCoachedSessionResult> {
    const session = changed ? (await coachSessionsOf(coachId, sessionId))[0] : undefined;
    return session ? { ok: true, session } : { ok: false, error: "not_found" };
  }

  const DOCUMENT_OF = { tailored_cv: "tailoredCv", cover_letter: "coverLetter", outreach_message: "outreachMessage" } as const;

  return {
    async add(input, within = database) {
      const parsed = coachSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { name, email, bookingUrl, bio } = parsed.data;
      const { rows } = await within.query<CoachRow>(
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

    async retire(coachId, within = database) {
      if (!UUID.test(coachId)) return null;
      const { rows } = await within.query<CoachRow>(
        `UPDATE human_coach SET retired_at = now() WHERE id = $1 AND retired_at IS NULL RETURNING ${COACH_COLUMNS}`,
        [coachId],
      );
      return rows[0] ? coachFrom(rows[0]) : null;
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
      return sessionsOf(candidateId);
    },

    coachSessions: (coachId) => coachSessionsOf(coachId),

    async scheduleCoachedSession(coachId, sessionId, input) {
      const parsed = coachScheduleSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(coachId) || !UUID.test(sessionId)) return { ok: false, error: "not_found" };
      const { scheduledAt, durationMinutes, videoLink } = parsed.data;
      const changed = await setSessionDate(
        sessionId,
        { where: "s.coach_id = $2 AND EXISTS (SELECT 1 FROM human_coach h WHERE h.id = s.coach_id AND h.retired_at IS NULL)", params: [coachId] },
        { to: scheduledAt, by: "coach", fields: { durationMinutes, videoLink } },
      );
      return coachSessionResult(coachId, sessionId, changed);
    },

    async scheduleSession(candidateId, sessionId, input) {
      const parsed = scheduleSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(sessionId)) return { ok: false, error: "not_found" };
      const { scheduledAt, durationMinutes, videoLink, note } = parsed.data;
      const changed = await setSessionDate(sessionId, { where: "s.candidate_id = $2", params: [candidateId] }, { to: scheduledAt, by: "candidate", fields: { durationMinutes, videoLink, note } });
      return sessionResult(candidateId, sessionId, changed);
    },

    async cancelSession(candidateId, sessionId) {
      if (!UUID.test(sessionId)) return { ok: false, error: "not_found" };
      const changed = await setSessionDate(sessionId, { where: "s.candidate_id = $2", params: [candidateId] }, { to: null, by: "candidate" });
      return sessionResult(candidateId, sessionId, changed);
    },

    async cancelCoachedSession(coachId, sessionId) {
      if (!UUID.test(coachId) || !UUID.test(sessionId)) return { ok: false, error: "not_found" };
      const changed = await setSessionDate(
        sessionId,
        { where: "s.coach_id = $2 AND EXISTS (SELECT 1 FROM human_coach h WHERE h.id = s.coach_id AND h.retired_at IS NULL)", params: [coachId] },
        { to: null, by: "coach" },
      );
      return changed ? { ok: true } : { ok: false, error: "not_found" };
    },

    async withdrawSession(candidateId, sessionId, options = {}) {
      if (!UUID.test(sessionId)) return null;
      return inTransaction(database, async (client) => {
        const { rows } = await client.query<{
          stripe_checkout_session_id: string;
          amount: number;
          currency: string;
          paid_at: Date;
          scheduled_at: Date | null;
          coach_name: string;
          coach_email: string;
          candidate_name: string | null;
        }>(
          `SELECT s.stripe_checkout_session_id, s.amount, s.currency, s.paid_at, s.scheduled_at, h.name AS coach_name, h.email AS coach_email, c.name AS candidate_name
             FROM coaching_session s JOIN human_coach h ON h.id = s.coach_id JOIN candidate c ON c.id = s.candidate_id
            WHERE s.id = $1 AND s.candidate_id = $2 AND s.withdrawn_at IS NULL AND ($4 OR s.scheduled_at IS NULL OR s.scheduled_at > $3)
            FOR UPDATE OF s`,
          [sessionId, candidateId, now(), options.evenIfHeld === true],
        );
        const session = rows[0];
        if (!session) return null;
        const held = session.scheduled_at !== null && session.scheduled_at <= now();
        // A session held keeps its date: it took place.
        if (!held) await setAgendaItemDate(client, { table: "coaching_session", id: sessionId }, { to: null, by: "candidate", now: now() });
        await client.query("UPDATE coaching_session SET withdrawn_at = $2 WHERE id = $1", [sessionId, now()]);
        return {
          checkoutSessionId: session.stripe_checkout_session_id,
          amount: session.amount,
          currency: session.currency,
          paidAt: session.paid_at,
          scheduledAt: session.scheduled_at,
          held,
          coach: { name: session.coach_name, email: session.coach_email },
          candidateName: firstNameAndLastInitial(session.candidate_name ?? ""),
        };
      });
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
    -- Its date and where it takes place, entered by hand once booked on Cal.com (ADR-0027); null while unscheduled.
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS duration_minutes integer CHECK (duration_minutes > 0);
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS video_link text;
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS note text;
    -- Who last entered or changed its date (#249): the Candidate or the Human Coach; null while never dated.
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS changed_by text CHECK (changed_by IN ('candidate', 'coach'));
    UPDATE coaching_session SET changed_by = 'candidate' WHERE changed_by IS NULL AND scheduled_at IS NOT NULL;
    -- When the Candidate withdrew from it (#511): refunded, it leaves the Agenda and the Coach space.
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
  `);
  // Dates entered before Reschedules were kept are taken as entered when the session was paid.
  await migrateRescheduleHistory(database, "coaching_session", { enteredAt: "paid_at" });
}
