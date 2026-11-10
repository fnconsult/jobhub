/** Paid-session booking, with one-use claims and a durable remote-cancellation outbox. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { inTransaction, type Queryable } from "../database/pool";
import { readBookingToken, signBookingToken, validCalSignature } from "./token";
import type { CalEventType, CalPort } from "./port";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  uid = z.string().regex(/^[\w-]{1,200}$/);
const eventSchema = z.object({
  triggerEvent: z.enum(["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"]),
  createdAt: z.string().datetime({ offset: true }),
  payload: z.object({
    uid,
    eventTypeId: z.number().int().positive(),
    rescheduleUid: uid.optional().nullable(),
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
    metadata: z.record(z.string(), z.unknown()).optional(),
    cancellationReason: z.string().max(2000).optional(),
  }),
});
interface Booking {
  sessionId: string;
  event: CalEventType;
  nonce: string;
  expiresAt: Date;
  uid: string | null;
  state: string;
  lastEventAt: Date | null;
}
const BOOKING = 'session_id AS "sessionId",event,nonce,expires_at AS "expiresAt",uid,state,last_event_at AS "lastEventAt"';
export interface BookingDeps {
  secret: string;
  webhookSecret: string;
  cal?: CalPort;
  now?: () => Date;
  permitted?: () => Promise<boolean>;
  mayBookCoach?: (coachId: string) => Promise<boolean>;
  /** Called after a durable change. Notifications must be keyed by event hash. */
  changed?: (sessionId: string, eventKey: string) => Promise<void>;
}
export function coachingBooking(database: Pool, deps: BookingDeps) {
  const now = deps.now ?? (() => new Date()),
    permitted = deps.permitted ?? (async () => false);
  async function configured(coachId: string, within: Queryable = database) {
    return (await within.query<{ event: CalEventType }>("SELECT event FROM coaching_cal_event_type WHERE coach_id=$1", [coachId])).rows[0]?.event ?? null;
  }
  return {
    configured,
    async paths(candidateId: string) {
      if (!(await permitted())) return {} as Record<string, string>;
      const rows = (
        await database.query<{ id: string; coachId: string }>(
          `SELECT s.id,s.coach_id AS "coachId" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL JOIN coaching_cal_event_type e ON e.coach_id=h.id LEFT JOIN coaching_cal_booking b ON b.session_id=s.id WHERE s.candidate_id=$1 AND s.withdrawn_at IS NULL AND (b.uid IS NOT NULL OR (s.scheduled_at IS NULL AND coalesce(s.duration_minutes,60)=(e.event->>'durationMinutes')::integer))`,
          [candidateId],
        )
      ).rows;
      const paths: Record<string, string> = {};
      for (const row of rows) if (await deps.mayBookCoach?.(row.coachId)) paths[row.id] = `/coachs/seances/${row.id}/reserver`;
      return paths;
    },
    /** An explicit team event is read back and verified before it is attached. */
    async configure(coachId: string, teamId: number, eventTypeId: number, hostId: number, within?: Queryable) {
      if (!deps.cal || !UUID.test(coachId) || ![teamId, eventTypeId, hostId].every((v) => Number.isSafeInteger(v) && v > 0)) return false;
      const event = await deps.cal.eventType(teamId, eventTypeId);
      if (event.hostId !== hostId) return false;
      const save = async (within: Queryable) => {
        if (!(await within.query("SELECT id FROM human_coach WHERE id=$1 AND retired_at IS NULL FOR UPDATE", [coachId])).rowCount) return false;
        const offer = (await within.query<{ duration: number }>("SELECT duration_minutes AS duration FROM coaching_offer WHERE coach_id=$1", [coachId]))
          .rows[0];
        if (offer && offer.duration !== event.durationMinutes) return false;
        await within.query(
          "INSERT INTO coaching_cal_event_type(coach_id,event_type_id,event,configured_at) VALUES($1,$2,$3,$4) ON CONFLICT(coach_id) DO UPDATE SET event_type_id=excluded.event_type_id,event=excluded.event,configured_at=excluded.configured_at",
          [coachId, event.id, event, now()],
        );
        return true;
      };
      return within ? save(within) : inTransaction(database, save);
    },
    /** A failed create may have reached Cal.com: another create requires manual reconciliation, never a blind retry. */
    async create(coachId: string, input: { teamId: number; hostId: number; durationMinutes: number; title: string }) {
      if (
        !deps.cal ||
        !(await permitted()) ||
        !UUID.test(coachId) ||
        ![input.teamId, input.hostId, input.durationMinutes].every((v) => Number.isSafeInteger(v) && v > 0) ||
        input.durationMinutes > 480 ||
        !input.title.trim() ||
        input.title.length > 200
      )
        return null;
      const claimed = await database.query(
        "INSERT INTO coaching_cal_creation(coach_id,started_at) SELECT id,$2 FROM human_coach WHERE id=$1 AND retired_at IS NULL ON CONFLICT DO NOTHING RETURNING coach_id",
        [coachId, now()],
      );
      if (!claimed.rowCount) return null;
      const event = await deps.cal.createEventType({ ...input, slug: `jobbbox-${coachId}` });
      // Store the remote result even if attachment needs a duration correction/review.
      await database.query("UPDATE coaching_cal_creation SET event_type_id=$2 WHERE coach_id=$1", [coachId, event.id]);
      return event;
    },
    async forCandidate(candidateId: string, sessionId: string) {
      if (!UUID.test(sessionId) || !(await permitted())) return null;
      return inTransaction(database, async (within) => {
        const session = (
          await within.query<{ duration: number; scheduledAt: Date | null }>(
            `SELECT coalesce(s.duration_minutes,(sale.snapshot->>'durationMinutes')::integer,60) AS duration,s.scheduled_at AS "scheduledAt" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL LEFT JOIN coaching_session_sale sale ON sale.session_id=s.id WHERE s.id=$1 AND s.candidate_id=$2 AND s.withdrawn_at IS NULL FOR UPDATE OF s`,
            [sessionId, candidateId],
          )
        ).rows[0];
        if (!session) return null;
        let booking = (await within.query<Booking>(`SELECT ${BOOKING} FROM coaching_cal_booking WHERE session_id=$1`, [sessionId])).rows[0];
        if (booking?.uid) return { sessionId, event: booking.event, booked: true, token: null, uid: booking.uid };
        if (session.scheduledAt) return null;
        const coach = (await within.query<{ coachId: string }>('SELECT coach_id AS "coachId" FROM coaching_session WHERE id=$1', [sessionId])).rows[0]!;
        if (!deps.mayBookCoach || !(await deps.mayBookCoach(coach.coachId))) return null;
        const event = await configured(coach.coachId, within);
        if (!event || event.durationMinutes !== session.duration) return null;
        if (!booking || booking.expiresAt <= now()) {
          const nonce = randomUUID(),
            expires = new Date(now().getTime() + 24 * 3600000);
          await within.query(
            "INSERT INTO coaching_cal_booking(session_id,event,nonce,expires_at,state) VALUES($1,$2,$3,$4,'unclaimed') ON CONFLICT(session_id) DO UPDATE SET event=excluded.event,nonce=excluded.nonce,expires_at=excluded.expires_at,state='unclaimed'",
            [sessionId, event, nonce, expires],
          );
          booking = { sessionId, event, nonce, expiresAt: expires, uid: null, state: "unclaimed", lastEventAt: null };
        }
        return {
          sessionId,
          event: booking.event,
          booked: false,
          uid: null,
          token: signBookingToken({ sessionId, nonce: booking.nonce, expires: booking.expiresAt.getTime() }, deps.secret),
        };
      });
    },
    /** Raw body verified before parsing. Rejected bodies are not retained. */
    async webhook(body: string, signature: string | null) {
      if (Buffer.byteLength(body) > 65536 || !validCalSignature(body, signature, deps.webhookSecret)) return { verified: false, applied: false };
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return { verified: true, applied: false };
      }
      const parsed = eventSchema.safeParse(json);
      if (!parsed.success) return { verified: true, applied: false };
      const event = parsed.data,
        payload = event.payload,
        key = createHash("sha256").update(body).digest("hex"),
        at = new Date(event.createdAt);
      if (at.getTime() > now().getTime() + 300000) return { verified: true, applied: false };
      const token = readBookingToken(payload.metadata?.jobbbox_session, deps.secret);
      const result = await inTransaction(database, async (within) => {
        // Discover by bound UID first: later cancellations need not repeat the original metadata.
        const identity = (
          await within.query<{ sessionId: string }>(
            `SELECT session_id AS "sessionId" FROM coaching_cal_booking WHERE uid=$1 OR ($2::text IS NOT NULL AND uid=$2) OR ($3::uuid IS NOT NULL AND session_id=$3) ORDER BY CASE WHEN uid=$1 THEN 0 ELSE 1 END LIMIT 1`,
            [payload.uid, payload.rescheduleUid ?? null, token?.sessionId ?? null],
          )
        ).rows[0];
        let applied = false,
          reason = "unknown_booking";
        if (!identity && token) {
          const erased = (
            await within.query("SELECT 1 FROM coaching_cal_erased_claim WHERE nonce=$1 AND event_type_id=$2 AND forget_at>$3", [
              token.nonce,
              payload.eventTypeId,
              now(),
            ])
          ).rowCount;
          if (erased) {
            await within.query("INSERT INTO coaching_cal_cancellation(uid,queued_at) VALUES($1,$2) ON CONFLICT DO NOTHING", [payload.uid, now()]);
            reason = "erased_session";
          }
        }
        if (identity) {
          const session = (
            await within.query<{ scheduledAt: Date | null; withdrawnAt: Date | null; retiredAt: Date | null }>(
              `SELECT s.scheduled_at AS "scheduledAt",s.withdrawn_at AS "withdrawnAt",h.retired_at AS "retiredAt" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id WHERE s.id=$1 FOR UPDATE OF s`,
              [identity.sessionId],
            )
          ).rows[0];
          const booking = (await within.query<Booking>(`SELECT ${BOOKING} FROM coaching_cal_booking WHERE session_id=$1 FOR UPDATE`, [identity.sessionId]))
            .rows[0];
          if (session && booking) {
            const bound = booking.uid !== null,
              first = event.triggerEvent === "BOOKING_CREATED" && !bound;
            const validToken = token?.sessionId === booking.sessionId && token.nonce === booking.nonce && token.expires === booking.expiresAt.getTime();
            const same = booking.uid === payload.uid,
              chain = event.triggerEvent === "BOOKING_RESCHEDULED" && booking.uid === payload.rescheduleUid;
            reason = "invalid_claim";
            if (booking.event.id === payload.eventTypeId && (first ? validToken && token.expires > now().getTime() && !session.scheduledAt : same || chain)) {
              reason = "stale_event";
              if ((!booking.lastEventAt || at > booking.lastEventAt) && (!bound || booking.state === "booked")) {
                const start = new Date(payload.startTime),
                  end = new Date(payload.endTime),
                  cancelled = event.triggerEvent === "BOOKING_CANCELLED";
                reason = "invalid_duration";
                if (cancelled || ((!first || start > now()) && end.getTime() - start.getTime() === booking.event.durationMinutes * 60000)) {
                  if (session.withdrawnAt || session.retiredAt) {
                    await within.query("INSERT INTO coaching_cal_cancellation(uid,session_id,queued_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [
                      payload.uid,
                      identity.sessionId,
                      now(),
                    ]);
                    reason = "session_unavailable";
                  } else {
                    // Cal.com's actor is not authenticated by an attendee email: label the source explicitly.
                    if (session.scheduledAt && (cancelled || session.scheduledAt.getTime() !== start.getTime()))
                      await within.query(
                        "INSERT INTO coaching_session_reschedule(coaching_session_id,previous_at,new_at,changed_by,changed_at) VALUES($1,$2,$3,'cal_com',$4)",
                        [identity.sessionId, session.scheduledAt, cancelled ? null : start, at],
                      );
                    await within.query("SELECT set_config('jobbbox.cal_webhook','1',true)");
                    await within.query("UPDATE coaching_session SET scheduled_at=$2,date_set_at=$3,changed_by='cal_com' WHERE id=$1", [
                      identity.sessionId,
                      cancelled ? null : start,
                      cancelled ? null : at,
                    ]);
                    await within.query("UPDATE coaching_cal_booking SET uid=$2,state=$3,last_event_at=$4 WHERE session_id=$1", [
                      identity.sessionId,
                      payload.uid,
                      cancelled ? "cancelled" : "booked",
                      at,
                    ]);
                    applied = true;
                    reason = "applied";
                  }
                }
              }
            }
          }
        }
        const written = await within.query(
          "INSERT INTO coaching_cal_delivery(hash,session_id,received_at,reason) VALUES($1,$2,$3,$4) ON CONFLICT(hash) DO UPDATE SET reason=excluded.reason WHERE coaching_cal_delivery.reason<>'applied' RETURNING hash",
          [key, identity?.sessionId ?? null, now(), reason],
        );
        // The date equality/order checks already make duplicate effects impossible; the durable key scopes notices too.
        if (applied && written.rowCount)
          await within.query("INSERT INTO coaching_cal_notice(event_key,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [key, identity!.sessionId]);
        return applied && !!written.rowCount;
      });
      return { verified: true, applied: result };
    },
    /** Non-blocking for the refund caller: work is already durably queued by the session trigger. */
    async purge() {
      const before = new Date(now().getTime() - 30 * 86400000);
      await database.query("DELETE FROM coaching_cal_erased_claim WHERE forget_at<$1", [now()]);
      await database.query("DELETE FROM coaching_cal_delivery WHERE received_at<$1", [before]);
      await database.query("DELETE FROM coaching_cal_notice WHERE sent_at<$1", [before]);
      await database.query("DELETE FROM coaching_cal_cancellation WHERE done_at<$1", [before]);
      await database.query("DELETE FROM coaching_cal_booking WHERE uid IS NULL AND expires_at<$1", [new Date(now().getTime() - 7 * 86400000)]);
    },
    async deliverCancellations(limit = 25) {
      if (!deps.cal) return;
      for (let n = 0; n < limit; n++) {
        const row = (
          await database.query<{ uid: string }>(
            "UPDATE coaching_cal_cancellation SET retry_at=$1 WHERE uid=(SELECT uid FROM coaching_cal_cancellation WHERE done_at IS NULL AND (retry_at IS NULL OR retry_at<=$2) ORDER BY queued_at,uid FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING uid",
            [new Date(now().getTime() + 300000), now()],
          )
        ).rows[0];
        if (!row) return;
        try {
          await deps.cal.cancel(row.uid);
          await database.query("UPDATE coaching_cal_cancellation SET done_at=$2 WHERE uid=$1", [row.uid, now()]);
        } catch {
          console.warn("[coaching-booking] remote cancellation pending");
        }
      }
    },
    async deliverNotices(limit = 25) {
      if (!deps.changed) return;
      for (let n = 0; n < limit; n++) {
        const row = (
          await database.query<{ eventKey: string; sessionId: string }>(
            `UPDATE coaching_cal_notice SET retry_at=$1 WHERE event_key=(SELECT event_key FROM coaching_cal_notice WHERE sent_at IS NULL AND (retry_at IS NULL OR retry_at<=$2) ORDER BY event_key FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING event_key AS "eventKey",session_id AS "sessionId"`,
            [new Date(now().getTime() + 300000), now()],
          )
        ).rows[0];
        if (!row) return;
        try {
          await deps.changed(row.sessionId, row.eventKey);
          await database.query("UPDATE coaching_cal_notice SET sent_at=$2 WHERE event_key=$1", [row.eventKey, now()]);
        } catch {
          console.warn("[coaching-booking] booking notification pending");
        }
      }
    },
  };
}
export async function migrateCoachingBooking(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS coaching_cal_legal_observation(sha256 text PRIMARY KEY,first_seen timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS coaching_cal_event_type(coach_id uuid PRIMARY KEY REFERENCES human_coach(id),event_type_id integer UNIQUE NOT NULL,event jsonb NOT NULL,configured_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS coaching_cal_creation(coach_id uuid PRIMARY KEY REFERENCES human_coach(id),started_at timestamptz NOT NULL,event_type_id integer);
 CREATE TABLE IF NOT EXISTS coaching_cal_booking(session_id uuid PRIMARY KEY REFERENCES coaching_session(id) ON DELETE CASCADE,event jsonb NOT NULL,nonce uuid NOT NULL,expires_at timestamptz NOT NULL,uid text UNIQUE,state text NOT NULL,last_event_at timestamptz);
 CREATE TABLE IF NOT EXISTS coaching_cal_delivery(hash text PRIMARY KEY,session_id uuid REFERENCES coaching_session(id) ON DELETE CASCADE,received_at timestamptz NOT NULL,reason text NOT NULL);
 CREATE TABLE IF NOT EXISTS coaching_cal_cancellation(uid text PRIMARY KEY,session_id uuid REFERENCES coaching_session(id) ON DELETE SET NULL,queued_at timestamptz NOT NULL,retry_at timestamptz,done_at timestamptz);
 CREATE TABLE IF NOT EXISTS coaching_cal_erased_claim(nonce uuid PRIMARY KEY,event_type_id integer NOT NULL,forget_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS coaching_cal_notice(event_key text PRIMARY KEY,session_id uuid NOT NULL REFERENCES coaching_session(id) ON DELETE CASCADE,retry_at timestamptz,sent_at timestamptz);
 CREATE OR REPLACE FUNCTION coaching_cal_session_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN
   INSERT INTO coaching_cal_erased_claim(nonce,event_type_id,forget_at) SELECT nonce,(event->>'id')::integer,clock_timestamp()+interval '7 days' FROM coaching_cal_booking WHERE session_id=OLD.id ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP='DELETE' OR (NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL) THEN
   INSERT INTO coaching_cal_cancellation(uid,session_id,queued_at) SELECT uid,OLD.id,clock_timestamp() FROM coaching_cal_booking WHERE session_id=OLD.id AND uid IS NOT NULL AND state='booked' ON CONFLICT DO NOTHING;
  ELSIF NEW.scheduled_at IS NULL AND OLD.scheduled_at IS NOT NULL AND current_setting('jobbbox.cal_webhook',true) IS DISTINCT FROM '1' THEN
   INSERT INTO coaching_cal_cancellation(uid,session_id,queued_at) SELECT uid,OLD.id,clock_timestamp() FROM coaching_cal_booking WHERE session_id=OLD.id AND uid IS NOT NULL AND state='booked' ON CONFLICT DO NOTHING;
   UPDATE coaching_cal_booking SET state='cancelled' WHERE session_id=OLD.id;
  ELSIF NEW.withdrawn_at IS NULL AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at AND current_setting('jobbbox.cal_webhook',true) IS DISTINCT FROM '1' AND EXISTS(SELECT 1 FROM coaching_cal_booking WHERE session_id=OLD.id AND state='booked') THEN
   RAISE EXCEPTION 'Use Cal.com for a linked booking' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END $$;
 DROP TRIGGER IF EXISTS coaching_cal_session_lifecycle ON coaching_session;
 CREATE TRIGGER coaching_cal_session_lifecycle BEFORE UPDATE OR DELETE ON coaching_session FOR EACH ROW EXECUTE FUNCTION coaching_cal_session_lifecycle();
 ALTER TABLE coaching_session DROP CONSTRAINT IF EXISTS coaching_session_changed_by_check;
 ALTER TABLE coaching_session ADD CONSTRAINT coaching_session_changed_by_check CHECK(changed_by IN ('candidate','coach','cal_com'));
 ALTER TABLE coaching_session_reschedule DROP CONSTRAINT IF EXISTS coaching_session_reschedule_changed_by_check;
 ALTER TABLE coaching_session_reschedule ADD CONSTRAINT coaching_session_reschedule_changed_by_check CHECK(changed_by IN ('candidate','coach','cal_com'));`);
}

/** Export provider routing facts of owned sessions, never the signing secret or an unclaimed token. */
export async function bookingDataOf(database: Queryable, candidateId: string) {
  const bookings = (
    await database.query(
      `SELECT b.session_id AS "sessionId",b.event->>'id' AS "eventTypeId",b.uid,b.state,b.last_event_at AS "changedAt" FROM coaching_cal_booking b JOIN coaching_session s ON s.id=b.session_id WHERE s.candidate_id=$1 ORDER BY b.session_id`,
      [candidateId],
    )
  ).rows;
  const deliveries = (
    await database.query(
      `SELECT d.session_id AS "sessionId",d.received_at AS "receivedAt",d.reason FROM coaching_cal_delivery d JOIN coaching_session s ON s.id=d.session_id WHERE s.candidate_id=$1 ORDER BY d.received_at`,
      [candidateId],
    )
  ).rows;
  const notices = (
    await database.query(
      `SELECT n.session_id AS "sessionId",n.sent_at AS "sentAt" FROM coaching_cal_notice n JOIN coaching_session s ON s.id=n.session_id WHERE s.candidate_id=$1 ORDER BY n.event_key`,
      [candidateId],
    )
  ).rows;
  const cancellations = (
    await database.query(
      `SELECT c.session_id AS "sessionId",c.uid,c.queued_at AS "queuedAt",c.done_at AS "doneAt" FROM coaching_cal_cancellation c JOIN coaching_session s ON s.id=c.session_id WHERE s.candidate_id=$1 ORDER BY c.queued_at`,
      [candidateId],
    )
  ).rows;
  return { bookings, deliveries, notices, cancellations };
}
