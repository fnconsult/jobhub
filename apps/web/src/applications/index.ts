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
 *    - `change` its Application Status (only ever by the Candidate) or the Profile it uses,
 *      or report its Job Offer no longer published (Reported Unavailable), and undo it.
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
 * Every read and change is scoped to the Candidate; inputs are untrusted (they
 * come from the browser) and problems come back as results, never exceptions.
 * Applications are deleted with the account (ADR-0010), their Job Offers are kept.
 */
import { APPLICATION_STATUSES, INTERVIEW_FORMATS, scoreMatch, type ApplicationStatus, type InterviewFormat, type JobOffer, type MatchScore } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import { inTransaction } from "../database/pool";
import type { JobOffers } from "../job-offers";
import type { Profiles } from "../profiles";
import { migrateRescheduleHistory, rescheduleHistories, setAgendaItemDate, type Reschedule } from "../reschedules";
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
  /**
   * Changes the Application Status or the Profile used, or reports its Job Offer
   * no longer published (true) and undoes it (false).
   * `input`: { status }, { profileId } or { reportedUnavailable }.
   */
  change(candidateId: string, applicationId: string, input: unknown): Promise<ApplicationChangeResult>;
  /**
   * Adds a dated Interview. `input`: { scheduledAt (ISO 8601 date and time), note?, durationMinutes?,
   * format?, place?, moveToInterview? }. Refused ("not_in_interview") unless the Application is at
   * "Entretien", or `moveToInterview` is true: the Application is then moved to "Entretien" and the
   * Interview added together, or neither is saved.
   */
  addInterview(candidateId: string, applicationId: string, input: unknown): Promise<AddInterviewResult>;
  /**
   * Edits one of the Application's Interviews, changing only the fields `input` names:
   * { scheduledAt?, note?, durationMinutes?, format?, place? }, read as `addInterview` reads them
   * (null, or "", clears the duration or the format). Allowed whatever
   * the Application Status, like removing one: Interviews are kept when it moves on.
   */
  editInterview(candidateId: string, applicationId: string, interviewId: string, input: unknown): Promise<ApplicationChangeResult>;
  /**
   * Cancels one of the Application's Interviews: it stays, with the date it was cancelled (kept when
   * cancelled again). Allowed whatever the Application Status.
   */
  cancelInterview(candidateId: string, applicationId: string, interviewId: string): Promise<ApplicationChangeResult>;
  /** Removes one of the Application's Interviews, entered by mistake: it leaves no trace, its Reschedule history neither. */
  removeInterview(candidateId: string, applicationId: string, interviewId: string): Promise<ApplicationChangeResult>;
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
const found = (application: Application | null): ApplicationChangeResult => (application ? { ok: true, application } : NOT_FOUND);

interface ApplicationRow {
  id: string;
  job_offer_id: string;
  profile_id: string;
  status: ApplicationStatus;
  status_changed_at: Date;
  created_at: Date;
  reported_unavailable_at: Date | null;
}

const COLUMNS = "id, job_offer_id, profile_id, status, status_changed_at, created_at, reported_unavailable_at";

