/** Durable full-refund entitlement. Writes are recovered in the original account before any retry. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import { CoachingRefundNotCreated, CoachingRefundContextMismatch, type CoachingRefundPort } from "./port";
export type CoachingRefundState = "pending" | "succeeded" | "failed" | "needs_review";
export interface CoachingRefund {
  id: string;
  sessionId: string | null;
  candidateId: string | null;
  checkoutId: string;
  accountId: string | null;
  paymentIntent: string | null;
  amount: number;
  currency: string;
  routingVerified: boolean;
  state: CoachingRefundState;
  attempt: number;
  createdAt: Date;
  resolvedAt: Date | null;
  failureReason: string | null;
}
interface Attempt {
  number: number;
  amount: number;
  startedAt: Date;
  outcome: "unknown" | "not_created" | "created";
  stripeRefundId: string | null;
  status: string | null;
}
const COLUMNS =
  'id,session_id AS "sessionId",candidate_id AS "candidateId",checkout_id AS "checkoutId",account_id AS "accountId",payment_intent AS "paymentIntent",amount,currency,routing_verified AS "routingVerified",state,attempt,created_at AS "createdAt",resolved_at AS "resolvedAt",failure_reason AS "failureReason"';
const ATTEMPT = 'number,amount,started_at AS "startedAt",outcome,stripe_refund_id AS "stripeRefundId",status';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function coachingRefunds(database: Pool, deps: { stripe?: CoachingRefundPort; now?: () => Date } = {}) {
  const now = deps.now ?? (() => new Date());
  async function one(id: string, within: Queryable = database) {
    return (await within.query<CoachingRefund>(`SELECT ${COLUMNS} FROM coaching_service_refund WHERE id=$1`, [id])).rows[0] ?? null;
  }
  async function locked<T>(id: string, work: (within: Queryable) => Promise<T>) {
    const client = await database.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,883))", [id]);
      return await work(client);
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,883))", [id]);
      } finally {
        client.release();
      }
    }
  }
  async function state(within: Queryable, id: string, value: CoachingRefundState, reason: string | null = null) {
    await within.query(
      "UPDATE coaching_service_refund SET state=$2,failure_reason=$3,retry_at=$4,resolved_at=CASE WHEN $2='succeeded' THEN coalesce(resolved_at,$5) ELSE NULL END WHERE id=$1",
      [id, value, reason, new Date(now().getTime() + 300000), now()],
    );
  }
  async function run(id: string) {
    if (!deps.stripe) return;
    const stripe = deps.stripe;
    await locked(id, async (within) => {
      const intent = await one(id, within);
      if (!intent || intent.state === "failed") return;
      if (!intent.routingVerified) {
        await state(within, id, "needs_review", "account_context_missing");
        return;
      }
      if (intent.amount === 0) {
        await state(within, id, "succeeded");
        return;
      }
      let attempt = (
        await within.query<Attempt>(`SELECT ${ATTEMPT} FROM coaching_service_refund_attempt WHERE refund_id=$1 ORDER BY number DESC LIMIT 1`, [id])
      ).rows[0];
      if (attempt && attempt.number < intent.attempt) attempt = undefined;
      else if (attempt && attempt.number !== intent.attempt)
        await within.query("UPDATE coaching_service_refund SET attempt=$2 WHERE id=$1", [id, attempt.number]);
      try {
        const inspected = await stripe.inspect(intent);
        if (intent.paymentIntent && intent.paymentIntent !== inspected.paymentIntent)
          throw new CoachingRefundContextMismatch("Refund payment identity changed");
        await within.query("UPDATE coaching_service_refund SET payment_intent=$2 WHERE id=$1", [id, inspected.paymentIntent]);
        const refunds = inspected.refunds;
        if (refunds.some((r) => !Number.isSafeInteger(r.amount) || r.amount < 0 || r.currency !== intent.currency))
          throw new CoachingRefundContextMismatch("Invalid refund balance");
        const active = refunds.filter((r) => r.status !== "failed");
        const total = active.reduce((sum, r) => sum + BigInt(r.amount), 0n);
        if (total > BigInt(intent.amount)) throw new CoachingRefundContextMismatch("Refund balance exceeds payment");
        const own = attempt ? refunds.filter((r) => r.intentId === id && r.attempt === attempt!.number) : [];
        if (own.length > 1) throw new CoachingRefundContextMismatch("Multiple refunds for one attempt");
        if (own[0]) {
          const resource = own[0];
          if (resource.amount !== attempt!.amount) throw new CoachingRefundContextMismatch("Refund attempt amount changed");
          await within.query("UPDATE coaching_service_refund_attempt SET outcome='created',stripe_refund_id=$3,status=$4 WHERE refund_id=$1 AND number=$2", [
            id,
            attempt!.number,
            resource.id,
            resource.status,
          ]);
        }
        if (total === BigInt(intent.amount)) {
          await state(within, id, active.some((r) => r.status === "pending") ? "pending" : "succeeded");
          return;
        }
        if (own[0]?.status === "failed") {
          await state(within, id, "failed", "stripe_refund_failed");
          return;
        }
        if (own[0]) {
          await state(within, id, own[0].status === "pending" ? "pending" : "failed", "incomplete_refund_balance");
          return;
        }
        const remaining = intent.amount - Number(total);
        if (attempt) {
          // A timed-out write may exist. Preserve its original amount/key; never replace an aged unknown outcome.
          if (attempt.outcome === "not_created") {
            await state(within, id, "failed", "stripe_refused");
            return;
          }
          if (attempt.outcome === "created" || attempt.amount !== remaining || now().getTime() - attempt.startedAt.getTime() > 23 * 3600000) {
            await state(within, id, "needs_review", "remote_outcome_unknown");
            return;
          }
        } else {
          attempt = { number: Math.max(1, intent.attempt), amount: remaining, startedAt: now(), outcome: "unknown", stripeRefundId: null, status: null };
          // Each statement commits before the remote write. A restart recovers this durable attempt rather than inventing a new key.
          await within.query("INSERT INTO coaching_service_refund_attempt(refund_id,number,amount,started_at,outcome) VALUES($1,$2,$3,$4,'unknown')", [
            id,
            attempt.number,
            attempt.amount,
            attempt.startedAt,
          ]);
          await within.query("UPDATE coaching_service_refund SET attempt=$2 WHERE id=$1", [id, attempt.number]);
        }
        try {
          const resource = await stripe.create({
            ...intent,
            paymentIntent: inspected.paymentIntent,
            intentId: id,
            attempt: attempt.number,
            refundAmount: attempt.amount,
          });
          if (resource.intentId !== id || resource.attempt !== attempt.number || resource.amount !== attempt.amount || resource.currency !== intent.currency)
            throw new Error("Refund response context mismatch");
          await within.query("UPDATE coaching_service_refund_attempt SET outcome='created',stripe_refund_id=$3,status=$4 WHERE refund_id=$1 AND number=$2", [
            id,
            attempt.number,
            resource.id,
            resource.status,
          ]);
          await state(
            within,
            id,
            resource.status === "failed" ? "failed" : resource.status === "pending" || active.some((r) => r.status === "pending") ? "pending" : "succeeded",
            resource.status === "failed" ? "stripe_refund_failed" : null,
          );
        } catch (error) {
          if (error instanceof CoachingRefundNotCreated) {
            await within.query("UPDATE coaching_service_refund_attempt SET outcome='not_created' WHERE refund_id=$1 AND number=$2", [id, attempt.number]);
            await state(within, id, "failed", "stripe_refused");
          } else await state(within, id, "pending", "stripe_unavailable");
        }
      } catch (error) {
        await state(
          within,
          id,
          error instanceof CoachingRefundContextMismatch ? "needs_review" : "pending",
          error instanceof CoachingRefundContextMismatch ? "refund_context_mismatch" : "stripe_unavailable",
        );
      }
    });
  }
  return {
    one,
    run,
    /** Internal only: the cancellation transaction already checked the participant and refund entitlement. */
    async request(sessionId: string, within: Queryable = database) {
      if (!UUID.test(sessionId)) return null;
      const payment = (
        await within.query<{
          candidateId: string;
          checkoutId: string;
          accountId: string | null;
          paymentIntent: string | null;
          amount: number;
          currency: string;
          routingVerified: boolean;
        }>(
          `SELECT s.candidate_id AS "candidateId",s.stripe_checkout_session_id AS "checkoutId",p.account_id AS "accountId",p.payment_intent AS "paymentIntent",s.amount,s.currency,(p.id IS NOT NULL OR sale.snapshot#>>'{seller,kind}'='jobbbox') AS "routingVerified" FROM coaching_session s LEFT JOIN coaching_connect_payment p ON p.checkout_id=s.stripe_checkout_session_id LEFT JOIN coaching_session_sale sale ON sale.session_id=s.id WHERE s.id=$1`,
          [sessionId],
        )
      ).rows[0];
      if (!payment) return null;
      const id = randomUUID();
      await within.query(
        "INSERT INTO coaching_service_refund(id,session_id,candidate_id,checkout_id,account_id,payment_intent,amount,currency,routing_verified,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(checkout_id) DO NOTHING",
        [
          id,
          sessionId,
          payment.candidateId,
          payment.checkoutId,
          payment.accountId,
          payment.paymentIntent,
          payment.amount,
          payment.currency,
          payment.routingVerified === true,
          payment.routingVerified === true ? "pending" : "needs_review",
          now(),
        ],
      );
      return (await within.query<CoachingRefund>(`SELECT ${COLUMNS} FROM coaching_service_refund WHERE checkout_id=$1`, [payment.checkoutId])).rows[0]!;
    },
    async retry(id: string) {
      if (!UUID.test(id)) return false;
      const accepted = await locked(id, async (within) => {
        const intent = await one(id, within);
        if (!intent || intent.state !== "failed") return false;
        const attempt = (
          await within.query<Attempt>(`SELECT ${ATTEMPT} FROM coaching_service_refund_attempt WHERE refund_id=$1 AND number=$2`, [id, intent.attempt])
        ).rows[0];
        if (
          !attempt ||
          !(
            attempt.outcome === "not_created" ||
            (attempt.outcome === "created" &&
              (attempt.status === "failed" || (attempt.status === "succeeded" && intent.failureReason === "incomplete_refund_balance")))
          )
        )
          return false;
        // Keep the failed attempt immutable; no row for the next number exists until its new amount is inspected.
        await within.query("UPDATE coaching_service_refund SET state='pending',attempt=attempt+1,failure_reason=NULL,retry_at=NULL WHERE id=$1", [id]);
        return true;
      });
      if (accepted) await run(id);
      return accepted;
    },
    async runPending(limit = 25) {
      for (let n = 0; n < limit; n++) {
        const next = (
          await database.query<{ id: string }>(
            "UPDATE coaching_service_refund SET retry_at=$1 WHERE id=(SELECT id FROM coaching_service_refund WHERE state IN ('pending','needs_review') AND (retry_at IS NULL OR retry_at<=$2) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id",
            [new Date(now().getTime() + 300000), now()],
          )
        ).rows[0];
        if (!next) return;
        await run(next.id);
      }
    },
    async purge() {
      const before = new Date(now());
      before.setUTCFullYear(before.getUTCFullYear() - 10);
      return (await database.query("DELETE FROM coaching_service_refund WHERE state='succeeded' AND resolved_at<$1", [before])).rowCount ?? 0;
    },
    async changed(refundId: string, accountId: string | null) {
      const intent = (
        await database.query<{ id: string; accountId: string | null }>(
          `SELECT r.id,r.account_id AS "accountId" FROM coaching_service_refund r JOIN coaching_service_refund_attempt a ON a.refund_id=r.id WHERE a.stripe_refund_id=$1`,
          [refundId],
        )
      ).rows[0];
      if (intent && intent.accountId === accountId) await run(intent.id);
    },
  };
}
export async function migrateCoachingRefunds(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS coaching_service_refund(id uuid PRIMARY KEY,session_id uuid UNIQUE REFERENCES coaching_session(id) ON DELETE SET NULL,candidate_id text REFERENCES candidate(id) ON DELETE SET NULL,checkout_id text UNIQUE NOT NULL,account_id text,payment_intent text,amount integer NOT NULL CHECK(amount>=0),currency text NOT NULL,routing_verified boolean NOT NULL,state text NOT NULL,attempt integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL,resolved_at timestamptz,retry_at timestamptz,failure_reason text);
 ALTER TABLE coaching_service_refund ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
 CREATE TABLE IF NOT EXISTS coaching_service_refund_attempt(refund_id uuid NOT NULL REFERENCES coaching_service_refund(id) ON DELETE CASCADE,number integer NOT NULL,amount integer NOT NULL CHECK(amount>0),started_at timestamptz NOT NULL,outcome text NOT NULL,stripe_refund_id text UNIQUE,status text,PRIMARY KEY(refund_id,number));`);
}

/** The Candidate owns entitlement and attempt facts; processor routing is private operational data. */
export async function coachingRefundsOf(database: Queryable, candidateId: string) {
  const refunds = (
    await database.query<{ id: string }>(
      `SELECT id,session_id AS "sessionId",amount,currency,state,created_at AS "createdAt",resolved_at AS "resolvedAt",failure_reason AS "failureReason" FROM coaching_service_refund WHERE candidate_id=$1 ORDER BY created_at,id`,
      [candidateId],
    )
  ).rows;
  const attempts = (
    await database.query(
      `SELECT a.refund_id AS "refundId",a.number,a.amount,a.started_at AS "startedAt",a.status FROM coaching_service_refund_attempt a JOIN coaching_service_refund r ON r.id=a.refund_id WHERE r.candidate_id=$1 ORDER BY a.refund_id,a.number`,
      [candidateId],
    )
  ).rows;
  return { refunds, attempts };
}
