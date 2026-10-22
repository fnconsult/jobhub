/**
 * Appointment Reminders (CONTEXT.md): the email Jobbbox sends the Candidate at
 * 18:00 French time the day before their Agenda Items still planned, in their
 * Interface Language. The Human Coach gets none.
 *
 * One deep module in front of Postgres. Callers get `createAppointmentReminders(database, deps)`:
 *  - `enabled` and `setEnabled`: the Candidate's setting in Mon compte's Rappels Section, on until
 *    they switch it off. Every Plan has it; it counts against no Plan Quota.
 *  - `sendDue`: the worker's side, run by its cron at REMINDER_HOUR (REMINDER_TIME_ZONE).
 *    Each Candidate gets one email listing their Agenda Items of the next day (French time):
 *    Interviews not cancelled and dated Coaching Sessions, each with its time, place or link,
 *    and a link to the Agenda. An item whose date was entered or last changed after that
 *    REMINDER_HOUR gets none. One reminder per item and per date: running it again, or on two
 *    workers at once, sends nothing twice, and a Rescheduled item gets one for its new date.
 *
 * The reminders sent are kept, and deleted with their item and with the account.
 */
import type { InterviewFormat } from "@jobhub/shared";
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
  /** Whether the Candidate receives Appointment Reminders: on until they switch them off. */
  enabled(candidateId: string): Promise<boolean>;
  /** Switches the Candidate's Appointment Reminders on or off. */
  setEnabled(candidateId: string, enabled: boolean): Promise<void>;
  /**
   * Emails each Candidate their Agenda Items of the day after the latest REMINDER_HOUR at or before now, those
   * not reminded yet for their date. How many emails went, listing how many Agenda Items, and how many could not
   * be sent: those Candidates' items are left to the next run, the other Candidates' emails go all the same.
   */
  sendDue(): Promise<{ emails: number; items: number; failed: number }>;
}

/** One Agenda Item, as a reminder lists it. */
type ReminderItem = {
  id: string;
  candidateId: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  note: string | null;
} & (
  | { table: "interview"; title: string; employer: string | null; format: InterviewFormat | null; place: string }
  | { table: "coaching_session"; coach: string; videoLink: string | null }
);

/** The day (French time, "2026-10-20") of the latest reminder time at or before `now`, and that time. */
function latestReminder(now: Date): { day: string; at: Date } {
  const wallClock = interviewWallClock(now);
  let day = wallClock.slice(0, 10);
  const time = `${String(REMINDER_HOUR).padStart(2, "0")}:00`;
  if (wallClock.slice(11) < time) day = interviewWallClock(new Date(frenchDayStart(day).getTime() - 1)).slice(0, 10);
  return { day, at: frenchDateTime.parse(`${day}T${time}`) };
}

/** The SQL condition that the Candidate `column` names did not switch Appointment Reminders off. */
const REMINDERS_ON = (column: string) => `NOT EXISTS (SELECT 1 FROM appointment_reminder_setting r WHERE r.candidate_id = ${column} AND NOT r.enabled)`;

/** The column of `appointment_reminder` naming an item of each Agenda Item table. */
const ITEM_COLUMN: Record<AgendaItemTable, string> = { interview: "interview_id", coaching_session: "coaching_session_id" };

