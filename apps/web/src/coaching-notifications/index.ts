import { createHash } from "node:crypto";
import { dayAfter } from "../agenda/calendar";
import { coachingDay, zonedClock } from "@jobhub/shared/coaching-time";
import { z } from "zod";
/** Coaching notices: durable event keys and independently resumable email/push channels. */
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
export interface NoticeRecipient {
  id: string;
  email: string;
  locale: "fr" | "en";
  timeZone: string;
  audience: "candidate" | "coach";
}
export interface CoachingNotice {
  key: string;
  kind: "hour_before" | "day_before" | "daily" | "paid" | "booked" | "rescheduled" | "cancelled";
  sessionId: string | null;
  scheduledAt: Date | null;
  items?: { sessionId: string; scheduledAt: Date }[];
}
interface NoticeRow extends CoachingNotice {
  recipientId: string;
  coachId: string;
  audience: NoticeRecipient["audience"];
  version: Date | null;
  localDay: string | null;
  eventAt: Date | null;
  doneAt: Date | null;
  retryAt: Date | null;
}
export interface NoticeSettings {
  hourEmail: boolean;
  coachEmail: boolean;
  daily: boolean;
}
const settingInput = z.object({ hourEmail: z.boolean().optional(), coachEmail: z.boolean().optional(), daily: z.boolean().optional() }).strict();
interface Deps {
  now?: () => Date;
  permitted: () => Promise<boolean>;
  eligibleCoach: (person: { email: string; emailVerified: boolean }, coachId: string) => Promise<boolean>;
  email: (person: NoticeRecipient, notice: CoachingNotice) => Promise<void>;
  push: (person: NoticeRecipient, notice: CoachingNotice) => Promise<void>;
}
export function coachingNotifications(database: Pool, deps: Deps) {
  const keyOf = (value: string) => createHash("sha256").update(value).digest("hex");
  const now = deps.now ?? (() => new Date());
  async function settings(id: string, within: Queryable = database): Promise<NoticeSettings> {
    return (
      (
        await within.query<NoticeSettings>(
          'SELECT hour_email AS "hourEmail",coach_email AS "coachEmail",daily FROM coaching_notice_setting WHERE recipient_id=$1',
          [id],
        )
      ).rows[0] ?? { hourEmail: true, coachEmail: true, daily: true }
    );
  }
  async function recipient(id: string, audience: NoticeRecipient["audience"], coachId: string, within: Queryable = database): Promise<NoticeRecipient | null> {
    const result =
      audience === "candidate"
        ? await within.query<NoticeRecipient>(
            `SELECT c.id,c.email,CASE WHEN c."interfaceLanguage"='en' THEN 'en' ELSE 'fr' END AS locale,coalesce(z.time_zone,'Europe/Paris') AS "timeZone",'candidate' AS audience FROM candidate c LEFT JOIN candidate_coaching_time_zone z ON z.candidate_id=c.id WHERE c.id=$1 AND c."emailVerified"`,
            [id],
          )
        : await within.query<NoticeRecipient>(
            `SELECT c.id,c.email,CASE WHEN c."interfaceLanguage"='en' THEN 'en' ELSE 'fr' END AS locale,coalesce(z.time_zone,'Europe/Paris') AS "timeZone",'coach' AS audience FROM human_coach h JOIN candidate c ON lower(c.email)=h.email AND c."emailVerified" LEFT JOIN coach_coaching_time_zone z ON z.coach_id=h.id WHERE h.id=$2 AND c.id=$1 AND h.retired_at IS NULL`,
            [id, coachId],
          );
    const person = result.rows[0];
    return person && (audience === "candidate" || (await deps.eligibleCoach({ email: person.email, emailVerified: true }, coachId))) ? person : null;
  }
  const localTime = (at: Date, zone: string) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  async function futureSessions(within: Queryable = database) {
    return (
      await within.query<{ id: string; candidateId: string; coachId: string; scheduledAt: Date; paidAt: Date; version: Date | null }>(
        `SELECT s.id,s.candidate_id AS "candidateId",s.coach_id AS "coachId",s.scheduled_at AS "scheduledAt",s.paid_at AS "paidAt",s.date_set_at AS version FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL WHERE s.withdrawn_at IS NULL AND s.cancelled_at IS NULL AND s.scheduled_at>$1 AND s.scheduled_at<=$2 AND NOT EXISTS(SELECT 1 FROM coaching_cancellation c WHERE c.session_id=s.id AND c.choice='awaiting') ORDER BY s.scheduled_at,s.id`,
        [now(), new Date(now().getTime() + 36 * 3600000)],
      )
    ).rows;
  }
  async function discoverEvents() {
    const events = (
      await database.query<{
        id: string;
        sessionId: string;
        coachId: string;
        kind: CoachingNotice["kind"];
        at: Date;
        scheduledAt: Date | null;
        version: Date | null;
        handled: boolean;
      }>(
        `SELECT e.id,e.session_id AS "sessionId",s.coach_id AS "coachId",e.kind,e.at,e.scheduled_at AS "scheduledAt",e.version,e.handled_by_case AS handled FROM coaching_notice_event e JOIN coaching_session s ON s.id=e.session_id WHERE e.processed_at IS NULL AND e.at<=$1 ORDER BY e.at,e.id LIMIT 100`,
        [now()],
      )
    ).rows;
    for (const event of events) {
      if (!event.handled && event.at.getTime() >= now().getTime() - 86400000) {
        const account = (
          await database.query<{ id: string }>(
            'SELECT c.id FROM human_coach h JOIN candidate c ON lower(c.email)=h.email AND c."emailVerified" WHERE h.id=$1 AND h.retired_at IS NULL',
            [event.coachId],
          )
        ).rows[0];
        if (account && (await recipient(account.id, "coach", event.coachId)))
          await database.query(
            "INSERT INTO coaching_notice(key,session_id,recipient_id,coach_id,audience,kind,scheduled_at,version,event_at) VALUES($1,$2,$3,$4,'coach',$5,$6,$7,$8) ON CONFLICT DO NOTHING",
            [keyOf(`event:${event.id}:${account.id}`), event.sessionId, account.id, event.coachId, event.kind, event.scheduledAt, event.version, event.at],
          );
      }
      await database.query("UPDATE coaching_notice_event SET processed_at=$2 WHERE id=$1", [event.id, now()]);
    }
  }
  const COLUMNS = `key,kind,session_id AS "sessionId",scheduled_at AS "scheduledAt",recipient_id AS "recipientId",coach_id AS "coachId",audience,version,local_day AS "localDay",event_at AS "eventAt",done_at AS "doneAt",retry_at AS "retryAt"`;
  async function read(key: string, within: Queryable = database) {
    return (await within.query<NoticeRow>(`SELECT ${COLUMNS} FROM coaching_notice WHERE key=$1`, [key])).rows[0] ?? null;
  }
  async function context(row: NoticeRow, within: Queryable = database) {
    if (row.kind === "hour_before" && row.scheduledAt && row.scheduledAt.getTime() - now().getTime() > 3600000) return null;
    const valid =
      row.kind === "daily" ||
      ((!row.eventAt || row.eventAt.getTime() >= now().getTime() - 86400000) &&
        (
          await within.query(
            `SELECT 1 FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL WHERE s.id=$1 AND CASE WHEN $5='cancelled' THEN (s.scheduled_at IS NULL OR s.withdrawn_at IS NOT NULL OR s.cancelled_at IS NOT NULL) ELSE s.withdrawn_at IS NULL AND s.cancelled_at IS NULL AND ($5='paid' OR (s.scheduled_at=$2 AND s.date_set_at IS NOT DISTINCT FROM $3::timestamptz AND s.scheduled_at>$4)) END AND NOT EXISTS(SELECT 1 FROM coaching_cancellation c WHERE c.session_id=s.id AND c.choice='awaiting')`,
            [row.sessionId, row.scheduledAt, row.version, now(), row.kind],
          )
        ).rowCount);
    const person = valid ? await recipient(row.recipientId, row.audience, row.coachId, within) : null;
    if (!person) return null;
    if (
      row.kind === "day_before" &&
      (localTime(now(), person.timeZone) < "18:00" || coachingDay(row.scheduledAt!, person.timeZone) !== dayAfter(coachingDay(now(), person.timeZone)))
    )
      return null;
    let items: { sessionId: string; scheduledAt: Date }[] | undefined;
    if (row.kind === "daily") {
      const time = localTime(now(), person.timeZone),
        prefs = await settings(person.id, within);
      items = (await futureSessions(within))
        .filter((s) => s.coachId === row.coachId && coachingDay(s.scheduledAt, person.timeZone) === row.localDay)
        .map((s) => ({ sessionId: s.id, scheduledAt: s.scheduledAt }));
      if (!prefs.daily || row.localDay !== coachingDay(now(), person.timeZone) || time < "07:30" || time >= "12:00" || !items.length) return null;
    }
    return {
      person,
      notice: { key: row.key, kind: row.kind, sessionId: row.sessionId, scheduledAt: row.scheduledAt, ...(items ? { items } : {}) } as CoachingNotice,
    };
  }
  async function deliver(key: string) {
    const within = await database.connect();
    try {
      await within.query("SELECT pg_advisory_lock(hashtextextended($1,885))", [key]);
      const row = await read(key, within);
      if (!row || row.doneAt || (row.retryAt && row.retryAt > now())) return;
      const ready = await context(row, within);
      if (!ready) {
        await within.query("UPDATE coaching_notice SET done_at=$2 WHERE key=$1", [key, now()]);
        return;
      }
      const { person, notice } = ready;
      let failed = false;
      for (const channel of ["email", "push"] as const) {
        try {
          if ((await within.query("SELECT 1 FROM coaching_notice_channel WHERE notice_key=$1 AND channel=$2", [key, channel])).rowCount) continue;
          const prefs = await settings(person.id, within);
          if (channel !== "email" || (row.kind === "daily" ? prefs.daily : person.audience === "candidate" ? prefs.hourEmail : prefs.coachEmail))
            await deps[channel](person, notice);
          await within.query("INSERT INTO coaching_notice_channel(notice_key,channel,completed_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [
            key,
            channel,
            now(),
          ]);
        } catch {
          failed = true;
        }
      }
      await within.query("UPDATE coaching_notice SET done_at=$2,retry_at=$3 WHERE key=$1", [
        key,
        failed ? null : now(),
        failed ? new Date(now().getTime() + 300000) : null,
      ]);
    } catch {
      await within.query("UPDATE coaching_notice SET retry_at=$2 WHERE key=$1", [key, new Date(now().getTime() + 300000)]);
    } finally {
      try {
        await within.query("SELECT pg_advisory_unlock(hashtextextended($1,885))", [key]);
      } finally {
        within.release();
      }
    }
  }
  return {
    settings,
    async pushStillCurrent(id: string, notification: { event: string; noticeKey?: string; sessionId?: string }) {
      const kinds: Record<string, { kind: CoachingNotice["kind"]; audience: NoticeRecipient["audience"] }> = {
        coaching_session_hour: { kind: "hour_before", audience: "candidate" },
        coaching_session_hour_for_coach: { kind: "hour_before", audience: "coach" },
        coaching_session_eve: { kind: "day_before", audience: "coach" },
        coaching_day: { kind: "daily", audience: "coach" },
      };
      const expected = kinds[notification.event];
      if (!expected) return true;
      if (!(await deps.permitted()) || !notification.noticeKey) return false;
      const row = await read(notification.noticeKey);
      if (
        !row ||
        row.recipientId !== id ||
        row.kind !== expected.kind ||
        row.audience !== expected.audience ||
        (row.sessionId !== null && row.sessionId !== notification.sessionId)
      )
        return false;
      return !!(await context(row));
    },
    async purge() {
      const before = new Date(now().getTime() - 90 * 86400000);
      const notices = await database.query("DELETE FROM coaching_notice WHERE coalesce(done_at,created_at)<$1", [before]);
      const events = await database.query("DELETE FROM coaching_notice_event WHERE coalesce(processed_at,at)<$1", [before]);
      return (notices.rowCount ?? 0) + (events.rowCount ?? 0);
    },
    async updateSettings(id: string, input: unknown) {
      const parsed = settingInput.safeParse(input);
      if (!parsed.success) return false;
      const names = { hourEmail: "hour_email", coachEmail: "coach_email", daily: "daily" } as const;
      const fields = (Object.entries(parsed.data) as [keyof typeof names, boolean | undefined][]).filter(([, value]) => value !== undefined);
      if (!fields.length) return false;
      const columns = fields.map(([name]) => names[name]);
      return !!(
        await database.query(
          `INSERT INTO coaching_notice_setting(recipient_id,${columns.join(",")}) SELECT id,${columns.map((_, i) => `$${i + 2}`).join(",")} FROM candidate WHERE id=$1 ON CONFLICT(recipient_id) DO UPDATE SET ${columns.map((column) => `${column}=excluded.${column}`).join(",")}`,
          [id, ...fields.map(([, value]) => value)],
        )
      ).rowCount;
    },
    async sendDue() {
      if (!(await deps.permitted())) return;
      await discoverEvents();
      const sessions = await futureSessions();
      const coaches = new Map<string, string>();
      for (const s of sessions) {
        const coach = (
          await database.query<{ id: string }>('SELECT id FROM candidate WHERE lower(email)=(SELECT email FROM human_coach WHERE id=$1) AND "emailVerified"', [
            s.coachId,
          ])
        ).rows[0];
        if (coach) coaches.set(s.coachId, coach.id);
        if (s.scheduledAt.getTime() - now().getTime() > 3600000) continue;
        const people: { id: string; audience: NoticeRecipient["audience"] }[] = [
          { id: s.candidateId, audience: "candidate" },
          ...(coach ? [{ id: coach.id, audience: "coach" as const }] : []),
        ];
        for (const person of people) {
          const key = keyOf(`hour:${s.id}:${s.scheduledAt.toISOString()}:${s.version?.toISOString() ?? ""}:${person.audience}:${person.id}`);
          await database.query(
            "INSERT INTO coaching_notice(key,session_id,recipient_id,coach_id,audience,kind,scheduled_at,version) VALUES($1,$2,$3,$4,$5,'hour_before',$6,$7) ON CONFLICT DO NOTHING",
            [key, s.id, person.id, s.coachId, person.audience, s.scheduledAt, s.version],
          );
        }
      }
      for (const [coachId, id] of coaches) {
        const person = await recipient(id, "coach", coachId);
        if (!person) continue;
        const day = coachingDay(now(), person.timeZone);
        if (localTime(now(), person.timeZone) < "18:00") continue;
        for (const s of sessions.filter(
          (s) =>
            s.coachId === coachId &&
            coachingDay(s.scheduledAt, person.timeZone) === dayAfter(day) &&
            zonedClock(s.version ?? s.paidAt, person.timeZone) <= `${day}T18:00:00`,
        )) {
          const key = keyOf(`eve:${s.id}:${s.scheduledAt.toISOString()}:${s.version?.toISOString() ?? ""}:${id}`);
          await database.query(
            "INSERT INTO coaching_notice(key,session_id,recipient_id,coach_id,audience,kind,scheduled_at,version) VALUES($1,$2,$3,$4,'coach','day_before',$5,$6) ON CONFLICT DO NOTHING",
            [key, s.id, id, coachId, s.scheduledAt, s.version],
          );
        }
      }
      for (const [coachId, id] of coaches) {
        const person = await recipient(id, "coach", coachId);
        if (!person) continue;
        const prefs = await settings(id),
          day = coachingDay(now(), person.timeZone),
          time = localTime(now(), person.timeZone);
        if (
          !prefs.daily ||
          time < "07:30" ||
          time >= "12:00" ||
          !sessions.some((s) => s.coachId === coachId && coachingDay(s.scheduledAt, person.timeZone) === day)
        )
          continue;
        await database.query(
          "INSERT INTO coaching_notice(key,recipient_id,coach_id,audience,kind,local_day) VALUES($1,$2,$3,'coach','daily',$4) ON CONFLICT DO NOTHING",
          [keyOf(`daily:${coachId}:${id}:${day}`), id, coachId, day],
        );
      }
      const due = (
        await database.query<{ key: string }>(
          "SELECT key FROM coaching_notice WHERE done_at IS NULL AND (retry_at IS NULL OR retry_at<=$1) ORDER BY created_at,key LIMIT 100",
          [now()],
        )
      ).rows;
      for (const row of due) await deliver(row.key);
    },
  };
}
export async function migrateCoachingNotifications(database: Pool) {
  await database.query(`
 CREATE TABLE IF NOT EXISTS coaching_notice_setting(recipient_id text PRIMARY KEY REFERENCES candidate(id) ON DELETE CASCADE,hour_email boolean NOT NULL DEFAULT true,coach_email boolean NOT NULL DEFAULT true,daily boolean NOT NULL DEFAULT true);
 CREATE TABLE IF NOT EXISTS coaching_notice(key text PRIMARY KEY,session_id uuid REFERENCES coaching_session(id) ON DELETE CASCADE,recipient_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,coach_id uuid NOT NULL REFERENCES human_coach(id),audience text NOT NULL CHECK(audience IN ('candidate','coach')),kind text NOT NULL,scheduled_at timestamptz,local_day text,version timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),retry_at timestamptz,done_at timestamptz);
 ALTER TABLE coaching_notice ALTER COLUMN session_id DROP NOT NULL;
 ALTER TABLE coaching_notice ALTER COLUMN scheduled_at DROP NOT NULL;
 ALTER TABLE coaching_notice ADD COLUMN IF NOT EXISTS local_day text;
 ALTER TABLE coaching_notice ADD COLUMN IF NOT EXISTS event_at timestamptz;
 CREATE INDEX IF NOT EXISTS coaching_notice_due_session_idx ON coaching_session(scheduled_at) WHERE withdrawn_at IS NULL AND cancelled_at IS NULL;
 CREATE TABLE IF NOT EXISTS coaching_notice_event(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid NOT NULL REFERENCES coaching_session(id) ON DELETE CASCADE,kind text NOT NULL,at timestamptz NOT NULL,scheduled_at timestamptz,version timestamptz,transaction_id text NOT NULL,handled_by_case boolean NOT NULL DEFAULT false,processed_at timestamptz,UNIQUE(session_id,transaction_id,kind));
 CREATE INDEX IF NOT EXISTS coaching_notice_event_pending_idx ON coaching_notice_event(at,id) WHERE processed_at IS NULL;
 CREATE OR REPLACE FUNCTION coaching_notice_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE event_kind text;event_at timestamptz; BEGIN
 IF TG_OP='INSERT' THEN event_kind='paid';event_at=NEW.paid_at;
 ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN event_kind=CASE WHEN NEW.scheduled_at IS NULL THEN 'cancelled' WHEN OLD.scheduled_at IS NULL THEN 'booked' ELSE 'rescheduled' END;event_at=coalesce(NEW.date_set_at,clock_timestamp());
 ELSIF (NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL) OR (NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL) THEN event_kind='cancelled';event_at=coalesce(NEW.withdrawn_at,NEW.cancelled_at,clock_timestamp());
 ELSE RETURN NEW;END IF;
 INSERT INTO coaching_notice_event(session_id,kind,at,scheduled_at,version,transaction_id,handled_by_case) VALUES(NEW.id,event_kind,event_at,CASE WHEN event_kind='cancelled' THEN OLD.scheduled_at ELSE NEW.scheduled_at END,NEW.date_set_at,pg_current_xact_id()::text,event_kind='cancelled' AND EXISTS(SELECT 1 FROM coaching_cancellation c WHERE c.session_id=NEW.id AND c.choice IN ('awaiting','refund','peer')))
 ON CONFLICT(session_id,transaction_id,kind) DO UPDATE SET at=greatest(coaching_notice_event.at,excluded.at),handled_by_case=coaching_notice_event.handled_by_case OR excluded.handled_by_case,scheduled_at=coalesce(excluded.scheduled_at,coaching_notice_event.scheduled_at),version=excluded.version;
 RETURN NEW;END $$;
 DROP TRIGGER IF EXISTS coaching_notice_lifecycle ON coaching_session;
 CREATE TRIGGER coaching_notice_lifecycle AFTER INSERT OR UPDATE ON coaching_session FOR EACH ROW EXECUTE FUNCTION coaching_notice_lifecycle();
 CREATE TABLE IF NOT EXISTS coaching_notice_channel(notice_key text NOT NULL REFERENCES coaching_notice(key) ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN ('email','push')),completed_at timestamptz NOT NULL,PRIMARY KEY(notice_key,channel));
`);
}

