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
import type { AgendaItemTable } from "../reschedules";
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
  /** The table it is a row of, and its id there. */
  table: AgendaItemTable;
  id: string;
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
    const { day, at } = latestReminder(now());
    const tomorrow = dayAfter(day);
    const { rows } = await database.query<{ id: string; candidate_id: string; scheduled_at: Date; title: string; employer: string | null; place: string }>(
      `SELECT i.id, a.candidate_id, i.scheduled_at, o.title, o.employer, i.place
         FROM interview i
         JOIN application a ON a.id = i.application_id
         JOIN job_offer o ON o.id = a.job_offer_id
        WHERE i.scheduled_at >= $1 AND i.scheduled_at < $2 AND i.cancelled_at IS NULL AND i.date_set_at <= $3
        ORDER BY i.scheduled_at`,
      [frenchDayStart(tomorrow), frenchDayStart(dayAfter(tomorrow)), at],
    );
    return rows.map((row) => ({ table: "interview" as const, id: row.id, candidateId: row.candidate_id, scheduledAt: row.scheduled_at, title: row.title, employer: row.employer, place: row.place }));
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

  /**
   * Claims the Candidate's `items` not reminded yet for their date, and emails those, in one transaction:
   * a second worker waits on the claim, then finds them taken; a failed email gives them back. The items claimed.
   */
  async function remind(candidateId: string, items: ReminderItem[]): Promise<ReminderItem[]> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const claimed: ReminderItem[] = [];
      for (const item of items) {
        const { rowCount } = await client.query(
          `INSERT INTO appointment_reminder (candidate_id, ${ITEM_COLUMN[item.table]}, scheduled_at, sent_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [candidateId, item.id, item.scheduledAt, now()],
        );
        if (rowCount) claimed.push(item);
      }
      if (claimed.length > 0) await email(candidateId, claimed);
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async sendDue() {
      const byCandidate = new Map<string, ReminderItem[]>();
      for (const item of await due()) byCandidate.set(item.candidateId, [...(byCandidate.get(item.candidateId) ?? []), item]);
      let emails = 0;
      let items = 0;
      for (const [candidateId, candidateItems] of byCandidate) {
        const claimed = await remind(candidateId, candidateItems);
        if (claimed.length > 0) emails += 1;
        items += claimed.length;
      }
      return { emails, items };
    },
  };
}

/** The column of `appointment_reminder` naming an item of each Agenda Item table. */
const ITEM_COLUMN: Record<AgendaItemTable, string> = { interview: "interview_id", coaching_session: "coaching_session_id" };

/** Creates or upgrades the Appointment Reminders' tables. Run after Applications and Human Coaches. Safe to run repeatedly. */
export async function migrateAppointmentReminders(database: Pool): Promise<void> {
  await database.query(`
    -- The Appointment Reminders sent: one per Agenda Item and per date (a Rescheduled item gets one for its new date).
    CREATE TABLE IF NOT EXISTS appointment_reminder (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      interview_id uuid REFERENCES interview (id) ON DELETE CASCADE,
      coaching_session_id uuid REFERENCES coaching_session (id) ON DELETE CASCADE,
      -- The item's date the reminder was for.
      scheduled_at timestamptz NOT NULL,
      sent_at timestamptz NOT NULL,
      CHECK ((interview_id IS NULL) <> (coaching_session_id IS NULL)),
      UNIQUE (interview_id, scheduled_at),
      UNIQUE (coaching_session_id, scheduled_at)
    );
    CREATE INDEX IF NOT EXISTS appointment_reminder_candidate_id_idx ON appointment_reminder (candidate_id);
  `);
}
