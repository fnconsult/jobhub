/** Contractual cancellation differs from legal Withdrawal: a service remedy, with an auditable participant choice. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import { coachingRefunds } from "../coaching-refunds";
import { setAgendaItemDate } from "../reschedules";
export const CANCELLATION_NOTICE_MS = 24 * 3600000,
  COACH_CHOICE_MS = 7 * 86400000;
export const candidateMayCancel = (scheduledAt: Date | null, now: Date) =>
  scheduledAt === null || scheduledAt.getTime() - now.getTime() >= CANCELLATION_NOTICE_MS;
export interface Cancellation {
  id: string;
  sessionId: string;
  candidateId: string;
  coachId: string;
  coachName:string;
  source: "candidate" | "coach" | "retirement" | "cal";
  reason: string | null;
  createdAt: Date;
  originalAt: Date | null;
  choiceDueAt: Date | null;
  choice: "awaiting" | "same" | "peer" | "refund" | "withdrawn";
  peerCoachId: string | null;
  refundId: string | null;
  decidedAt: Date | null;
}
export interface PeerOffer {
  coachId: string;
  name: string;
  amount: number;
  currency: string;
  durationMinutes: number;
  specialties: string[];
  languages: string[];
}
interface Session {
  id: string;
  candidateId: string;
  coachId: string;
  scheduledAt: Date | null;
  withdrawnAt: Date | null;
  cancelledAt: Date | null;
  retiredAt: Date | null;
  amount: number;
  currency: string;
  durationMinutes: number;
}
const COLUMNS =
  'id,session_id AS "sessionId",candidate_id AS "candidateId",coach_id AS "coachId",(SELECT h.name FROM human_coach h WHERE h.id=coaching_cancellation.coach_id) AS "coachName",source,reason,created_at AS "createdAt",original_at AS "originalAt",choice_due_at AS "choiceDueAt",choice,peer_coach_id AS "peerCoachId",refund_id AS "refundId",decided_at AS "decidedAt"';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function coachingCancellations(
  database: Pool,
  deps: {
    sendNotice?: (cancellation: Cancellation, kind: string) => Promise<void>;
    refunds: Pick<ReturnType<typeof coachingRefunds>, "request" | "run" | "one">;
    permitted?: () => Promise<boolean>;
    now?: () => Date;
    reopen?: (sessionId: string, within: Queryable) => Promise<void>;
    peers?: (candidateId: string, session: Session, within: Queryable) => Promise<PeerOffer[]>;
  },
) {
  const now = deps.now ?? (() => new Date()),
    permitted = deps.permitted ?? (async () => false);
  async function ownedSession(sessionId: string, within: Queryable) {
    return (
      (
        await within.query<Session>(
          `SELECT s.id,s.candidate_id AS "candidateId",s.coach_id AS "coachId",s.scheduled_at AS "scheduledAt",s.withdrawn_at AS "withdrawnAt",s.cancelled_at AS "cancelledAt",h.retired_at AS "retiredAt",s.amount,s.currency,coalesce(s.duration_minutes,60) AS "durationMinutes" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id WHERE s.id=$1 FOR UPDATE OF s`,
          [sessionId],
        )
      ).rows[0] ?? null
    );
  }
  async function one(id: string, within: Queryable = database) {
    return (await within.query<Cancellation>(`SELECT ${COLUMNS} FROM coaching_cancellation WHERE id=$1`, [id])).rows[0] ?? null;
  }
  async function event(within: Queryable, cancellation: Cancellation, action: string, source: string) {
    await within.query("INSERT INTO coaching_cancellation_event(id,cancellation_id,action,source,at) VALUES($1,$2,$3,$4,$5)", [
      randomUUID(),
      cancellation.id,
      action,
      source,
      now(),
    ]);
  }
  async function notice(within: Queryable, cancellation: Cancellation, kind: string) {
    await within.query("INSERT INTO coaching_cancellation_notice(cancellation_id,kind,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [
      cancellation.id,
      kind,
      now(),
    ]);
  }
  async function requestRefund(within: Queryable, cancellation: Cancellation, choice: "refund" | "peer", peerCoachId: string | null, source = "candidate") {
    const refund = await deps.refunds.request(cancellation.sessionId, within);
    if (!refund) throw new Error("Cancellation payment context missing");
    await within.query("UPDATE coaching_cancellation SET choice=$2,peer_coach_id=$3,refund_id=$4,decided_at=$5 WHERE id=$1", [
      cancellation.id,
      choice,
      peerCoachId,
      refund.id,
      now(),
    ]);
    await within.query("UPDATE coaching_session SET cancelled_at=$2 WHERE id=$1", [cancellation.sessionId, now()]);
    const changed = (await one(cancellation.id, within))!;
    await event(within, changed, choice, source);
    await notice(within, changed, "refund_requested");
    return changed;
  }
  async function begin(input: { sessionId: string; actorId: string; source: Cancellation["source"]; reason: string | null; requestKey: string }) {
    if (!UUID.test(input.sessionId) || !input.requestKey || input.requestKey.length > 200 || (input.source !== "retirement" && !(await permitted())))
      return { ok: false as const, error: "unavailable" as const };
    return inTransaction(database, async (within) => {
      const session = await ownedSession(input.sessionId, within);
      if (
        !session ||
        (input.source === "candidate" ? session.candidateId !== input.actorId : session.coachId !== input.actorId) ||
        (input.source === "coach" && session.retiredAt)
      )
        return { ok: false as const, error: "not_found" as const };
      const replay = (
        await within.query<Cancellation>(`SELECT ${COLUMNS} FROM coaching_cancellation WHERE request_key=$1 AND candidate_id=$2`, [
          input.requestKey,
          session.candidateId,
        ])
      ).rows[0];
      if (replay) return replay.sessionId === session.id ? { ok: true as const, cancellation: replay } : { ok: false as const, error: "not_found" as const };
      if (session.withdrawnAt || session.cancelledAt) return { ok: false as const, error: "not_found" as const };
      const pending = (
        await within.query<Cancellation>(`SELECT ${COLUMNS} FROM coaching_cancellation WHERE session_id=$1 AND choice='awaiting' FOR UPDATE`, [session.id])
      ).rows[0];
      if (pending && input.source !== "candidate") {
        if (pending.source === "cal" && !pending.choiceDueAt && (input.source === "coach" || input.source === "retirement")) {
          if (input.source === "coach" && (!input.reason?.trim() || input.reason.trim().length > 2000))
            return { ok: false as const, error: "reason_required" as const };
          await within.query("UPDATE coaching_cancellation SET source=$4,reason=$2,choice_due_at=$3 WHERE id=$1", [
            pending.id,
            input.reason?.trim() || "Coach retired",
            new Date(now().getTime() + COACH_CHOICE_MS),
            input.source,
          ]);
          const confirmed = (await one(pending.id, within))!;
          await event(within, confirmed, "confirmed", input.source);
          await notice(within, confirmed, "choice_requested");
          return { ok: true as const, cancellation: confirmed };
        }
        return { ok: true as const, cancellation: pending };
      }
      if (
        input.source === "candidate" &&
        (!pending || (pending.source === "cal" && !pending.choiceDueAt)) &&
        !candidateMayCancel(pending?.originalAt ?? session.scheduledAt, now())
      )
        return { ok: false as const, error: "too_late" as const };
      if (input.source === "coach" && (!input.reason?.trim() || input.reason.trim().length > 2000))
        return { ok: false as const, error: "reason_required" as const };
      if (pending) {
        const changed = await requestRefund(within, pending, "refund", null);
        return { ok: true as const, cancellation: changed };
      }
      // Keep a previously completed service's monthly business fact before a remedy changes its personal date.
      await within.query(
        `UPDATE coaching_connect_payment p SET service_archived=true,service_held_month=to_char((s.scheduled_at+coalesce(s.duration_minutes,60)*interval '1 minute') AT TIME ZONE 'Europe/Paris','YYYY-MM') FROM coaching_session s WHERE s.id=$1 AND p.checkout_id=s.stripe_checkout_session_id AND NOT p.service_archived AND s.scheduled_at IS NOT NULL AND s.scheduled_at+coalesce(s.duration_minutes,60)*interval '1 minute'<=$2`,
        [session.id, now()],
      );
      const id = randomUUID();
      await within.query(
        "INSERT INTO coaching_cancellation(id,session_id,candidate_id,coach_id,source,reason,request_key,created_at,original_at,choice_due_at,choice) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'awaiting')",
        [
          id,
          session.id,
          session.candidateId,
          session.coachId,
          input.source,
          input.reason?.trim() || null,
          input.requestKey,
          now(),
          session.scheduledAt,
          input.source === "candidate" ? null : new Date(now().getTime() + COACH_CHOICE_MS),
        ],
      );
      await setAgendaItemDate(
        within,
        { table: "coaching_session", id: session.id },
        { to: null, by: input.source === "candidate" ? "candidate" : input.source === "cal" ? "cal_com" : "coach", now: now() },
      );
      const cancellation = (await one(id, within))!;
      await event(within, cancellation, "cancelled", input.source);
      if (input.source === "candidate") {
        const changed = await requestRefund(within, cancellation, "refund", null);
        await notice(within, changed, "coach_cancelled");
        return { ok: true as const, cancellation: changed };
      }
      await notice(within, cancellation, "choice_requested");
      return { ok: true as const, cancellation };
    });
  }
  async function peerOptions(candidateId: string, id: string, within: Queryable = database) {
    const cancellation = await one(id, within);
    if (!cancellation || cancellation.candidateId !== candidateId) return [];
    const session = (
      await within.query<Session>(
        `SELECT s.id,s.candidate_id AS "candidateId",s.coach_id AS "coachId",s.amount,s.currency,coalesce(s.duration_minutes,60) AS "durationMinutes" FROM coaching_session s WHERE id=$1`,
        [cancellation.sessionId],
      )
    ).rows[0];
    return session && deps.peers
      ? (await deps.peers(candidateId, session, within)).filter(
          (p) => p.coachId !== session.coachId && p.currency === session.currency && p.amount <= session.amount,
        )
      : [];
  }
  async function choose(candidateId: string, id: string, choice: unknown, peerCoachId?: string, automatic = false) {
    if (!UUID.test(id) || !["refund", "same", "peer"].includes(String(choice)) || (!automatic && choice !== "refund" && !(await permitted())))
      return { ok: false as const, error: "unavailable" };
    const initial = await one(id);
    if (!initial || initial.candidateId !== candidateId) return { ok: false as const, error: "not_found" };
    const result = await inTransaction(database, async (within) => {
      const session = await ownedSession(initial.sessionId, within);
      const cancellation = (
        await within.query<Cancellation>(`SELECT ${COLUMNS} FROM coaching_cancellation WHERE id=$1 AND candidate_id=$2 FOR UPDATE`, [id, candidateId])
      ).rows[0];
      if (!session || !cancellation || session.withdrawnAt || session.cancelledAt || cancellation.choice !== "awaiting")
        return { ok: false as const, error: "not_pending" };
      if (cancellation.source === "cal" && !cancellation.choiceDueAt) return { ok: false as const, error: "confirmation_required" };
      if (cancellation.choiceDueAt && cancellation.choiceDueAt <= now()) {
        const changed = await requestRefund(within, cancellation, "refund", null, "timeout");
        return { ok: true as const, cancellation: changed };
      }
      if (choice === "same") {
        if (session.retiredAt || !deps.reopen) return { ok: false as const, error: "coach_unavailable" };
        await within.query("UPDATE coaching_cancellation SET choice='same',decided_at=$2 WHERE id=$1", [id, now()]);
        await deps.reopen(session.id, within);
        const changed = (await one(id, within))!;
        await event(within, changed, "same", "candidate");
        await notice(within, changed, "same_chosen");
        return { ok: true as const, cancellation: changed };
      }
      const peers = choice === "peer" ? await peerOptions(candidateId, id, within) : [];
      if (choice === "peer" && !peers.some((p) => p.coachId === peerCoachId)) return { ok: false as const, error: "peer_unavailable" };
      const changed = await requestRefund(within, cancellation, choice === "peer" ? "peer" : "refund", choice === "peer" ? peerCoachId! : null);
      return { ok: true as const, cancellation: changed };
    });
    if (result.ok && result.cancellation.refundId) await deps.refunds.run(result.cancellation.refundId);
    return result;
  }
  async function expireChoices(limit = 25) {
    const due = (
      await database.query<{ id: string; candidateId: string }>(
        `SELECT id,candidate_id AS "candidateId" FROM coaching_cancellation WHERE choice='awaiting' AND choice_due_at<=$1 ORDER BY choice_due_at,id LIMIT $2`,
        [now(), limit],
      )
    ).rows;
    for (const row of due) {
      await choose(row.candidateId, row.id, "refund", undefined, true);
    }
  }
  return {
    one,
    async candidateCancel(candidateId: string, sessionId: string, requestKey: string) {
      const result = await begin({ actorId: candidateId, sessionId, source: "candidate", reason: null, requestKey });
      if (result.ok && result.cancellation.refundId) await deps.refunds.run(result.cancellation.refundId);
      return result;
    },
    coachCancel: (coachId: string, sessionId: string, reason: string, requestKey: string) =>
      begin({ actorId: coachId, sessionId, source: "coach", reason, requestKey }),
    async forCandidate(candidateId: string) {
      return (
        await database.query<Cancellation>(`SELECT ${COLUMNS} FROM coaching_cancellation WHERE candidate_id=$1 ORDER BY created_at DESC,id`, [candidateId])
      ).rows;
    },
    async peerOrderCap(candidateId: string, id: string, coachId: string) {
      if (!UUID.test(id) || !(await permitted())) return null;
      const cancellation = await one(id);
      if (
        !cancellation ||
        cancellation.candidateId !== candidateId ||
        cancellation.choice !== "peer" ||
        cancellation.peerCoachId !== coachId ||
        !cancellation.refundId
      )
        return null;
      if ((await deps.refunds.one(cancellation.refundId))?.state !== "succeeded") return null;
      return (
        (
          await database.query<{ amount: number; currency: string }>("SELECT amount,currency FROM coaching_session WHERE id=$1 AND candidate_id=$2", [
            cancellation.sessionId,
            candidateId,
          ])
        ).rows[0] ?? null
      );
    },
    peerOptions,
    choose,
    expireChoices,
    async deliverNotices(limit = 25) {
      if (!deps.sendNotice) return;
      await database.query(
        `INSERT INTO coaching_cancellation_notice(cancellation_id,kind,created_at) SELECT c.id,'refund_'||r.state||':'||r.attempt||':'||coalesce(extract(epoch from r.resolved_at)::text,''),$1 FROM coaching_cancellation c JOIN coaching_service_refund r ON r.id=c.refund_id WHERE r.state IN ('succeeded','failed','needs_review') ON CONFLICT DO NOTHING`,
        [now()],
      );
      for (let n = 0; n < limit; n++) {
        const row = (
          await database.query<{ id: string; kind: string }>(
            `UPDATE coaching_cancellation_notice SET claimed_until=$1 WHERE (cancellation_id,kind)=(SELECT cancellation_id,kind FROM coaching_cancellation_notice WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until<=$2) AND (retry_at IS NULL OR retry_at<=$2) ORDER BY created_at,cancellation_id,kind FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING cancellation_id AS id,kind`,
            [new Date(now().getTime() + 300000), now()],
          )
        ).rows[0];
        if (!row) return;
        try {
          const cancellation = await one(row.id);
          if (cancellation) await deps.sendNotice(cancellation, row.kind);
          await database.query("UPDATE coaching_cancellation_notice SET sent_at=$3,claimed_until=NULL WHERE cancellation_id=$1 AND kind=$2", [
            row.id,
            row.kind,
            now(),
          ]);
        } catch {
          await database.query("UPDATE coaching_cancellation_notice SET retry_at=$3,claimed_until=NULL WHERE cancellation_id=$1 AND kind=$2", [
            row.id,
            row.kind,
            new Date(now().getTime() + 300000),
          ]);
        }
      }
    },
    async retiredCoaches(limit = 25) {
      if (!(await permitted())) return;
      const rows = (
        await database.query<{ id: string; coachId: string }>(
          `SELECT s.id,s.coach_id AS "coachId" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id WHERE h.retired_at IS NOT NULL AND s.cancelled_at IS NULL AND s.withdrawn_at IS NULL AND (coalesce(s.scheduled_at,(SELECT prior.original_at FROM coaching_cancellation prior WHERE prior.session_id=s.id AND prior.choice='awaiting' AND prior.source='cal' ORDER BY prior.created_at DESC LIMIT 1)) IS NULL OR coalesce(s.scheduled_at,(SELECT prior.original_at FROM coaching_cancellation prior WHERE prior.session_id=s.id AND prior.choice='awaiting' AND prior.source='cal' ORDER BY prior.created_at DESC LIMIT 1))>h.retired_at) AND NOT EXISTS(SELECT 1 FROM coaching_cancellation c WHERE c.session_id=s.id AND c.choice='awaiting' AND c.choice_due_at IS NOT NULL) ORDER BY s.paid_at,s.id LIMIT $1`,
          [limit],
        )
      ).rows;
      for (const row of rows)
        await begin({ sessionId: row.id, actorId: row.coachId, source: "retirement", reason: "Coach retired", requestKey: `retirement:${row.id}` });
    },
    async maySchedule(within: Queryable, sessionId: string, by: "candidate" | "coach", to: Date | null) {
      const session = (
        await within.query<{ scheduledAt: Date | null; cancelledAt: Date | null; retiredAt: Date | null }>(
          `SELECT s.scheduled_at AS "scheduledAt",s.cancelled_at AS "cancelledAt",h.retired_at AS "retiredAt" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id WHERE s.id=$1`,
          [sessionId],
        )
      ).rows[0];
      if (!session || session.cancelledAt || session.retiredAt) return false;
      if (!(await permitted())) return true;
      if ((await within.query("SELECT 1 FROM coaching_cancellation WHERE session_id=$1 AND choice='awaiting'", [sessionId])).rowCount) return false;
      return by === "coach" || session.scheduledAt?.getTime() === to?.getTime() || candidateMayCancel(session.scheduledAt, now());
    },
  };
}
export async function migrateCoachingCancellations(database: Pool) {
  await database.query(`ALTER TABLE coaching_session ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
 CREATE TABLE IF NOT EXISTS coaching_cancellation(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES coaching_session(id) ON DELETE CASCADE,candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,coach_id uuid NOT NULL REFERENCES human_coach(id),source text NOT NULL,reason text,request_key text UNIQUE NOT NULL,created_at timestamptz NOT NULL,original_at timestamptz,choice_due_at timestamptz,choice text NOT NULL,peer_coach_id uuid REFERENCES human_coach(id),refund_id uuid REFERENCES coaching_service_refund(id) ON DELETE CASCADE,decided_at timestamptz);
 ALTER TABLE coaching_cancellation DROP CONSTRAINT IF EXISTS coaching_cancellation_refund_id_fkey;
 ALTER TABLE coaching_cancellation ADD CONSTRAINT coaching_cancellation_refund_id_fkey FOREIGN KEY(refund_id) REFERENCES coaching_service_refund(id) ON DELETE CASCADE;
 CREATE UNIQUE INDEX IF NOT EXISTS coaching_cancellation_one_choice ON coaching_cancellation(session_id) WHERE choice='awaiting';
 CREATE TABLE IF NOT EXISTS coaching_cancellation_event(id uuid PRIMARY KEY,cancellation_id uuid NOT NULL REFERENCES coaching_cancellation(id) ON DELETE CASCADE,action text NOT NULL,source text NOT NULL,at timestamptz NOT NULL);
 CREATE OR REPLACE FUNCTION coaching_cancellation_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL THEN UPDATE coaching_cancellation SET choice='withdrawn',decided_at=NEW.withdrawn_at WHERE session_id=NEW.id AND choice='awaiting'; END IF;RETURN NEW;END $$;
 DROP TRIGGER IF EXISTS coaching_cancellation_withdrawal ON coaching_session;
 CREATE TRIGGER coaching_cancellation_withdrawal AFTER UPDATE OF withdrawn_at ON coaching_session FOR EACH ROW EXECUTE FUNCTION coaching_cancellation_withdrawal();
 CREATE TABLE IF NOT EXISTS coaching_cancellation_delivery(cancellation_id uuid NOT NULL REFERENCES coaching_cancellation(id) ON DELETE CASCADE,kind text NOT NULL,recipient_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN ('email','push')),completed_at timestamptz NOT NULL,PRIMARY KEY(cancellation_id,kind,recipient_id,channel));
 CREATE TABLE IF NOT EXISTS coaching_cancellation_notice(cancellation_id uuid NOT NULL REFERENCES coaching_cancellation(id) ON DELETE CASCADE,kind text NOT NULL,created_at timestamptz NOT NULL,claimed_until timestamptz,sent_at timestamptz,retry_at timestamptz,PRIMARY KEY(cancellation_id,kind));`);
}

/** Preserve an already-owed remedy before its personal Case/Session is erased. No new entitlement for a late Candidate cancellation. */
export async function preserveCancellationRefunds(database: Pool, within: Queryable, candidateId: string, includeRetired = false) {
  const owed = (
    await within.query<{ id: string }>(
      `SELECT s.id FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id WHERE s.candidate_id=$1 AND s.cancelled_at IS NULL AND s.withdrawn_at IS NULL AND (EXISTS(SELECT 1 FROM coaching_cancellation c WHERE c.session_id=s.id AND c.choice='awaiting' AND c.choice_due_at IS NOT NULL) OR ($2 AND h.retired_at IS NOT NULL AND (coalesce(s.scheduled_at,(SELECT prior.original_at FROM coaching_cancellation prior WHERE prior.session_id=s.id AND prior.choice='awaiting' AND prior.source='cal' ORDER BY prior.created_at DESC LIMIT 1)) IS NULL OR coalesce(s.scheduled_at,(SELECT prior.original_at FROM coaching_cancellation prior WHERE prior.session_id=s.id AND prior.choice='awaiting' AND prior.source='cal' ORDER BY prior.created_at DESC LIMIT 1))>h.retired_at))) FOR UPDATE OF s`,
      [candidateId, includeRetired],
    )
  ).rows;
  for (const session of owed) await coachingRefunds(database, {}).request(session.id, within);
}
export async function cancellationsOf(database: Queryable, candidateId: string) {
  const cancellations = (
    await database.query<Cancellation>(`SELECT ${COLUMNS} FROM coaching_cancellation WHERE candidate_id=$1 ORDER BY created_at,id`, [candidateId])
  ).rows;
  const events = (
    await database.query(
      `SELECT e.cancellation_id AS "cancellationId",e.action,e.source,e.at FROM coaching_cancellation_event e JOIN coaching_cancellation c ON c.id=e.cancellation_id WHERE c.candidate_id=$1 ORDER BY e.at,e.id`,
      [candidateId],
    )
  ).rows;
  const notices = (
    await database.query(
      `SELECT n.cancellation_id AS "cancellationId",n.kind,n.created_at AS "createdAt",n.sent_at AS "sentAt" FROM coaching_cancellation_notice n JOIN coaching_cancellation c ON c.id=n.cancellation_id WHERE c.candidate_id=$1 ORDER BY n.created_at`,
      [candidateId],
    )
  ).rows;
  const deliveries=(await database.query(`SELECT cancellation_id AS "cancellationId",kind,channel,completed_at AS "completedAt" FROM coaching_cancellation_delivery WHERE recipient_id=$1 ORDER BY completed_at,cancellation_id`,[candidateId])).rows;
  return { cancellations, events, notices,deliveries };
}

