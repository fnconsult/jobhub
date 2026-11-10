/**
 * Applications: the link between one of a Candidate's Profiles and one Job
 * Offer, created when the Candidate saves the offer, and followed through its
 * Application Status.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createApplications(database, { jobOffers, profiles, sentByShareCapture, now })`:
 *    - `save` a Job Offer with one of the Candidate's Profiles. A Candidate has at
 *      most one Application per Job Offer: saving it again returns the one they have.
 *      Creating it replaces the Job Offer's « Écartée » in the Offer box (ADR-0090): the
 *      latest decision wins, and deleting the Application leaves its entry à traiter.
 *      Saved from the extension's Side Panel (`extension`), or of a Job Offer the
 *      Candidate sent by Share capture (`sentByShareCapture`), wherever it is saved, it is an
 *      Arrival too (#819): its entry is made, already « Suivie », or completed with the source
 *      « Extension » or « Partage », in the same transaction; anything else saved makes none.
 *      An Application they had already arrives at the moment it is saved again, so its entry
 *      keeps its day and Profile;
 *    - `list` the Candidate's Applications (newest first) for the list and board views;
 *    - `matchScores` the Match Score of each, for Mes candidatures' list;
 *    - `get` one Application with its Job Offer, Profile, Interviews and the Match
 *      Score of the Profile's current Master CV against the Job Offer;
 *    - `change` its Application Status (only ever by the Candidate) or the Profile it uses,
 *      or report its Job Offer no longer published (Reported Unavailable), and undo it.
 *      A status change applied from a Coach proposal (#715, ADR-0077) names the version it was proposed from
 *      (`statusOf`, which every status change moves): one that moved on since is a `conflict`, nothing changed, never
 *      merged; and it keeps its Origin, hidden (`statusOrigin`), until the Candidate changes the status themselves;
 *      a Profile change applied from one (#716) likewise names the Profile it was proposed from (`profileOf`) and keeps
 *      its Origin (`profileOrigin`); an Application saved from one keeps it on its status « À postuler »;
 *    - `removeIntact` an Application a Coach proposal created, for « Annuler » (#716): only while it is intact (the
 *      status and Profile it was created with, nothing added to it: no Interview, document, Follow-up…), else a `conflict`;
 *      An Application on an Expired Job Offer is flagged (its Job Offer's `expiredAt`),
 *      and so is one Reported Unavailable (`reportedUnavailableAt`, that Application
 *      only, never the shared Job Offer); either keeps its status: nothing changes
 *      it automatically;
 *    - `addInterview` (only while it is at "Entretien", or moving it there in the same
 *      change), `editInterview`, `cancelInterview` and `removeInterview`. Interviews are
 *      kept when the Application moves on. A date change more than an hour after the date
 *      was entered or last changed is a Reschedule, kept in the Interview's Reschedule
 *      history; a Cancelled Interview stays, with its date of cancellation; removing one
 *      (an entry made by mistake) leaves no trace.
 *      An Interview added, edited or cancelled from a Coach proposal (#718, ADR-0077) names the version it was proposed
 *      from (adding one: the Application Status's, `statusOf`; changing one: the Interview's, `interviewOf`): moved on
 *      since, a `conflict`, nothing changed; the Interview keeps its Origin, hidden, until the Candidate changes it
 *      themselves. « Annuler » puts it back as it was (`restoreInterview`, or `removeInterview` for one added), from the
 *      version applying it left: a Reschedule undone within the hour leaves no trace, later it stays in the history.
 * Every read and change is scoped to the Candidate; inputs are untrusted (they
 * come from the browser) and problems come back as results, never exceptions.
 * Applications are deleted with the account (ADR-0010), their Job Offers are kept.
 */
import { APPLICATION_STATUSES, INTERVIEW_FORMATS, scoreMatch, type ApplicationStatus, type ArrivalSource, type InterviewFormat, type JobOffer, type MatchScore } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import { inTransaction, type Queryable } from "../database/pool";
import { migrateExtensionEvents, recordExtensionAction, type ExtensionCall } from "../extension-events";
import type { JobOffers } from "../job-offers";
import { dismissalReplacedBy, migrateOfferBox, recordArrivals } from "../offer-box";
import type { Profiles } from "../profiles";
import { migrateRescheduleHistory, rescheduleHistories, revertAgendaItemDate, setAgendaItemDate, type Reschedule } from "../reschedules";
import { readOrigin, type Origin } from "../origin";
import { fieldErrors, type FieldError } from "../validation";

export type { FieldError as ApplicationFieldError } from "../validation";

/** One dated interview round within an Application. */
export interface Interview {
  id: string;
  scheduledAt: Date;
  /** What the Candidate noted about it, e.g. "avec la DRH". Empty when nothing. */
  note: string;
  /** How long it lasts, in minutes, or null when the Candidate did not say (shown as INTERVIEW_DEFAULT_DURATION_MINUTES). */
  durationMinutes: number | null;
  /** How it takes place, or null when the Candidate did not say. */
  format: InterviewFormat | null;
  /** Where it takes place, or the link to join it. Empty when nothing. */
  place: string;
  /** When the Candidate cancelled it, or null: a Cancelled Interview stays, struck through. */
  cancelledAt: Date | null;
  /** Its Reschedule history, oldest first: every date change made more than an hour after the date was set. */
  reschedules: Reschedule[];
  /** Set while it is as a Coach proposal the Candidate applied left it (#718): its Origin, shown only on demand. */
  origin?: Origin;
}

