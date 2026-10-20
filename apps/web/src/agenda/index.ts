/**
 * The Agenda: the Candidate's Agenda Items, read from where they live. An
 * Agenda Item is not a thing of its own (CONTEXT.md): today the Interviews of
 * every Application, Archived Applications included; Coaching Sessions come later
 * as another source.
 *
 * One deep module in front of Postgres. Callers get `createAgenda(database).days`:
 * the signed-in Candidate's Agenda Items for a period, grouped by day in French
 * time (Europe/Paris, like Interviews), ready to show.
 *  - "upcoming": from the start of today on, oldest first, so that today's
 *    items stay together, even those earlier today;
 *  - "past": before today, newest first (days and the items within them).
 * Today is `now`'s day in French time; `agendaPeriod` says where an instant goes.
 * Every read is scoped to the Candidate.
 */
import type { Pool } from "pg";
import { INTERVIEW_TIME_ZONE, interviewDayStart } from "../applications";

/** One Interview, as the Agenda shows it; it leads to its Application's Interviews Section. */
export interface InterviewAgendaItem {
  kind: "interview";
  /** The Interview's id. */
  id: string;
  scheduledAt: Date;
  applicationId: string;
  /** The Job Offer's title. */
  jobTitle: string;
  /** The Job Offer's company, when it says. */
  employer?: string;
}

export type AgendaItem = InterviewAgendaItem;

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
}

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: INTERVIEW_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The day `instant` falls on in French time, "2026-10-22". */
function agendaDay(instant: Date): string {
  return DAY.format(instant);
}

/** The period an Agenda Item at `instant` is in: "upcoming" from the start of today (`now`'s day in French time) on, "past" before. */
export function agendaPeriod(instant: Date, now: Date): AgendaPeriod {
  return instant.getTime() < interviewDayStart(now).getTime() ? "past" : "upcoming";
}

export function createAgenda(database: Pool): Agenda {
  /** The Candidate's Interviews in `period`, in its order. */
  async function interviews(candidateId: string, period: AgendaPeriod, now: Date): Promise<AgendaItem[]> {
    const upcoming = period === "upcoming";
    const { rows } = await database.query<{ id: string; scheduled_at: Date; application_id: string; title: string; employer: string | null }>(
      `SELECT i.id, i.scheduled_at, a.id AS application_id, o.title, o.employer
         FROM interview i
         JOIN application a ON a.id = i.application_id
         JOIN job_offer o ON o.id = a.job_offer_id
        WHERE a.candidate_id = $1 AND ${upcoming ? "i.scheduled_at >= $2" : "i.scheduled_at < $2"}
        ORDER BY i.scheduled_at ${upcoming ? "ASC" : "DESC"}, i.created_at ${upcoming ? "ASC" : "DESC"}`,
      [candidateId, interviewDayStart(now)],
    );
    return rows.map((row) => ({
      kind: "interview",
      id: row.id,
      scheduledAt: row.scheduled_at,
      applicationId: row.application_id,
      jobTitle: row.title,
      ...(row.employer ? { employer: row.employer } : {}),
    }));
  }

  return {
    async days(candidateId, { period, now }) {
      const days: AgendaDay[] = [];
      for (const item of await interviews(candidateId, period, now)) {
        const day = agendaDay(item.scheduledAt);
        const last = days.at(-1);
        if (last?.day === day) last.items.push(item);
        else days.push({ day, items: [item] });
      }
      return days;
    },
  };
}