/** Signed provider facts do not authenticate the cancelling person. A late external cancellation needs a Coach's authenticated confirmation. */
export async function recordProviderCancellation(within: Queryable, sessionId: string, eventKey: string, at: Date, reason: string | null) {
  const s = (
    await within.query<{ candidateId: string; coachId: string; scheduledAt: Date | null }>(
      `SELECT candidate_id AS "candidateId",coach_id AS "coachId",scheduled_at AS "scheduledAt" FROM coaching_session WHERE id=$1`,
      [sessionId],
    )
  ).rows[0];
  if (!s) return;
  const id = randomUUID();
  const inserted = await within.query(
    `INSERT INTO coaching_cancellation(id,session_id,candidate_id,coach_id,source,reason,request_key,created_at,original_at,choice) VALUES($1,$2,$3,$4,'cal',$5,$6,$7,$8,'awaiting') ON CONFLICT DO NOTHING RETURNING id`,
    [id, sessionId, s.candidateId, s.coachId, reason, `cal:${eventKey}`, at, s.scheduledAt],
  );
  if (inserted.rowCount) {
    await within.query("INSERT INTO coaching_cancellation_event(id,cancellation_id,action,source,at) VALUES($1,$2,'confirmation_requested','cal',$3)", [
      randomUUID(),
      id,
      at,
    ]);
    await within.query("INSERT INTO coaching_cancellation_notice(cancellation_id,kind,created_at) VALUES($1,'confirmation_requested',$2)", [id, at]);
  }
}
