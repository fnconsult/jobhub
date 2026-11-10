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
 * Each of these tells the other person by a Push notification (#699, ADR-0076), once, and never stops what was done:
 * the Candidate hears of a Coach Review and of their session's date entered, changed or cancelled by the coach; the
 * Human Coach (through the account of their email, once they have one, and while not retired) of Coach Access
 * granted, a session paid, and its date entered, changed, cancelled or withdrawn by the Candidate.
 * and `migrateHumanCoaches(database)` creates its tables.
 */
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import * as z from "zod";
import { frenchDateTime, type Application, type Applications, type ApplicationSummary } from "../applications";
import { nameForCoach } from "../candidate-identity/names";
import type { Profile, Profiles } from "../profiles";
import type { PushNotification, PushNotifier } from "../push-notifications";
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

/** A Candidate who granted a Human Coach Coach Access, as that Human Coach sees them (#922). */
export interface CoachedCandidate {
  id: string;
  /** « Marie Dupont »: their Given Name and Family Name (`nameForCoach`); empty when the Candidate gave none. */
  name: string;
  /** « Mimi »: their Preferred Name when it differs from their Given Name (« se fait appeler Mimi »); else null. */
  calledBy: string | null;
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
  /** "Marie D.": the Candidate's Given Name and the initial of their Family Name (`nameForCoach`); empty when they gave none. */
  candidateName: string;
  /** « Mimi »: their Preferred Name when it differs from their Given Name; else null. */
  candidateCalledBy: string | null;
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
  quoteId?:string;
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
  /** « Mimi »: their Preferred Name when it differs from their Given Name; else null. */
  candidateCalledBy: string | null;
}

export type CoachReviewResult =
  | { ok: true; review: CoachReview }
  | { ok: false; errors: FieldError[] }
  /** No Coach Access, no such Application, or no such Tailored Document on it yet. */
  | { ok: false; error: "not_found" };

export interface HumanCoachesDeps {
  publicProfileApprovalRequired?:()=>boolean;
  publishedCoachIds?:(ids:string[])=>Promise<string[]>;
  mayEnter?: (person: {email:string;emailVerified:boolean}, coachId:string) => Promise<boolean>;
  profiles: Pick<Profiles, "list" | "get">;
  applications: Pick<Applications, "list" | "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  /** The clock Coaching Session dates are entered, Rescheduled and cancelled by. */
  now?: () => Date;
  /** Where the Push notifications of a Coach Review, Coach Access and Coaching Sessions are queued. Without it, none. */
  push?: PushNotifier;
}

export interface HumanCoaches {
  /**
   * Adds a Human Coach (Back Office). `input` is untrusted: { name, email, bookingUrl, bio? }.
   * `within` runs it in the caller's transaction.
   */
  add(input: unknown, within?: Queryable): Promise<AddHumanCoachResult>;
  /** The Human Coaches Candidates can choose from, by name. */
  list(options?:{includePending?:boolean}): Promise<HumanCoach[]>;
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
  recordPaidSession(paid: PaidCoachingSession, financials?: (within: Queryable) => Promise<void>): Promise<boolean>;
  /** The Candidate's paid Coaching Sessions, newest first, retired Human Coaches included. */
  sessions(candidateId: string): Promise<CoachingSession[]>;
  /**
   * The Candidate enters or edits the date of one of their own Coaching Sessions, booked on the
   * Human Coach's Cal.com page (ADR-0027). `input` is untrusted: { scheduledAt (French time without
   * an offset), durationMinutes?, videoLink? (http or https), note? }; only supplied optional fields change.
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
   * videoLink? (http or https) }; only supplied optional fields change and it keeps the Candidate's note. The change is
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
    .transform((value) => (typeof value === "number" ? value : null)).optional(),
  videoLink: optionalText(500).refine((value) => value === null || isWebLink(value)).optional(),
  note: optionalText(500).optional(),
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

/** The Candidate's names as `nameForCoach` takes them, from `candidate c` (#922). */
const CANDIDATE_NAMES = `c.given_name AS "givenName", c.family_name AS "familyName", c.preferred_name AS "preferredName", c.name`;

interface CandidateNamesRow {
  givenName: string | null;
  familyName: string | null;
  preferredName: string | null;
  name: string | null;
}

/** A Coached Candidate from its row: named in full, « Marie Dupont », and the Preferred Name beside it. */
const coachedCandidateFrom = (row: CandidateNamesRow & { id: string; email: string }): CoachedCandidate => ({ id: row.id, ...nameForCoach(row), email: row.email });

/** The Candidate of a Coaching Session: « Marie D. », and the Preferred Name beside it. */
function sessionCandidate(row: CandidateNamesRow): { candidateName: string; candidateCalledBy: string | null } {
  const { name, calledBy } = nameForCoach(row, "short");
  return { candidateName: name, candidateCalledBy: calledBy };
}

const COACH_COLUMNS = "id, name, email, booking_url, bio";
const coachFrom = (row: CoachRow): HumanCoach => ({ id: row.id, name: row.name, email: row.email, bookingUrl: row.booking_url, bio: row.bio });

export function createHumanCoaches(database: Pool, deps: HumanCoachesDeps): HumanCoaches {
  const now = deps.now ?? (() => new Date());

  /** The Candidate, if they granted this (not retired) Human Coach Coach Access. */
  async function coachedCandidate(coachId: string, candidateId: string): Promise<CoachedCandidate | null> {
    if (!UUID.test(coachId)) return null;
    const { rows } = await database.query<CandidateNamesRow & { id: string; email: string }>(
      `SELECT c.id, ${CANDIDATE_NAMES}, c.email
       FROM coach_access a
       JOIN human_coach h ON h.id = a.coach_id AND h.retired_at IS NULL
       JOIN candidate c ON c.id = a.candidate_id
       WHERE a.coach_id = $1 AND a.candidate_id = $2`,
      [coachId, candidateId],
    );
    return rows[0] ? coachedCandidateFrom(rows[0]) : null;
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
    const { rows } = await database.query<CandidateNamesRow & { id: string; paid_at: Date; scheduled_at: Date | null; duration_minutes: number | null; video_link: string | null }>(
      `SELECT s.id, ${CANDIDATE_NAMES}, s.paid_at, s.scheduled_at, s.duration_minutes, s.video_link
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
      ...sessionCandidate(row),
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
    change: { to: Date | null; by: RescheduledBy; fields?: { durationMinutes?: number | null|undefined; videoLink?: string | null|undefined; note?: string | null|undefined } },
  ): Promise<boolean> {
    const set = await inTransaction(database, async (client) => {
      const { rows } = await client.query<{ scheduled_at: Date | null; candidate_id: string; coach_id: string }>(
        `SELECT s.scheduled_at, s.candidate_id, s.coach_id FROM coaching_session s WHERE s.id = $1 AND s.withdrawn_at IS NULL AND ${owned.where} FOR UPDATE OF s`,
        [sessionId, ...owned.params],
      );
      const session = rows[0];
      if (!session) return null;
      if (change.fields) {
        const updates=([['duration_minutes',change.fields.durationMinutes],['video_link',change.fields.videoLink],['note',change.fields.note]] as const).filter(([,value])=>value!==undefined);
        if(updates.length)await client.query(`UPDATE coaching_session SET ${updates.map(([column],index)=>`${column}=$${index+2}`).join(',')} WHERE id=$1`,[sessionId,...updates.map(([,value])=>value)]);
      }
      const changed = await setAgendaItemDate(client, { table: "coaching_session", id: sessionId }, { to: change.to, by: change.by, now: now() });
      // Who last entered or changed the date (« modifié par le coach »), kept beside the Reschedule history.
      if (changed) await client.query(`UPDATE coaching_session SET changed_by = $2 WHERE id = $1`, [sessionId, change.by]);
      return changed ? { ...session, moved: session.scheduled_at?.getTime() !== change.to?.getTime() } : null;
    });
    if (set?.moved) await sessionDateChanged(sessionId, set, change.by, change.to);
    return set !== null;
  }

  /** Queues `notification` for the person, under its key, once; a failure is logged, never thrown at what was done. */
  async function notify(personId: string | null, notification: PushNotification, once: string): Promise<void> {
    if (!personId || !deps.push) return;
    try {
      await deps.push.notify(personId, notification, { once });
    } catch (error) {
      console.warn(`[human-coaches] the ${notification.event} Push notification could not be queued:`, error instanceof Error ? error.message : error);
    }
  }

  /** The account a (not retired) Human Coach signs in with, by their email, once they have one; else null. */
  async function coachAccount(coachId: string): Promise<string | null> {
    const { rows } = await database.query<{ id: string }>(
      `SELECT c.id FROM human_coach h JOIN candidate c ON lower(c.email) = h.email AND c."emailVerified" WHERE h.id = $1 AND h.retired_at IS NULL`,
      [coachId],
    );
    return rows[0]?.id ?? null;
  }

  /** Tells the other person of a session's date entered, changed (`to`), cancelled (null) or withdrawn by `by`. */
  async function sessionDateChanged(sessionId: string, session: { candidate_id: string; coach_id: string }, by: RescheduledBy, to: Date | null | "withdrawn"): Promise<void> {
    // The change itself: its new date, or none, and when it was made.
    const once = `${sessionId}:${to instanceof Date ? to.toISOString() : (to ?? "cancelled")}:${now().toISOString()}`;
    if (by === "coach") await notify(session.candidate_id, { event: "coaching_session_changed" }, `coaching_session_changed:${once}`);
    else await notify(await coachAccount(session.coach_id), { event: "coaching_session_changed_by_candidate" }, `coaching_session_changed_by_candidate:${once}`);
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
        `INSERT INTO human_coach (name, email, booking_url, bio,public_ready) VALUES ($1, $2, $3, $4,$5)
         ON CONFLICT (email) WHERE retired_at IS NULL DO NOTHING
         RETURNING ${COACH_COLUMNS}`,
        [name, email, bookingUrl, bio,!(deps.publicProfileApprovalRequired?.()??false)],
      );
      return rows[0] ? { ok: true, coach: coachFrom(rows[0]) } : { ok: false, error: "email_taken" };
    },

    async list(options={}) {
      const { rows } = await database.query<CoachRow>(`SELECT ${COACH_COLUMNS} FROM human_coach WHERE retired_at IS NULL AND ($1::boolean OR (NOT contract_pending AND public_ready)) ORDER BY name, created_at`,[options.includePending??false]);
      const coaches=rows.map(coachFrom);
      if(options.includePending||!deps.publishedCoachIds)return coaches;
      const published=new Set(await deps.publishedCoachIds(coaches.map(c=>c.id)));
      return coaches.filter(c=>published.has(c.id));
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
      const { rows } = await database.query<CoachRow>(`SELECT ${COACH_COLUMNS} FROM human_coach WHERE email = $1 AND retired_at IS NULL AND NOT contract_pending`, [
        person.email.trim().toLowerCase(),
      ]);
      return rows[0] && (!deps.mayEnter || await deps.mayEnter(person,rows[0].id)) ? coachFrom(rows[0]) : null;
    },

    async grantAccess(candidateId, coachId) {
      if (!UUID.test(coachId)) return false;
      const { rows } = await database.query<{ granted: boolean; granted_at: Date }>(
        `INSERT INTO coach_access (candidate_id, coach_id)
         SELECT $1, id FROM human_coach WHERE id = $2 AND retired_at IS NULL
         ON CONFLICT (candidate_id, coach_id) DO UPDATE SET coach_id = EXCLUDED.coach_id
         RETURNING (xmax = 0) AS granted, granted_at`,
        [candidateId, coachId],
      );
      const access = rows[0];
      if (!access) return false;
      // Granted now, not again: the Human Coach hears of it.
      if (access.granted) await notify(await coachAccount(coachId), { event: "coach_access_granted", candidateId }, `coach_access_granted:${candidateId}:${access.granted_at.toISOString()}`);
      return true;
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
      const { rows } = await database.query<CandidateNamesRow & { id: string; email: string }>(
        `SELECT c.id, ${CANDIDATE_NAMES}, c.email
         FROM coach_access a
         JOIN human_coach h ON h.id = a.coach_id AND h.retired_at IS NULL
         JOIN candidate c ON c.id = a.candidate_id
         WHERE a.coach_id = $1 ORDER BY c.email`,
        [coachId],
      );
      return rows.map(coachedCandidateFrom);
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
      const review = reviewFrom(rows[0]!);
      await notify(candidateId, { event: "coach_review", applicationId }, `coach_review:${review.id}`);
      return { ok: true, review };
    },

    reviews: reviewsOf,

    async recordPaidSession(paid, financials) {
      const {checkoutSessionId,candidateId,coachId,amount,currency}=paid;
      if (!UUID.test(coachId)) return false;
      const record=async(within:Queryable)=>{
        const {rows}=await within.query<{recorded:boolean}>(`INSERT INTO coaching_session (stripe_checkout_session_id,candidate_id,coach_id,amount,currency,coaching_quote_id)
          SELECT $1,c.id,h.id,$4,$5,$6 FROM candidate c,human_coach h WHERE c.id=$2 AND h.id=$3
          ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET stripe_checkout_session_id=EXCLUDED.stripe_checkout_session_id,coaching_quote_id=coalesce(coaching_session.coaching_quote_id,EXCLUDED.coaching_quote_id)
          RETURNING (xmax=0) AS recorded`,[checkoutSessionId,candidateId,coachId,amount,currency.toLowerCase(),paid.quoteId??null]);
        if(rows[0]&&financials)await financials(within);
        return rows[0]??null;
      };
      const row=financials?await inTransaction(database,record):await record(database);
      if(!row)return false;
      // Financial callbacks have committed: a failed snapshot never exposes a session or a premature notification.
      if(row.recorded)await notify(await coachAccount(coachId),{event:"coaching_session_paid"},`coaching_session_paid:${checkoutSessionId}`);
      return true;
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
      let withdrawn: { candidate_id: string; coach_id: string } | undefined;
      const result = await inTransaction(database, async (client) => {
        const { rows } = await client.query<CandidateNamesRow & {
          coach_id: string;
          stripe_checkout_session_id: string;
          amount: number;
          currency: string;
          paid_at: Date;
          scheduled_at: Date | null;
          coach_name: string;
          coach_email: string;
        }>(
          `SELECT s.coach_id, s.stripe_checkout_session_id, s.amount, s.currency, s.paid_at, s.scheduled_at, h.name AS coach_name, h.email AS coach_email, ${CANDIDATE_NAMES}
             FROM coaching_session s JOIN human_coach h ON h.id = s.coach_id JOIN candidate c ON c.id = s.candidate_id
            WHERE s.id = $1 AND s.candidate_id = $2 AND s.withdrawn_at IS NULL AND ($4 OR s.scheduled_at IS NULL OR s.scheduled_at > $3)
            FOR UPDATE OF s`,
          [sessionId, candidateId, now(), options.evenIfHeld === true],
        );
        const session = rows[0];
        if (!session) return null;
        withdrawn = { candidate_id: candidateId, coach_id: session.coach_id };
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
          ...sessionCandidate(session),
        };
      });
      // Its Human Coach hears of it, as of a cancellation.
      if (withdrawn) await sessionDateChanged(sessionId, withdrawn, "candidate", "withdrawn");
      return result;
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
    ALTER TABLE human_coach ADD COLUMN IF NOT EXISTS contract_pending boolean NOT NULL DEFAULT false;
    ALTER TABLE human_coach ADD COLUMN IF NOT EXISTS public_ready boolean NOT NULL DEFAULT true;
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
    ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS coaching_quote_id text;
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
