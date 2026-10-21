/**
 * Appointment Reminders (CONTEXT.md): the email Jobbbox sends the Candidate at
 * 18:00 French time the day before their Agenda Items still planned, in their
 * Interface Language.
 *
 * One deep module in front of Postgres. Callers get `createAppointmentReminders(database, deps)`:
 *  - `sendDue`: the worker's side, run by its cron at REMINDER_HOUR (REMINDER_TIME_ZONE).
 *    Each Candidate gets one email listing their Agenda Items of the next day.
 */
import { createI18n } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import { frenchDateTime, frenchDayStart, INTERVIEW_TIME_ZONE, interviewWallClock } from "../applications";
import { dayAfter } from "../agenda/calendar";
import type { Mailer } from "../auth";
import { routes } from "../routes";

/** Appointment Reminders go out at 18:00 French time, the day before. */
export const REMINDER_HOUR = 18;
export const REMINDER_TIME_ZONE = INTERVIEW_TIME_ZONE;

export interface AppointmentRemindersDeps {
  mailer: Mailer;
  /** The web app's address, which the email's links lead to. */
  baseURL: string;
  now?: () => Date;
}

export interface AppointmentReminders {
  /** Emails each Candidate their Agenda Items of the day after the latest REMINDER_HOUR at or before now. */
  sendDue(): Promise<{ emails: number; items: number }>;
}

/** One Agenda Item, as a reminder lists it. */
interface ReminderItem {
  candidateId: string;
  scheduledAt: Date;
  title: string;
  employer: string | null;
  place: string;
}

const HH_MM = (local: string) => local.slice(11, 16);

/** The day (French time, "2026-10-20") of the latest reminder time at or before `now`, and that time. */
function latestReminder(now: Date): { day: string; at: Date } {
  const wallClock = interviewWallClock(now);
  let day = wallClock.slice(0, 10);
  const hour = `${String(REMINDER_HOUR).padStart(2, "0")}:00`;
  if (HH_MM(wallClock) < hour) day = interviewWallClock(new Date(frenchDayStart(day).getTime() - 1)).slice(0, 10);
  return { day, at: frenchDateTime.parse(`${day}T${hour}`) };
}

export function createAppointmentReminders(database: Pool, deps: AppointmentRemindersDeps): AppointmentReminders {
  const now = deps.now ?? (() => new Date());

  async function due(): Promise<ReminderItem[]> {
    const { day } = latestReminder(now());
    const tomorrow = dayAfter(day);
    const { rows } = await database.query<{ candidate_id: string; scheduled_at: Date; title: string; employer: string | null; place: string }>(
      `SELECT a.candidate_id, i.scheduled_at, o.title, o.employer, i.place
         FROM interview i
         JOIN application a ON a.id = i.application_id
         JOIN job_offer o ON o.id = a.job_offer_id
        WHERE i.scheduled_at >= $1 AND i.scheduled_at < $2
        ORDER BY i.scheduled_at`,
      [frenchDayStart(tomorrow), frenchDayStart(dayAfter(tomorrow))],
    );
    return rows.map((row) => ({ candidateId: row.candidate_id, scheduledAt: row.scheduled_at, title: row.title, employer: row.employer, place: row.place }));
  }

  async function email(candidateId: string, items: ReminderItem[]): Promise<void> {
    const { rows } = await database.query<{ email: string; interfaceLanguage: string | null }>(`SELECT email, "interfaceLanguage" FROM candidate WHERE id = $1`, [candidateId]);
    const candidate = rows[0];
    if (!candidate) return;
    const { t } = createI18n(candidate.interfaceLanguage);
    const lines = items.map((item) =>
      [`- ${HH_MM(interviewWallClock(item.scheduledAt))} · ${item.title}${item.employer ? ` (${item.employer})` : ""}`, item.place ? `  ${item.place}` : null]
        .filter(Boolean)
        .join("\n"),
    );
    await deps.mailer.send({
      to: candidate.email,
      subject: t("appointmentReminder.email.subject", { count: items.length }),
      text: [lines.join("\n\n"), new URL(routes.agenda(), deps.baseURL).toString()].join("\n\n"),
    });
  }

  return {
    async sendDue() {
      const byCandidate = new Map<string, ReminderItem[]>();
      for (const item of await due()) byCandidate.set(item.candidateId, [...(byCandidate.get(item.candidateId) ?? []), item]);
      for (const [candidateId, items] of byCandidate) await email(candidateId, items);
      return { emails: byCandidate.size, items: [...byCandidate.values()].flat().length };
    },
  };
}

/** Creates or upgrades the Appointment Reminders' tables. Run after Applications and Human Coaches. Safe to run repeatedly. */
export async function migrateAppointmentReminders(database: Pool): Promise<void> {
  void database;
}