/**
 * An Interview as a change applied from a Coach proposal sees it (#718): its version, which every change to it moves, and
 * when its date was entered or last changed (the hour a Reschedule undone leaves no trace within).
 */
export interface InterviewState {
  interview: Interview;
  version: string;
  dateSetAt: Date | null;
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
  /** Set while the Candidate reports its Job Offer no longer published (Reported Unavailable): since when. */
  reportedUnavailableAt?: Date;
  /** Set while its status is one a Coach proposal the Candidate applied gave it (#715): its Origin, shown only on demand. */
  statusOrigin?: Origin;
  /** Set while its Profile is one a Coach proposal the Candidate applied gave it (#716). */
  profileOrigin?: Origin;
}

/** The Profile an Application uses, as a Profile change applied from a Coach proposal sees it (#716): its id is its version. */
export interface ApplicationProfileState {
  profileId: string;
  origin: Origin | null;
}

/** The Application Status as a change applied from a Coach proposal sees it (#715): its version and its Origin. */
export interface ApplicationStatusState {
  status: ApplicationStatus;
  /** Moves with every status change, and nothing else. */
  version: string;
  origin: Origin | null;
}

/**
 * A change applied from a Coach proposal (#715): `version`, the Application Status's when it was proposed (or applied,
 * for « Annuler »), or for a Profile change the Profile's id (#716): moved on since, the change is a `conflict`; `origin`,
 * what the status or Profile then keeps (none: the Candidate's own).
 */
export interface ApplicationChangeOptions {
  version?: string;
  origin?: Origin | null;
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
  /** When the Candidate saved the Job Offer. */
  createdAt: Date;
  /** `expiredAt` flags an Application on an Expired Job Offer; its status is left to the Candidate. */
  jobOffer: Pick<JobOffer, "id" | "title" | "employer" | "location" | "expiredAt">;
  /** `archived`: the Profile is archived, which makes the Application an Archived Application. */
  profile: { id: string; name: string; archived: boolean };
  /** Oldest first. */
  interviews: Interview[];
  /** Set while the Candidate reports its Job Offer no longer published (Reported Unavailable). */
  reportedUnavailableAt?: Date;
}

/** The outcome of changing an Application. "not_found" also covers someone else's Application (or Profile). */
export type ApplicationChangeResult =
  | { ok: true; application: Application }
  | { ok: false; errors: FieldError[] }
  | { ok: false; error: "not_found" }
  /** Its Application Status moved on from the version the change named (#715). */
  | { ok: false; error: "conflict" };

/** « Annuler » an Interview added from a Coach proposal (#770): `statusKept` when its Application Status had changed since and was left. */
export type RemoveAddedInterviewResult = { ok: true; statusKept: boolean } | { ok: false; error: "not_found" | "conflict" };

/** Interviews are added only to an Application at "Entretien" (`interview`). `interviewId`: the Interview added. */
export type AddInterviewResult =
  | { ok: true; application: Application; interviewId: string }
  | Exclude<ApplicationChangeResult, { ok: true }>
  | { ok: false; error: "not_in_interview" };

/** Removing an Application a Coach proposal created (#716): `conflict` once it is no longer intact. */
export type RemoveApplicationResult = { ok: true } | { ok: false; error: "not_found" | "conflict" };