export function createApplications(
  database: Pool,
  {
    jobOffers,
    profiles,
    now = () => new Date(),
  }: {
    jobOffers: Pick<JobOffers, "get" | "keepForCandidate">;
    profiles: Pick<Profiles, "get">;
    /** The clock Interview dates are entered, Rescheduled and cancelled by. */
    now?: () => Date;
  },
): Applications {
  /** The Interviews of each Application, oldest first. */
  async function interviewsOf(applicationIds: string[]): Promise<Map<string, Interview[]>> {
    const { rows } = await database.query<{
      id: string;
      application_id: string;
      scheduled_at: Date;
      note: string;
      duration_minutes: number | null;
      format: InterviewFormat | null;
      place: string;
      cancelled_at: Date | null;
    }>(
      `SELECT id, application_id, scheduled_at, note, duration_minutes, format, place, cancelled_at
         FROM interview WHERE application_id = ANY($1) ORDER BY scheduled_at, created_at`,
      [applicationIds],
    );
    const histories = await rescheduleHistories(
      database,
      "interview",
      rows.map((row) => row.id),
    );
    const byApplication = new Map(applicationIds.map((applicationId) => [applicationId, [] as Interview[]]));
    for (const row of rows)
      byApplication.get(row.application_id)!.push({
        id: row.id,
        scheduledAt: row.scheduled_at,
        note: row.note,
        durationMinutes: row.duration_minutes,
        format: row.format,
        place: row.place,
        cancelledAt: row.cancelled_at,
        reschedules: histories.get(row.id)!,
      });
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
    async save(candidateId, input) {
      const parsed = saveSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { jobOfferId, profileId } = parsed.data;
      const profile = await profiles.get(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      // An Application holds on to its Job Offer: one a Guest captured must lose
      // its Guest expiry (ADR-0003), or the Guest clean-up would try to delete it.
      const jobOffer = await jobOffers.keepForCandidate(jobOfferId);
      if (!jobOffer) return { ok: false, error: "not_found" };

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

    async change(candidateId, applicationId, input) {
      const parsed = parseChange(input);
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(applicationId)) return NOT_FOUND;
      const change = parsed.data;
      if ("profileId" in change) {
        const profile = await profiles.get(candidateId, change.profileId);
        if (!profile) return NOT_FOUND;
        await database.query(`UPDATE application SET profile_id = $3 WHERE id = $1 AND candidate_id = $2`, [applicationId, candidateId, profile.id]);
      } else if ("reportedUnavailable" in change) {
        // Reported again, it keeps the date it was first reported.
        await database.query(
          `UPDATE application SET reported_unavailable_at = CASE WHEN $3 THEN COALESCE(reported_unavailable_at, now()) END
            WHERE id = $1 AND candidate_id = $2`,
          [applicationId, candidateId, change.reportedUnavailable],
        );
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
      const { scheduledAt, note, durationMinutes, format, place, moveToInterview } = parsed.data;
      if (rows[0].status !== "interview" && !moveToInterview) return { ok: false, error: "not_in_interview" };
      // Moved to "Entretien" and the Interview added together, or neither.
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE application SET status = 'interview', status_changed_at = now() WHERE id = $1 AND candidate_id = $2 AND status <> 'interview'`,
          [applicationId, candidateId],
        );
        await client.query(
          `INSERT INTO interview (application_id, scheduled_at, date_set_at, note, duration_minutes, format, place) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [applicationId, scheduledAt, now(), note, durationMinutes, format, place],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return found(await get(candidateId, applicationId));
    },

    async editInterview(candidateId, applicationId, interviewId, input) {
      const parsed = interviewEditSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(applicationId) || !UUID.test(interviewId)) return NOT_FOUND;
      const { scheduledAt } = parsed.data;
      const changes = (Object.keys(INTERVIEW_COLUMNS) as (keyof typeof INTERVIEW_COLUMNS)[]).filter((field) => parsed.data[field] !== undefined);
      // Nothing named still checks the Interview is theirs.
      const set = changes.length > 0 ? changes.map((field, index) => `${INTERVIEW_COLUMNS[field]} = $${index + 4}`).join(", ") : "id = i.id";
      const edited = await inTransaction(database, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE interview i SET ${set}
             FROM application a
            WHERE i.id = $1 AND i.application_id = a.id AND a.id = $2 AND a.candidate_id = $3`,
          [interviewId, applicationId, candidateId, ...changes.map((field) => parsed.data[field])],
        );
        if (rowCount === 0) return false;
        if (scheduledAt !== undefined) await setAgendaItemDate(client, { table: "interview", id: interviewId }, { to: scheduledAt, by: "candidate", now: now() });
        return true;
      });
      if (!edited) return NOT_FOUND;
      return found(await get(candidateId, applicationId));
    },

    async cancelInterview(candidateId, applicationId, interviewId) {
      if (!UUID.test(applicationId) || !UUID.test(interviewId)) return NOT_FOUND;
      // Cancelled again, it keeps the date it was first cancelled.
      const { rowCount } = await database.query(
        `UPDATE interview i SET cancelled_at = COALESCE(i.cancelled_at, $4)
           FROM application a
          WHERE i.id = $1 AND i.application_id = a.id AND a.id = $2 AND a.candidate_id = $3`,
        [interviewId, applicationId, candidateId, now()],
      );
      if (rowCount === 0) return NOT_FOUND;
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
    -- Reported Unavailable: since when the Candidate reports its Job Offer no longer published (this Application only).
    ALTER TABLE application ADD COLUMN IF NOT EXISTS reported_unavailable_at timestamptz;
    -- What the Candidate needs on the day (#247): each optional.
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS duration_minutes integer CHECK (duration_minutes BETWEEN 1 AND 1440);
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS format text CHECK (format IN (${INTERVIEW_FORMATS.map((format) => `'${format}'`).join(", ")}));
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS place text NOT NULL DEFAULT '';
    -- A Cancelled Interview stays, with the date it was cancelled (#250).
    ALTER TABLE interview ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
  `);
  await migrateRescheduleHistory(database, "interview", { enteredAt: "created_at" });
}
