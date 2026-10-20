/**
 * The Agenda: the Candidate's Agenda Items, read from where they live. An
 * Agenda Item is not a thing of its own (CONTEXT.md): the Interviews of every
 * Application, Archived Applications included, and the dated Coaching Sessions,
 * Retired Human Coaches' included.
 *
 * One deep module in front of Postgres. Callers get `createAgenda(database)`:
 *  - `days`: the signed-in Candidate's Agenda Items for a period, grouped by day
 *    in French time (Europe/Paris, like Interviews), ready to show;
 *  - `daysBetween`: their Agenda Items from one day to another, for a week or
 *    month view (see `./calendar`), oldest first, past and upcoming alike;
 *  - `unscheduled`: their Unscheduled Coaching Sessions (paid, no date yet), for
 *    the « À planifier » box, with each Human Coach's booking link.
 *  - "upcoming": from the start of today on, oldest first, so that today's
 *    items stay together, even those earlier today;
 *  - "past": before today, newest first (days and the items within them).
 * Today is `now`'s day in French time; `agendaPeriod` says where an instant goes.
 * Every read is scoped to the Candidate.
 */
import type { Pool } from "pg";
import { frenchDayStart, interviewDayStart, type Interview } from "../applications";
import { dayAfter, frenchDay } from "./calendar";

/** One Interview, as the Agenda shows it; it leads to its Application's Interviews Section. */
export interface InterviewAgendaItem extends Pick<Interview, "scheduledAt" | "durationMinutes" | "format" | "place"> {
  kind: "interview";
  /** The Interview's id. */
  id: string;
  applicationId: string;
  /** The Job Offer's title. */
  jobTitle: string;
  /** The Job Offer's company, when it says. */
  employer?: string;
  /** What the Candidate noted about it, e.g. "avec la DRH", when they did. */
  note?: string;
  /** When the Candidate cancelled it: a Cancelled Agenda Item stays on the Agenda, struck through (#250). */
  cancelledAt?: Date;
}

/** One dated Coaching Session, as the Agenda shows it; it leads to its Human Coach on the Human Coaches page. */
export interface CoachingSessionAgendaItem {
  kind: "coachingSession";
  /** The Coaching Session's id. */
  id: string;
  scheduledAt: Date;
  coach: { id: string; name: string };
  durationMinutes?: number;
  videoLink?: string;
  note?: string;
}

export type AgendaItem = InterviewAgendaItem | CoachingSessionAgendaItem;

/** A paid Coaching Session with no date yet: the Candidate books it on the Human Coach's Cal.com page, then enters its date. */
export interface UnscheduledCoachingSession {
  id: string;
  coach: { id: string; name: string; bookingUrl: string };
  paidAt: Date;
}

/** One day of the Agenda, in French time, with its items in the period's order. */
export interface AgendaDay {
  /** The day, "2026-10-22", in French time. */
  day: string;
  items: AgendaItem[];
}

export type AgendaPeriod = "upcoming" | "past";

export interface Agenda {
  /** The Candidate's Agenda Items for `period`, split at the start of `now`'s day, grouped by day in French time. */
  days(candidateId: string, options: { period: AgendaPeriod; now: Date }): Promise<AgendaDay[]>;
  /** The Candidate's Agenda Items from the start of `first` to the end of `last` (days in French time), grouped by day, oldest first. */
  daysBetween(candidateId: string, days: { first: string; last: string }): Promise<AgendaDay[]>;
  /** The Candidate's Unscheduled Coaching Sessions, oldest paid first. Never in `days` nor `daysBetween`. */
  unscheduled(candidateId: string): Promise<UnscheduledCoachingSession[]>;
}

/** Which Agenda Items a read takes: from `from` on, and before `before`, when they say; in time order, or the reverse. */
interface Window {
  from?: Date;
  before?: Date;
  newestFirst: boolean;
}

/** The window of an Agenda period, split at the start of `now`'s day in French time. */
const periodWindow = (period: AgendaPeriod, now: Date): Window =>
  period === "upcoming" ? { from: interviewDayStart(now), newestFirst: false } : { before: interviewDayStart(now), newestFirst: true };

/** The SQL condition on `column` for `window`, its parameters numbered from $2. */
function windowCondition(column: string, window: Window): { sql: string; values: Date[] } {
  const conditions: string[] = [];
  const values: Date[] = [];
  if (window.from) conditions.push(`${column} >= $${values.push(window.from) + 1}`);
  if (window.before) conditions.push(`${column} < $${values.push(window.before) + 1}`);
  return { sql: conditions.join(" AND "), values };
}