export interface Applications {
  /**
   * Saves a Job Offer as an Application ("À postuler"). `input`: { jobOfferId, profileId }. `origin`: saved from a Coach
   * proposal (#716), its status keeps it; an Application they had already is given back as it is. `extension`:
   * saved from the extension's Side Panel, a Capture followed, which arrives in the Offer box « Extension » (#819) and,
   * when created, writes its Extension Event `application_created` in the same transaction (#924).
   */
  save(candidateId: string, input: unknown, options?: { origin?: Origin; extension?: ExtensionCall }): Promise<SaveApplicationResult>;
  /** The Application, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<Application | null>;
  /** Every Application of the Candidate, newest first. */
  list(candidateId: string): Promise<ApplicationSummary[]>;
  /** The Match Score of each of the Candidate's Applications, by its id, as `get` gives it: for Mes candidatures (#604). */
  matchScores(candidateId: string): Promise<Map<string, MatchScore>>;
  /**
   * Changes the Application Status or the Profile used, or reports its Job Offer
   * no longer published (true) and undoes it (false).
   * `input`: { status }, { profileId } or { reportedUnavailable }.
   */
  change(candidateId: string, applicationId: string, input: unknown, options?: ApplicationChangeOptions): Promise<ApplicationChangeResult>;
  /** The Application Status, its version and Origin (#715); null when the Application is not the Candidate's. */
  statusOf(candidateId: string, applicationId: string): Promise<ApplicationStatusState | null>;
  /** The Profile the Application uses and its Origin (#716); null when the Application is not the Candidate's. */
  profileOf(candidateId: string, applicationId: string): Promise<ApplicationProfileState | null>;
  /**
   * Removes an Application a Coach proposal created (« Annuler », #716), while it is intact: still at the status version
   * `version` and on the Profile `profileId`, with nothing that refers to it (an Interview, a Tailored Document, a Follow-up
   * sent, a Company Dossier…). Otherwise a `conflict`, nothing removed. Its Job Offer is kept.
   */
  removeIntact(candidateId: string, applicationId: string, seen: { version: string; profileId: string }): Promise<RemoveApplicationResult>;
  /**
   * Adds a dated Interview. `input`: { scheduledAt (ISO 8601 date and time), note?, durationMinutes?,
   * format?, place?, moveToInterview? }. Refused ("not_in_interview") unless the Application is at
   * "Entretien", or `moveToInterview` is true: the Application is then moved to "Entretien" and the
   * Interview added together, or neither is saved.
   * From a Coach proposal (#718): `options.version`, the Application Status's it was proposed from (a `conflict` once moved
   * on); `options.origin`, kept on the Interview and on the status it moves.
   */
  addInterview(candidateId: string, applicationId: string, input: unknown, options?: ApplicationChangeOptions): Promise<AddInterviewResult>;
  /** The Interview, its version and when its date was set (#718); null when it is not one of the Candidate's Application's. */
  interviewOf(candidateId: string, applicationId: string, interviewId: string): Promise<InterviewState | null>;
  /**
   * Edits one of the Application's Interviews, changing only the fields `input` names:
   * { scheduledAt?, note?, durationMinutes?, format?, place? }, read as `addInterview` reads them
   * (null, or "", clears the duration or the format). Allowed whatever
   * the Application Status, like removing one: Interviews are kept when it moves on.
   * From a Coach proposal (#718): `options.version`, the Interview's (`interviewOf`), a `conflict` once moved on;
   * `options.origin`, what it then keeps. The Candidate's own change keeps none.
   */
  editInterview(candidateId: string, applicationId: string, interviewId: string, input: unknown, options?: ApplicationChangeOptions): Promise<ApplicationChangeResult>;
  /**
   * Cancels one of the Application's Interviews: it stays, with the date it was cancelled (kept when
   * cancelled again). Allowed whatever the Application Status. `options` as for `editInterview`.
   */
  cancelInterview(candidateId: string, applicationId: string, interviewId: string, options?: ApplicationChangeOptions): Promise<ApplicationChangeResult>;
  /**
   * Removes one of the Application's Interviews, entered by mistake: it leaves no trace, its Reschedule history neither.
   * `options.version`: only as it was then (« Annuler » an Interview added from a Coach proposal, #718).
   */
  removeInterview(candidateId: string, applicationId: string, interviewId: string, options?: Pick<ApplicationChangeOptions, "version">): Promise<ApplicationChangeResult>;
  /**
   * « Annuler » an Interview added from a Coach proposal (#718, #770), in one transaction, the Application and the Interview
   * locked: the Interview, as applying left it (`version`; changed since: a `conflict`, nothing changed), is removed and,
   * when applying moved the Application to « Entretien » (`status`), its Application Status put back as it was (`before`,
   * with its Origin) if it is still at the version applying left. Changed since (on its page, another card), the status is
   * left as it is: `statusKept`.
   */
  removeAddedInterview(
    candidateId: string,
    applicationId: string,
    interviewId: string,
    seen: { version: string; status: { before: ApplicationStatus; origin: Origin | null; version: string } | null },
  ): Promise<RemoveAddedInterviewResult>;
  /**
   * « Annuler » a change applied from a Coach proposal (#718): puts the Interview back as `before` was (its date, fields,
   * cancellation and Origin), from `options.version`, the one applying it left (a `conflict` once moved on). Its date put
   * back within the hour after the change leaves no trace; later, the change back is a Reschedule too.
   */
  restoreInterview(candidateId: string, applicationId: string, interviewId: string, before: InterviewState, options: { version: string }): Promise<ApplicationChangeResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().trim().min(1);
const saveSchema = z.object({ jobOfferId: id, profileId: id });
const statusChange = z.object({ status: z.enum(APPLICATION_STATUSES) });
const profileChange = z.object({ profileId: id });
const reportChange = z.object({ reportedUnavailable: z.boolean() });
/** Told apart by `profileId` or `reportedUnavailable`, so field errors name the field the caller meant. */
const parseChange = (input: unknown) => {
  const has = (key: string) => typeof input === "object" && input !== null && key in input;
  if (has("profileId")) return profileChange.safeParse(input, { reportInput: true });
  if (has("reportedUnavailable")) return reportChange.safeParse(input, { reportInput: true });
  return statusChange.safeParse(input, { reportInput: true });
};

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

/** An Interview's date and time as typed in French time ("2026-11-12T14:30"), the value an Interview form starts from. */
export function interviewWallClock(scheduledAt: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: INTERVIEW_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(scheduledAt)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The instant the day `instant` falls on, in French time, begins: its midnight there (never skipped: France changes the clocks at 2 or 3 a.m.). */
export function interviewDayStart(instant: Date): Date {
  return frenchDayStart(interviewWallClock(instant).slice(0, 10));
}

/** The instant a day in French time ("2026-10-22") begins: its midnight there. */
export function frenchDayStart(day: string): Date {
  return wallClockIn(`${day}T00:00`, INTERVIEW_TIME_ZONE);
}

/**
 * A date and time read from a form: ISO 8601, French time when typed without an offset
 * ("2026-11-12T14:30", a datetime-local value). For Interviews and Coaching Sessions alike.
 */
export const frenchDateTime = z.iso
  .datetime({ offset: true, local: true })
  .transform((value) => (/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? new Date(value) : wallClockIn(value, INTERVIEW_TIME_ZONE)));

/** How long an Interview is shown to last when the Candidate did not say. */
export const INTERVIEW_DEFAULT_DURATION_MINUTES = 60;

/** When an Interview ends: its duration after it starts, INTERVIEW_DEFAULT_DURATION_MINUTES when it has none. */
export function interviewEndsAt({ scheduledAt, durationMinutes }: Pick<Interview, "scheduledAt" | "durationMinutes">): Date {
  return new Date(scheduledAt.getTime() + (durationMinutes ?? INTERVIEW_DEFAULT_DURATION_MINUTES) * 60_000);
}

/** A run of an Interview's place, a link (`href`) when it is an http or https web address. */
export interface InterviewPlacePart {
  text: string;
  href?: string;
}

const WEB_ADDRESS = /https?:\/\/[^\s<>"]+/gi;
/** What ends a sentence rather than a web address. */
const TRAILING_PUNCTUATION = /[.,;:!?'"»]$/;

/**
 * An Interview's place cut into runs of text and links, for showing it: each http or
 * https web address in it becomes a link (never another scheme), without the punctuation
 * that follows it in a sentence or a closing bracket it does not open.
 */
export function interviewPlaceParts(place: string): InterviewPlacePart[] {
  const parts: InterviewPlacePart[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last && last.href === undefined) last.text += value;
    else parts.push({ text: value });
  };
  let from = 0;
  for (const match of place.matchAll(WEB_ADDRESS)) {
    let address = match[0];
    while (TRAILING_PUNCTUATION.test(address) || (address.endsWith(")") && address.split("(").length < address.split(")").length)) address = address.slice(0, -1);
    text(place.slice(from, match.index));
    if (URL.canParse(address)) parts.push({ text: address, href: address });
    else text(address);
    from = match.index + address.length;
  }
  text(place.slice(from));
  return parts;
}

/** A form's empty field ("") means nothing was said. */
const blankAsNull = (value: unknown) => (value === "" ? null : value);

const interviewFields = {
  scheduledAt: frenchDateTime,
  note: z.string().trim().max(500),
  /** Up to a day. */
  durationMinutes: z.preprocess(blankAsNull, z.number().int().positive().max(1440).nullable()),
  format: z.preprocess(blankAsNull, z.enum(INTERVIEW_FORMATS).nullable()),
  place: z.string().trim().max(500),
};

const interviewSchema = z.object({
  scheduledAt: interviewFields.scheduledAt,
  note: interviewFields.note.default(""),
  durationMinutes: interviewFields.durationMinutes.default(null),
  format: interviewFields.format.default(null),
  place: interviewFields.place.default(""),
  moveToInterview: z.boolean().default(false),
});

/** An edit changes only the fields it names. */
const interviewEditSchema = z.object({
  scheduledAt: interviewFields.scheduledAt.optional(),
  note: interviewFields.note.optional(),
  durationMinutes: interviewFields.durationMinutes.optional(),
  format: interviewFields.format.optional(),
  place: interviewFields.place.optional(),
});

/** The `interview` column each editable field but the date is kept in: the date changes through `setAgendaItemDate`, for its Reschedules. */
const INTERVIEW_COLUMNS = { note: "note", durationMinutes: "duration_minutes", format: "format", place: "place" } as const;

const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;

/** An `interview` row as read. */
interface InterviewRow {
  id: string;
  application_id: string;
  scheduled_at: Date;
  note: string;
  duration_minutes: number | null;
  format: InterviewFormat | null;
  place: string;
  cancelled_at: Date | null;
  date_set_at: Date | null;
  origin: unknown;
}
const INTERVIEW_COLUMNS_READ = "id, application_id, scheduled_at, note, duration_minutes, format, place, cancelled_at, date_set_at, origin";

/** An Interview's version (#718): what it says, its date, fields and cancellation, so any change to it moves it. */
const interviewVersion = (row: InterviewRow) =>
  JSON.stringify([row.scheduled_at.toISOString(), row.note, row.duration_minutes, row.format, row.place, row.cancelled_at?.toISOString() ?? null]);

/** The Origin a change stores: a Coach proposal's, or none (the Candidate's own). */
const originJson = (options: ApplicationChangeOptions) => (options.origin ? JSON.stringify(options.origin) : null);
const found = (application: Application | null): ApplicationChangeResult => (application ? { ok: true, application } : NOT_FOUND);

interface ApplicationRow {
  id: string;
  job_offer_id: string;
  profile_id: string;
  status: ApplicationStatus;
  status_changed_at: Date;
  created_at: Date;
  reported_unavailable_at: Date | null;
  status_origin?: unknown;
  profile_origin?: unknown;
}

const COLUMNS = "id, job_offer_id, profile_id, status, status_changed_at, created_at, reported_unavailable_at, status_origin, profile_origin";
/** The Application Status's version (#715): when it last changed, to the microsecond, as text. */
const STATUS_VERSION = "(extract(epoch FROM status_changed_at) * 1000000)::bigint::text";

/**
 * Whether any row of another table refers to the Application (an Interview, a Tailored Document, a Follow-up sent, a
 * Company Dossier, a Coach Conversation…): every foreign key to it, as Postgres declares them, so a table added later counts too.
 */
async function referred(client: Pick<Pool, "query">, applicationId: string): Promise<boolean> {
  const { rows: keys } = await client.query<{ table_name: string; column_name: string }>(
    `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'application'::regclass AND array_length(c.conkey, 1) = 1`,
  );
  for (const key of keys) {
    const { rows } = await client.query(`SELECT 1 FROM ${key.table_name} WHERE ${quoted(key.column_name)} = $1 LIMIT 1`, [applicationId]);
    if (rows.length > 0) return true;
  }
  return false;
}

/** An identifier Postgres gave us, quoted. */
const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function createApplications(
  database: Pool,
  {
    jobOffers,
    profiles,
    now = () => new Date(),
    sentByShareCapture = async () => false,
  }: {
    jobOffers: Pick<JobOffers, "get" | "keepForCandidate">;
    profiles: Pick<Profiles, "get">;
    /** The clock Interview dates are entered, Rescheduled and cancelled by. */
    now?: () => Date;
    /**
     * Whether the Candidate sent the Job Offer by Share capture (../coach-conversations): saving it is then an Arrival
     * « Partage » in the Offer box (#819). Default: never.
     */
    sentByShareCapture?: (candidateId: string, jobOfferId: string) => Promise<boolean>;
  },
): Applications {
  /** The Interviews of each Application, oldest first. */
  async function interviewsOf(applicationIds: string[]): Promise<Map<string, Interview[]>> {
    const { rows } = await database.query<InterviewRow>(
      `SELECT ${INTERVIEW_COLUMNS_READ} FROM interview WHERE application_id = ANY($1) ORDER BY scheduled_at, created_at`,
      [applicationIds],
    );
    const histories = await rescheduleHistories(
      database,
      "interview",
      rows.map((row) => row.id),
    );
    const byApplication = new Map(applicationIds.map((applicationId) => [applicationId, [] as Interview[]]));
    for (const row of rows) byApplication.get(row.application_id)!.push(interviewFrom(row, histories.get(row.id)!));
    return byApplication;
  }

  function interviewFrom(row: InterviewRow, reschedules: Reschedule[]): Interview {
    const interview: Interview = {
      id: row.id,
      scheduledAt: row.scheduled_at,
      note: row.note,
      durationMinutes: row.duration_minutes,
      format: row.format,
      place: row.place,
      cancelledAt: row.cancelled_at,
      reschedules,
    };
    const origin = readOrigin(row.origin);
    if (origin) interview.origin = origin;
    return interview;
  }

  /** The Candidate's Interview's row, locked for the caller's transaction; null when it is not theirs. */
  async function lockedInterview(client: Queryable, candidateId: string, applicationId: string, interviewId: string): Promise<InterviewRow | null> {
    if (!UUID.test(applicationId) || !UUID.test(interviewId)) return null;
    const { rows } = await client.query<InterviewRow>(
      `SELECT ${INTERVIEW_COLUMNS_READ.split(", ").map((column) => `i.${column}`).join(", ")}
         FROM interview i JOIN application a ON a.id = i.application_id
        WHERE i.id = $1 AND a.id = $2 AND a.candidate_id = $3 FOR UPDATE OF i`,
      [interviewId, applicationId, candidateId],
    );
    return rows[0] ?? null;
  }

  /**
   * Runs `change` on the Candidate's Interview in one transaction, from `version` when one is named: not theirs, `not_found`;
   * moved on from it, a `conflict`, nothing changed.
   */
  async function changeInterview(
    candidateId: string,
    applicationId: string,
    interviewId: string,
    version: string | undefined,
    change: (client: Queryable, row: InterviewRow) => Promise<void>,
  ): Promise<ApplicationChangeResult> {
    const outcome = await inTransaction(database, async (client) => {
      const row = await lockedInterview(client, candidateId, applicationId, interviewId);
      if (!row) return NOT_FOUND;
      if (version !== undefined && interviewVersion(row) !== version) return CONFLICT;
      await change(client, row);
      return null;
    });
    return outcome ?? found(await get(candidateId, applicationId));
  }

  async function applicationFrom(candidateId: string, row: ApplicationRow): Promise<Application> {
    const [jobOffer, profile, interviews] = await Promise.all([
      jobOffers.get(row.job_offer_id, candidateId),
      profiles.get(candidateId, row.profile_id),
      interviewsOf([row.id]),
    ]);
    // Both are kept as long as the Application: Job Offers are never deleted, Profiles only with the account.
    if (!jobOffer || !profile) throw new Error(`Application ${row.id} lost its Job Offer or Profile`);
    const application: Application = {
      id: row.id,
      status: row.status,
      statusChangedAt: row.status_changed_at,
      createdAt: row.created_at,
      jobOffer,
      profile: { id: profile.id, name: profile.name },
      interviews: interviews.get(row.id)!,
      matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
    };
    if (row.reported_unavailable_at !== null) application.reportedUnavailableAt = row.reported_unavailable_at;
    const origin = readOrigin(row.status_origin);
    if (origin) application.statusOrigin = origin;
    const profileOrigin = readOrigin(row.profile_origin);
    if (profileOrigin) application.profileOrigin = profileOrigin;
    return application;
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
    async save(candidateId, input, options = {}) {
      const parsed = saveSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { jobOfferId, profileId } = parsed.data;
      const profile = await profiles.get(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      // An Application holds on to its Job Offer: one a Guest captured must lose
      // its Guest expiry (ADR-0003), or the Guest clean-up would try to delete it.
      const jobOffer = await jobOffers.keepForCandidate(jobOfferId, candidateId);
      if (!jobOffer) return { ok: false, error: "not_found" };

      // A Capture followed from the Side Panel, or a Share capture followed anywhere, enters the Offer box only now (ADR-0090).
      const arrivals: ArrivalSource[] = [];
      if (options.extension) arrivals.push("extension");
      if (await sentByShareCapture(candidateId, jobOffer.id)) arrivals.push("share");

      const { created, row } = await inTransaction(database, async (client) => {
        // One statement: the Application and the dismissal it replaces in the Offer box (ADR-0090) go together.
        const inserted = await client.query<ApplicationRow>(
          `WITH followed AS (
             INSERT INTO application (candidate_id, job_offer_id, profile_id, status_origin) VALUES ($1, $2, $3, $4)
             ON CONFLICT (candidate_id, job_offer_id) DO NOTHING
             RETURNING ${COLUMNS}
           ),
           replaced AS (${dismissalReplacedBy("$1", "SELECT job_offer_id FROM followed")})
           SELECT * FROM followed`,
          [candidateId, jobOffer.id, profile.id, options.origin ? JSON.stringify(options.origin) : null],
        );
        const saved = inserted.rows[0]
          ? { created: true, row: inserted.rows[0] }
          : { created: false, row: (await client.query<ApplicationRow>(`SELECT ${COLUMNS} FROM application WHERE candidate_id = $1 AND job_offer_id = $2`, [candidateId, jobOffer.id])).rows[0]! };
        // Its entry made already « Suivie », with the Application's Profile, or its source added to the one there. An
        // Application they had already arrives now: dated by its own creation, it would move the entry's day and Profile back.
        const at = saved.created ? saved.row.created_at : now();
        for (const source of arrivals) {
          await recordArrivals(client, { candidateId, profileId: saved.row.profile_id, source, at, jobOfferIds: [jobOffer.id] });
        }
        if (saved.created && options.extension) await recordExtensionAction(client, options.extension, "application_created", { type: "application", id: saved.row.id });
        return saved;
      });
      return { ok: true, created, application: await applicationFrom(candidateId, row) };
    },

    get,

    async list(candidateId) {
      const { rows } = await database.query<
        ApplicationRow & { title: string; employer: string | null; location: string | null; expired_at: Date | null; profile_name: string; profile_archived: boolean }
      >(
        `SELECT a.id, a.job_offer_id, a.profile_id, a.status, a.status_changed_at, a.created_at, a.reported_unavailable_at,
                o.title, o.employer, o.location, o.expired_at, p.name AS profile_name, p.archived_at IS NOT NULL AS profile_archived
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
        if (row.expired_at !== null) jobOffer.expiredAt = row.expired_at;
        const summary: ApplicationSummary = {
          id: row.id,
          status: row.status,
          statusChangedAt: row.status_changed_at,
          createdAt: row.created_at,
          jobOffer,
          profile: { id: row.profile_id, name: row.profile_name, archived: row.profile_archived },
          interviews: interviews.get(row.id)!,
        };
        if (row.reported_unavailable_at !== null) summary.reportedUnavailableAt = row.reported_unavailable_at;
        return summary;
      });
    },

    async matchScores(candidateId) {
      const { rows } = await database.query<{ id: string; job_offer_id: string; profile_id: string }>(
        `SELECT id, job_offer_id, profile_id FROM application WHERE candidate_id = $1`,
        [candidateId],
      );
      // Each Profile and Job Offer read once, however many Applications share it.
      const once = <T>(read: (id: string) => Promise<T>) => {
        const reads = new Map<string, Promise<T>>();
        return (id: string) => reads.get(id) ?? reads.set(id, read(id)).get(id)!;
      };
      const profileOf = once((profileId) => profiles.get(candidateId, profileId));
      const jobOfferOf = once((jobOfferId) => jobOffers.get(jobOfferId, candidateId));
      const scores = new Map<string, MatchScore>();
      await Promise.all(
        rows.map(async (row) => {
          const [profile, jobOffer] = await Promise.all([profileOf(row.profile_id), jobOfferOf(row.job_offer_id)]);
          if (profile && jobOffer) scores.set(row.id, scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }));
        }),
      );
      return scores;
    },

    async statusOf(candidateId, applicationId) {
      if (!UUID.test(applicationId)) return null;
      const { rows } = await database.query<{ status: ApplicationStatus; version: string; status_origin: unknown }>(
        `SELECT status, ${STATUS_VERSION} AS version, status_origin FROM application WHERE id = $1 AND candidate_id = $2`,
        [applicationId, candidateId],
      );
      const row = rows[0];
      return row ? { status: row.status, version: row.version, origin: readOrigin(row.status_origin) } : null;
    },

    async profileOf(candidateId, applicationId) {
      if (!UUID.test(applicationId)) return null;
      const { rows } = await database.query<{ profile_id: string; profile_origin: unknown }>(
        `SELECT profile_id, profile_origin FROM application WHERE id = $1 AND candidate_id = $2`,
        [applicationId, candidateId],
      );
      const row = rows[0];
      return row ? { profileId: row.profile_id, origin: readOrigin(row.profile_origin) } : null;
    },

    async removeIntact(candidateId, applicationId, seen) {
      if (!UUID.test(applicationId)) return NOT_FOUND;
      return inTransaction(database, async (client): Promise<RemoveApplicationResult> => {
        const { rows } = await client.query<{ intact: boolean }>(
          `SELECT ${STATUS_VERSION} = $3 AND profile_id::text = $4 AS intact FROM application WHERE id = $1 AND candidate_id = $2 FOR UPDATE`,
          [applicationId, candidateId, seen.version, seen.profileId],
        );
        if (!rows[0]) return NOT_FOUND;
        if (!rows[0].intact || (await referred(client, applicationId))) return { ok: false, error: "conflict" };
        await client.query(`DELETE FROM application WHERE id = $1 AND candidate_id = $2`, [applicationId, candidateId]);
        return { ok: true };
      });
    },

    async change(candidateId, applicationId, input, options = {}) {
      const parsed = parseChange(input);
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(applicationId)) return NOT_FOUND;
      const change = parsed.data;
      if ("profileId" in change) {
        const profile = await profiles.get(candidateId, change.profileId);
        if (!profile) return NOT_FOUND;
        if (options.version !== undefined) {
          // From a Coach proposal (#716): only from the Profile it was proposed from.
          const { rows } = await database.query<{ unchanged: boolean }>(
            `WITH seen AS (SELECT id, profile_id::text = $4 AS unchanged FROM application WHERE id = $1 AND candidate_id = $2 FOR UPDATE),
                  changed AS (UPDATE application a SET profile_id = $3, profile_origin = $5 FROM seen WHERE a.id = seen.id AND seen.unchanged RETURNING a.id)
             SELECT seen.unchanged FROM seen`,
            [applicationId, candidateId, profile.id, options.version, options.origin ? JSON.stringify(options.origin) : null],
          );
          if (!rows[0]) return NOT_FOUND;
          if (!rows[0].unchanged) return { ok: false, error: "conflict" };
        } else {
          // The Candidate's own: no Origin.
          await database.query(`UPDATE application SET profile_id = $3, profile_origin = NULL WHERE id = $1 AND candidate_id = $2`, [applicationId, candidateId, profile.id]);
        }
      } else if ("reportedUnavailable" in change) {
        // Reported again, it keeps the date it was first reported.
        await database.query(
          `UPDATE application SET reported_unavailable_at = CASE WHEN $3 THEN COALESCE(reported_unavailable_at, now()) END
            WHERE id = $1 AND candidate_id = $2`,
          [applicationId, candidateId, change.reportedUnavailable],
        );
      } else if (options.version !== undefined) {
        // From a Coach proposal (#715): only from the version it was proposed from, never merged with a change since.
        const { rows } = await database.query<{ changed: boolean }>(
          `WITH seen AS (SELECT id, status, ${STATUS_VERSION} = $4 AS unchanged FROM application WHERE id = $1 AND candidate_id = $2 FOR UPDATE),
                changed AS (
                  UPDATE application a SET status = $3, status_changed_at = now(), status_origin = $5
                    FROM seen WHERE a.id = seen.id AND seen.unchanged AND seen.status <> $3 RETURNING a.id)
           SELECT seen.unchanged AS changed FROM seen`,
          [applicationId, candidateId, change.status, options.version, options.origin ? JSON.stringify(options.origin) : null],
        );
        if (!rows[0]) return NOT_FOUND;
        if (!rows[0].changed) return { ok: false, error: "conflict" };
      } else {
        // Choosing the status it already has changes nothing, so its date is kept. The Candidate's own: no Origin.
        await database.query(
          `UPDATE application SET status = $3, status_changed_at = now(), status_origin = NULL WHERE id = $1 AND candidate_id = $2 AND status <> $3`,
          [applicationId, candidateId, change.status],
        );
      }
      return found(await get(candidateId, applicationId));
    },

    async addInterview(candidateId, applicationId, input, options = {}) {
      const parsed = interviewSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(applicationId)) return NOT_FOUND;
      const { scheduledAt, note, durationMinutes, format, place, moveToInterview } = parsed.data;
      // Moved to "Entretien" and the Interview added together, or neither.
      const added = await inTransaction(database, async (client): Promise<Exclude<AddInterviewResult, { ok: true }> | { interviewId: string }> => {
        const { rows } = await client.query<{ status: ApplicationStatus; version: string }>(
          `SELECT status, ${STATUS_VERSION} AS version FROM application WHERE id = $1 AND candidate_id = $2 FOR UPDATE`,
          [applicationId, candidateId],
        );
        if (!rows[0]) return NOT_FOUND;
        // From a Coach proposal (#718): only from the status it was proposed from.
        if (options.version !== undefined && rows[0].version !== options.version) return CONFLICT;
        if (rows[0].status !== "interview" && !moveToInterview) return { ok: false, error: "not_in_interview" };
        await client.query(
          `UPDATE application SET status = 'interview', status_changed_at = now(), status_origin = $3 WHERE id = $1 AND candidate_id = $2 AND status <> 'interview'`,
          [applicationId, candidateId, originJson(options)],
        );
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO interview (application_id, scheduled_at, date_set_at, note, duration_minutes, format, place, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [applicationId, scheduledAt, now(), note, durationMinutes, format, place, originJson(options)],
        );
        return { interviewId: inserted.rows[0]!.id };
      });
      if (!("interviewId" in added)) return added;
      const application = await get(candidateId, applicationId);
      return application ? { ok: true, application, interviewId: added.interviewId } : NOT_FOUND;
    },

    async interviewOf(candidateId, applicationId, interviewId) {
      if (!UUID.test(applicationId) || !UUID.test(interviewId)) return null;
      const { rows } = await database.query<InterviewRow>(
        `SELECT ${INTERVIEW_COLUMNS_READ.split(", ").map((column) => `i.${column}`).join(", ")}
           FROM interview i JOIN application a ON a.id = i.application_id
          WHERE i.id = $1 AND a.id = $2 AND a.candidate_id = $3`,
        [interviewId, applicationId, candidateId],
      );
      const row = rows[0];
      if (!row) return null;
      const histories = await rescheduleHistories(database, "interview", [row.id]);
      return { interview: interviewFrom(row, histories.get(row.id)!), version: interviewVersion(row), dateSetAt: row.date_set_at };
    },

    async editInterview(candidateId, applicationId, interviewId, input, options = {}) {
      const parsed = interviewEditSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { scheduledAt } = parsed.data;
      const changes = (Object.keys(INTERVIEW_COLUMNS) as (keyof typeof INTERVIEW_COLUMNS)[]).filter((field) => parsed.data[field] !== undefined);
      // The Origin goes with every change: a Coach proposal's, or none for the Candidate's own.
      const set = [...changes.map((field, index) => `${INTERVIEW_COLUMNS[field]} = $${index + 3}`), `origin = $2`].join(", ");
      return changeInterview(candidateId, applicationId, interviewId, options.version, async (client) => {
        await client.query(`UPDATE interview SET ${set} WHERE id = $1`, [interviewId, originJson(options), ...changes.map((field) => parsed.data[field])]);
        if (scheduledAt !== undefined) await setAgendaItemDate(client, { table: "interview", id: interviewId }, { to: scheduledAt, by: "candidate", now: now() });
      });
    },

    async cancelInterview(candidateId, applicationId, interviewId, options = {}) {
      // Cancelled again, it keeps the date it was first cancelled.
      return changeInterview(candidateId, applicationId, interviewId, options.version, async (client) => {
        await client.query(`UPDATE interview SET cancelled_at = COALESCE(cancelled_at, $2), origin = $3 WHERE id = $1`, [interviewId, now(), originJson(options)]);
      });
    },

    async removeInterview(candidateId, applicationId, interviewId, options = {}) {
      return changeInterview(candidateId, applicationId, interviewId, options.version, async (client) => {
        await client.query(`DELETE FROM interview WHERE id = $1`, [interviewId]);
      });
    },

    async removeAddedInterview(candidateId, applicationId, interviewId, { version, status }) {
      if (!UUID.test(applicationId) || !UUID.test(interviewId)) return NOT_FOUND;
      return inTransaction(database, async (client): Promise<RemoveAddedInterviewResult> => {
        // The Application first, then its Interview: the order every change of both takes.
        const { rows } = await client.query<{ version: string }>(`SELECT ${STATUS_VERSION} AS version FROM application WHERE id = $1 AND candidate_id = $2 FOR UPDATE`, [
          applicationId,
          candidateId,
        ]);
        const application = rows[0];
        const row = application ? await lockedInterview(client, candidateId, applicationId, interviewId) : null;
        if (!application || !row) return NOT_FOUND;
        if (interviewVersion(row) !== version) return CONFLICT;
        await client.query(`DELETE FROM interview WHERE id = $1`, [interviewId]);
        if (!status) return { ok: true, statusKept: false };
        if (application.version !== status.version) return { ok: true, statusKept: true };
        await client.query(`UPDATE application SET status = $2, status_changed_at = now(), status_origin = $3 WHERE id = $1`, [
          applicationId,
          status.before,
          status.origin ? JSON.stringify(status.origin) : null,
        ]);
        return { ok: true, statusKept: false };
      });
    },

    async restoreInterview(candidateId, applicationId, interviewId, before, { version }) {
      const { interview } = before;
      return changeInterview(candidateId, applicationId, interviewId, version, async (client) => {
        await client.query(`UPDATE interview SET note = $2, duration_minutes = $3, format = $4, place = $5, cancelled_at = $6, origin = $7 WHERE id = $1`, [
          interviewId,
          interview.note,
          interview.durationMinutes,
          interview.format,
          interview.place,
          interview.cancelledAt,
          interview.origin ? JSON.stringify(interview.origin) : null,
        ]);
        await revertAgendaItemDate(client, { table: "interview", id: interviewId }, { to: interview.scheduledAt, dateSetAt: before.dateSetAt, by: "candidate", now: now() });
      });
    },
  };
}

/** Creates or upgrades the Application and Interview tables. Run after the Candidate, Profile and Job Offer tables. Safe to run repeatedly. */
export async function migrateApplications(database: Pool): Promise<void> {
  // One saved from the extension writes its Extension Event (#924).
  await migrateExtensionEvents(database);
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
    -- Reported Unavailable: since when the Candidate reports its Job Offer no longer published (this Application only).
    ALTER TABLE application ADD COLUMN IF NOT EXISTS reported_unavailable_at timestamptz;
    -- What the Candidate needs on the day (#247): each optional.
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS duration_minutes integer CHECK (duration_minutes BETWEEN 1 AND 1440);
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS format text CHECK (format IN (${INTERVIEW_FORMATS.map((format) => `'${format}'`).join(", ")}));
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS place text NOT NULL DEFAULT '';
    -- A Cancelled Interview stays, with the date it was cancelled (#250).
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
    -- Where the Application Status came from (#715): { origin: "coach_proposal", cardId, appliedAt } while a Coach
    -- proposal the Candidate applied gave it; null once they change it themselves.
    ALTER TABLE application ADD COLUMN IF NOT EXISTS status_origin jsonb;
    -- Where an Interview's state came from (#718): { origin: "coach_proposal", cardId, appliedAt } while it is as a Coach
    -- proposal the Candidate applied left it (added, Rescheduled, cancelled); null once they change it themselves.
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS origin jsonb;
    -- Where its Profile came from (#716), the same way: null once the Candidate changes it themselves.
    ALTER TABLE application ADD COLUMN IF NOT EXISTS profile_origin jsonb;
  `);
  await migrateRescheduleHistory(database, "interview", { enteredAt: "created_at" });
  // Saving an Application writes to the Offer box (ADR-0090).
  await migrateOfferBox(database);
}