export async function coachingNotificationsOf(database: Queryable, id: string) {
  const settings = (
    await database.query('SELECT hour_email AS "hourEmail",coach_email AS "coachEmail",daily FROM coaching_notice_setting WHERE recipient_id=$1', [id])
  ).rows;
  const notices = (
    await database.query(
      'SELECT key,session_id AS "sessionId",audience,kind,scheduled_at AS "scheduledAt",created_at AS "createdAt",done_at AS "completedAt" FROM coaching_notice WHERE recipient_id=$1 ORDER BY created_at,key',
      [id],
    )
  ).rows;
  const channels = (
    await database.query(
      'SELECT c.notice_key AS "noticeKey",c.channel,c.completed_at AS "completedAt" FROM coaching_notice_channel c JOIN coaching_notice n ON n.key=c.notice_key WHERE n.recipient_id=$1 ORDER BY c.completed_at,c.notice_key,c.channel',
      [id],
    )
  ).rows;
  const events = (
    await database.query(
      'SELECT e.id,e.session_id AS "sessionId",e.kind,e.at,e.scheduled_at AS "scheduledAt" FROM coaching_notice_event e JOIN coaching_session s ON s.id=e.session_id WHERE s.candidate_id=$1 ORDER BY e.at,e.id',
      [id],
    )
  ).rows;
  return { settings, notices, channels, events };
}