export function createAppointmentReminders(database: Pool, deps: AppointmentRemindersDeps): AppointmentReminders {
  const now = deps.now ?? (() => new Date());

  /** The Agenda Items to remind at `at`, of the Candidates who did not switch Appointment Reminders off: still planned, not started, dated on the day after the reminder's, their date set by then. */
  async function due(at: Date): Promise<ReminderItem[]> {
    const { day, at: reminderAt } = latestReminder(at);
    const tomorrow = dayAfter(day);
    const window = [frenchDayStart(tomorrow), frenchDayStart(dayAfter(tomorrow)), reminderAt, at];
    const [interviews, sessions] = await Promise.all([
      database.query<{ id: string; candidate_id: string; scheduled_at: Date; duration_minutes: number | null; note: string; title: string; employer: string | null; format: InterviewFormat | null; place: string }>(
        `SELECT i.id, a.candidate_id, i.scheduled_at, i.duration_minutes, i.note, o.title, o.employer, i.format, i.place
           FROM interview i
           JOIN application a ON a.id = i.application_id
           JOIN job_offer o ON o.id = a.job_offer_id
          WHERE i.scheduled_at >= $1 AND i.scheduled_at < $2 AND i.date_set_at <= $3 AND i.scheduled_at > $4
            AND i.cancelled_at IS NULL AND ${REMINDERS_ON("a.candidate_id")}`,
        window,
      ),
      // A cancelled Coaching Session has no date: it is Unscheduled again.
      database.query<{ id: string; candidate_id: string; scheduled_at: Date; duration_minutes: number | null; note: string | null; coach: string; video_link: string | null }>(
        `SELECT s.id, s.candidate_id, s.scheduled_at, s.duration_minutes, s.note, h.name AS coach, s.video_link
           FROM coaching_session s
           JOIN human_coach h ON h.id = s.coach_id
          WHERE s.scheduled_at >= $1 AND s.scheduled_at < $2 AND s.date_set_at <= $3 AND s.scheduled_at > $4
            AND ${REMINDERS_ON("s.candidate_id")}`,
        window,
      ),
    ]);
    const items: ReminderItem[] = [
      ...interviews.rows.map((row): ReminderItem => ({
        table: "interview",
        id: row.id,
        candidateId: row.candidate_id,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        note: row.note || null,
        title: row.title,
        employer: row.employer,
        format: row.format,
        place: row.place,
      })),
      ...sessions.rows.map((row): ReminderItem => ({
        table: "coaching_session",
        id: row.id,
        candidateId: row.candidate_id,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        note: row.note || null,
        coach: row.coach,
        videoLink: row.video_link,
      })),
    ];
    return items.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  /** Emails the Candidate their `items` (all on one day), in their Interface Language. */
  async function email(candidateId: string, items: ReminderItem[]): Promise<void> {
    const { rows } = await database.query<{ email: string; interfaceLanguage: string | null }>(`SELECT email, "interfaceLanguage" FROM candidate WHERE id = $1`, [candidateId]);
    const candidate = rows[0];
    if (!candidate) return;
    const i18n = createI18n(candidate.interfaceLanguage);
    const { t } = i18n;
    const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: "short", timeZone: REMINDER_TIME_ZONE });
    const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "full", timeZone: REMINDER_TIME_ZONE }).format(items[0]!.scheduledAt);
    const count = items.length;
    const lines = items.map((item) => {
      const at = time.format(item.scheduledAt);
      const details =
        item.table === "interview"
          ? [
              item.employer ? t("appointmentReminder.email.interviewAt", { time: at, title: item.title, employer: item.employer }) : t("appointmentReminder.email.interview", { time: at, title: item.title }),
              item.format ? t("appointmentReminder.email.format", { format: t(`interviewFormats.${item.format}`) }) : null,
              item.place ? t("appointmentReminder.email.place", { place: item.place }) : null,
            ]
          : [t("appointmentReminder.email.coachingSession", { time: at, coach: item.coach }), item.videoLink ? t("appointmentReminder.email.videoLink", { url: item.videoLink }) : null];
      const [heading, ...rest] = [
        ...details,
        item.durationMinutes ? t("appointmentReminder.email.duration", { count: item.durationMinutes }) : null,
        item.note ? t("appointmentReminder.email.note", { note: item.note }) : null,
      ].filter((line): line is string => Boolean(line));
      return [`- ${heading}`, ...rest.map((line) => `  ${line}`)].join("\n");
    });
    await deps.mailer.send({
      to: candidate.email,
      subject: t("appointmentReminder.email.subject", { count, date }),
      text: [
        t("appointmentReminder.email.intro", { count, date }),
        lines.join("\n\n"),
        t("appointmentReminder.email.seeAgenda", { url: new URL(routes.agendaList(), deps.baseURL).toString() }),
        t("appointmentReminder.email.signature"),
        "--",
        t("appointmentReminder.email.settings", { url: new URL(routes.accountReminders, deps.baseURL).toString() }),
      ].join("\n\n"),
    });
  }

  /**
   * Claims the Candidate's `items` not reminded yet for their date, and emails those, in one transaction:
   * a second worker waits on the claim, then finds them taken; a failed email gives them back. The items claimed.
   */
  async function remind(candidateId: string, items: ReminderItem[], sentAt: Date): Promise<ReminderItem[]> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const claimed: ReminderItem[] = [];
      for (const item of items) {
        const { rowCount } = await client.query(
          `INSERT INTO appointment_reminder (candidate_id, ${ITEM_COLUMN[item.table]}, scheduled_at, sent_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [candidateId, item.id, item.scheduledAt, sentAt],
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
    async enabled(candidateId) {
      const { rows } = await database.query<{ enabled: boolean }>(`SELECT enabled FROM appointment_reminder_setting WHERE candidate_id = $1`, [candidateId]);
      return rows[0]?.enabled ?? true;
    },

    async setEnabled(candidateId, enabled) {
      await database.query(
        `INSERT INTO appointment_reminder_setting (candidate_id, enabled, changed_at) VALUES ($1, $2, $3)
         ON CONFLICT (candidate_id) DO UPDATE SET enabled = EXCLUDED.enabled, changed_at = EXCLUDED.changed_at
         WHERE appointment_reminder_setting.enabled <> EXCLUDED.enabled`,
        [candidateId, enabled, now()],
      );
    },

    async sendDue() {
      const at = now();
      const byCandidate = new Map<string, ReminderItem[]>();
      for (const item of await due(at)) byCandidate.set(item.candidateId, [...(byCandidate.get(item.candidateId) ?? []), item]);
      let emails = 0;
      let items = 0;
      let failed = 0;
      for (const [candidateId, candidateItems] of byCandidate) {
        try {
          const claimed = await remind(candidateId, candidateItems, at);
          if (claimed.length > 0) emails += 1;
          items += claimed.length;
        } catch {
          failed += 1;
        }
      }
      return { emails, items, failed };
    },
  };
}

/** Creates or upgrades the Appointment Reminders' tables. Run after Applications and Human Coaches. Safe to run repeatedly. */
export async function migrateAppointmentReminders(database: Pool): Promise<void> {
  await database.query(`
    -- The Candidate's Appointment Reminder setting (Mon compte, Rappels); none means on, the default.
    CREATE TABLE IF NOT EXISTS appointment_reminder_setting (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      enabled boolean NOT NULL,
      -- When it was last switched on or off.
      changed_at timestamptz NOT NULL
    );
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