/** Agenda Items in their window's order, grouped by day in French time. */
function byDay(items: AgendaItem[], window: Window): AgendaDay[] {
  const direction = window.newestFirst ? -1 : 1;
  // Each source comes in the window's order; sorting is stable, so that order holds for items at the same time.
  const sorted = [...items].sort((a, b) => direction * (a.scheduledAt.getTime() - b.scheduledAt.getTime()));
  const days: AgendaDay[] = [];
  for (const item of sorted) {
    const day = frenchDay(item.scheduledAt);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

/** The period an Agenda Item at `instant` is in: "upcoming" from the start of today (`now`'s day in French time) on, "past" before. */
export function agendaPeriod(instant: Date, now: Date): AgendaPeriod {
  return instant.getTime() < interviewDayStart(now).getTime() ? "past" : "upcoming";
}

export function createAgenda(database: Pool): Agenda {
  /** The Candidate's Interviews in `window`, in its order. */
  async function interviews(candidateId: string, window: Window): Promise<AgendaItem[]> {
    const condition = windowCondition("i.scheduled_at", window);
    const order = window.newestFirst ? "DESC" : "ASC";
    const { rows } = await database.query<{
      id: string;
      scheduled_at: Date;
      duration_minutes: number | null;
      format: Interview["format"];
      place: string;
      note: string;
      application_id: string;
      title: string;
      employer: string | null;
    }>(
      `SELECT i.id, i.scheduled_at, i.duration_minutes, i.format, i.place, i.note, a.id AS application_id, o.title, o.employer
         FROM interview i
         JOIN application a ON a.id = i.application_id
         JOIN job_offer o ON o.id = a.job_offer_id
        WHERE a.candidate_id = $1 AND ${condition.sql}
        ORDER BY i.scheduled_at ${order}, i.created_at ${order}`,
      [candidateId, ...condition.values],
    );
    return rows.map((row) => ({
      kind: "interview",
      id: row.id,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      format: row.format,
      place: row.place,
      applicationId: row.application_id,
      jobTitle: row.title,
      ...(row.employer ? { employer: row.employer } : {}),
      ...(row.note ? { note: row.note } : {}),
    }));
  }

  /** The Candidate's dated Coaching Sessions in `window`, in its order. */
  async function coachingSessions(candidateId: string, window: Window): Promise<AgendaItem[]> {
    const condition = windowCondition("s.scheduled_at", window);
    const order = window.newestFirst ? "DESC" : "ASC";
    const { rows } = await database.query<{ id: string; scheduled_at: Date; coach_id: string; coach_name: string; duration_minutes: number | null; video_link: string | null; note: string | null }>(
      `SELECT s.id, s.scheduled_at, h.id AS coach_id, h.name AS coach_name, s.duration_minutes, s.video_link, s.note
         FROM coaching_session s
         JOIN human_coach h ON h.id = s.coach_id
        WHERE s.candidate_id = $1 AND ${condition.sql}
        ORDER BY s.scheduled_at ${order}, s.paid_at ${order}`,
      [candidateId, ...condition.values],
    );
    return rows.map((row) => ({
      kind: "coachingSession",
      id: row.id,
      scheduledAt: row.scheduled_at,
      coach: { id: row.coach_id, name: row.coach_name },
      ...(row.duration_minutes !== null ? { durationMinutes: row.duration_minutes } : {}),
      ...(row.video_link ? { videoLink: row.video_link } : {}),
      ...(row.note ? { note: row.note } : {}),
    }));
  }

  /** The Candidate's Interviews and dated Coaching Sessions in `window`, grouped by day. */
  async function itemsByDay(candidateId: string, window: Window): Promise<AgendaDay[]> {
    const [byInterview, bySession] = await Promise.all([interviews(candidateId, window), coachingSessions(candidateId, window)]);
    return byDay([...byInterview, ...bySession], window);
  }

  return {
    async days(candidateId, { period, now }) {
      return itemsByDay(candidateId, periodWindow(period, now));
    },

    async daysBetween(candidateId, { first, last }) {
      return itemsByDay(candidateId, { from: frenchDayStart(first), before: frenchDayStart(dayAfter(last)), newestFirst: false });
    },

    async unscheduled(candidateId) {
      const { rows } = await database.query<{ id: string; paid_at: Date; coach_id: string; coach_name: string; booking_url: string }>(
        `SELECT s.id, s.paid_at, h.id AS coach_id, h.name AS coach_name, h.booking_url
           FROM coaching_session s
           JOIN human_coach h ON h.id = s.coach_id
          WHERE s.candidate_id = $1 AND s.scheduled_at IS NULL
          ORDER BY s.paid_at, s.id`,
        [candidateId],
      );
      return rows.map((row) => ({ id: row.id, coach: { id: row.coach_id, name: row.coach_name, bookingUrl: row.booking_url }, paidAt: row.paid_at }));
    },
  };
}
