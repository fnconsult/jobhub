/**
 * Withdrawals (« rétractation », #511, CONTEXT.md): a Candidate renounces a contract concluded online within its
 * withdrawal period (C. conso. L221-18, ./deadline), through « Renoncer au contrat ici », a page of Jobbbox's own
 * (L221-21 al. 3): a Plan's subscription, or a paid Coaching Session not held yet (or held, when it was bought without the
 * Immediate Performance Request, #512).
 *
 * One deep module. `createWithdrawals(database, deps)` answers:
 *  - what may the Candidate withdraw from now?   `contracts`, and `contract` for the form, with what was paid
 *  - « Confirmer la rétractation »                `withdraw`: the contract ends at once (the subscription cancelled in
 *    Stripe, no Scheduled Cancellation, the Candidate on Free; the Coaching Session cancelled and its Human Coach told),
 *    everything paid for it is refunded through Stripe, and the acknowledgement is emailed with the date and time,
 *    whatever happens to the refund. A 100 % code left nothing to refund: the Withdrawal is recorded all the same. The
 *    refund is in full, but for a Plan ordered with the Immediate Performance Request (#512, L221-25): the amount paid,
 *    less the share of the days elapsed since the start of its period (./prorata). A Coaching Session ordered with it is
 *    no longer withdrawable once held (L221-28 1°).
 *  - what does Support follow?                   `list` (every Withdrawal and its refunds), `retryRefund` (a failed one)
 *  - what does Stripe say later?                 `refundChanged`, from its signed webhook (a refund failing days later)
 * and `withdrawalsOf(database, candidateId)` for the Data export, `migrateWithdrawals(database)` for its tables.
 *
 * A Withdrawal is the Candidate's: deleted with their account (ON DELETE CASCADE, ADR-0010) and in their Data export,
 * without Stripe's identifiers. A Plan changed in the customer portal is the same contract: its period runs from the
 * subscription's start (an assumption to write in the CGV).
 */
import type { Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import * as z from "zod";
import type { Mailer } from "../auth";
import type { Billing, Payment, PlanName, RefundChange, RefundStatus } from "../billing";
import type { HumanCoaches } from "../human-coaches";
import type { Orders } from "../orders";
import { fieldErrors, type FieldError } from "../validation";
import { withdrawalDeadline, withdrawalOpen } from "./deadline";
import { withdrawalReceiptEmail, withdrawnSessionEmail } from "./email";
import { withdrawalRefund } from "./prorata";

export { withdrawalDeadline, withdrawalOpen, WITHDRAWAL_DAYS } from "./deadline";

/** A contract the Candidate may withdraw from now. */
export type WithdrawableContract = {
  /** What concludes it: the subscription's start, or the Coaching Session's payment. */
  concludedAt: Date;
  /** The first instant it can no longer be withdrawn from. */
  deadline: Date;
  /** What was paid for it; null when not known here (a Plan's is asked of Stripe for the form, see `contract`). */
  paid: { amount: number; currency: string } | null;
  /** The Plan's name, or the Human Coach's (the same in each language). */
  subject: PlanName;
} & ({ ref: "plan"; kind: "plan" } | { ref: `coaching-session:${string}`; kind: "coachingSession"; sessionId: string });

/** The form's value naming a contract: "plan", or "coaching-session:<id>". */
export type ContractRef = WithdrawableContract["ref"];

/** A contract as its Withdrawal form shows it: what a Withdrawal now would refund (null when not known here), and whether the Immediate Performance Request was made (#512). */
export type ContractToWithdraw = WithdrawableContract & { refund: { amount: number; currency: string } | null; immediateExecutionRequested: boolean };

/** Where one refund of a Withdrawal stands: Stripe's statuses, `requires_action` counted as pending and `canceled` as failed. */
export type RefundState = "pending" | "succeeded" | "failed";

export interface WithdrawalRefund {
  id: string;
  amount: number;
  currency: string;
  status: RefundState;
  /** What was kept of the payment, for the service already provided (#512): 0 when it is refunded in full. */
  kept: number;
  /** Stripe's error code or `failure_reason` while failed; null otherwise. */
  failureReason: string | null;
  /** How many times it was asked of Stripe. */
  attempts: number;
}

/** A recorded Withdrawal. */
export interface Withdrawal {
  id: string;
  contract: "plan" | "coachingSession";
  subject: PlanName;
  concludedAt: Date;
  withdrawnAt: Date;
  /** The name the Candidate gave on the form. */
  name: string;
  /** Where the acknowledgement went. */
  receiptEmail: string;
  /** When it went; null when the mailer failed. */
  receiptSentAt: Date | null;
  /** One per payment made for the contract; none when nothing was paid (a 100 % code). */
  refunds: WithdrawalRefund[];
}

/** A Withdrawal as Support reads it in the Back Office: with whose it is. */
export interface ListedWithdrawal extends Withdrawal {
  candidateEmail: string;
}

export type WithdrawResult =
  | { ok: true; withdrawal: Withdrawal }
  | { ok: false; errors: FieldError[] }
  /** Nothing to withdraw from under that name now: over its period, held, ended, or withdrawn from already. */
  | { ok: false; error: "not_withdrawable" }
  /** Stripe could not end the subscription: nothing was recorded, the Candidate may try again. */
  | { ok: false; error: "stripe_unavailable" };

export type RetryRefundResult = { ok: true; status: RefundState } | { ok: false; error: "not_found" | "not_failed" };

export interface WithdrawalsDeps {
  billing: Pick<Billing, "subscription" | "paidOnSubscription" | "endSubscriptionNow" | "coachingSessionPayment" | "refund">;
  humanCoaches: Pick<HumanCoaches, "sessions" | "withdrawSession">;
  /** Whether the contract was bought with the Immediate Performance Request (#512). */
  orders: Pick<Orders, "immediateExecutionRequested">;
  mailer: Mailer;
  /** The app's public origin. */
  baseURL: string;
  now?: () => Date;
}

export interface Withdrawals {
  /** The contracts the Candidate may withdraw from now: their Plan's subscription, and each paid Coaching Session not held yet. */
  contracts(candidateId: string): Promise<WithdrawableContract[]>;
  /**
   * One of them, by the form's value, with what was paid for it and what a Withdrawal now refunds (a Plan's asked of
   * Stripe; null when it does not answer); null when none.
   */
  contract(candidateId: string, ref: string): Promise<ContractToWithdraw | null>;
  /**
   * « Confirmer la rétractation ». `input` is untrusted: { contract (a ContractRef), name, receipt: "account" | "other",
   * receiptEmail (when "other") }; the acknowledgement goes to the account's email or that one, in `language`.
   * Safe under a double click: one Withdrawal per contract.
   */
  withdraw(candidate: { id: string; email: string }, input: unknown, language: Locale): Promise<WithdrawResult>;
  /** One of the Candidate's own Withdrawals, or null. */
  withdrawal(candidateId: string, id: string): Promise<Withdrawal | null>;
  /** Every Withdrawal, newest first, for Support. */
  list(): Promise<ListedWithdrawal[]>;
  /** Asks Stripe again for a refund that failed (a new request, never the first one replayed). */
  retryRefund(refundId: string): Promise<RetryRefundResult>;
  /** A refund's status as Stripe reported it later (webhook). A failed refund stays failed until tried again. */
  refundChanged(change: RefundChange): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const withdrawSchema = z
  .object({
    contract: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    receipt: z.enum(["account", "other"]),
    receiptEmail: z.string().trim().max(320).optional(),
  })
  .superRefine((value, context) => {
    if (value.receipt !== "other") return;
    if (!value.receiptEmail) context.addIssue({ code: "too_small", origin: "string", minimum: 1, path: ["receiptEmail"], input: value.receiptEmail, message: "required" });
    else if (!z.email().safeParse(value.receiptEmail).success) context.addIssue({ code: "custom", path: ["receiptEmail"], message: "invalid" });
  });

const stateOf = (status: RefundStatus): RefundState => (status === "succeeded" ? "succeeded" : status === "failed" || status === "canceled" ? "failed" : "pending");

interface WithdrawalRow {
  id: string;
  candidate_id: string;
  candidate_email?: string;
  contract: "plan" | "coaching_session";
  subject: PlanName;
  concluded_at: Date;
  withdrawn_at: Date;
  name: string;
  receipt_email: string;
  receipt_sent_at: Date | null;
}

interface RefundRow {
  id: string;
  withdrawal_id: string;
  amount: number;
  currency: string;
  status: RefundState;
  failure_reason: string | null;
  attempts: number;
  kept: number;
  stripe_payment_id: string | null;
  stripe_checkout_session_id: string | null;
}

const WITHDRAWAL_COLUMNS = "w.id, w.candidate_id, w.contract, w.subject, w.concluded_at, w.withdrawn_at, w.name, w.receipt_email, w.receipt_sent_at";
const REFUND_COLUMNS = "id, withdrawal_id, amount, currency, status, failure_reason, attempts, kept, stripe_payment_id, stripe_checkout_session_id";

const refundFrom = (row: RefundRow): WithdrawalRefund => ({
  id: row.id,
  amount: row.amount,
  currency: row.currency,
  status: row.status,
  kept: row.kept,
  failureReason: row.failure_reason,
  attempts: row.attempts,
});

/** The Withdrawals of `rows`, each with its refunds, oldest refund first. */
async function withRefunds(database: Pool, rows: WithdrawalRow[]): Promise<(Withdrawal & { candidateEmail?: string })[]> {
  const { rows: refunds } = await database.query<RefundRow>(`SELECT ${REFUND_COLUMNS} FROM withdrawal_refund WHERE withdrawal_id = ANY($1::uuid[]) ORDER BY created_at, id`, [
    rows.map((row) => row.id),
  ]);
  return rows.map((row) => ({
    id: row.id,
    contract: row.contract === "plan" ? "plan" : "coachingSession",
    subject: row.subject,
    concludedAt: row.concluded_at,
    withdrawnAt: row.withdrawn_at,
    name: row.name,
    receiptEmail: row.receipt_email,
    receiptSentAt: row.receipt_sent_at,
    refunds: refunds.filter((refund) => refund.withdrawal_id === row.id).map(refundFrom),
    ...(row.candidate_email === undefined ? {} : { candidateEmail: row.candidate_email }),
  }));
}

export function createWithdrawals(database: Pool, deps: WithdrawalsDeps): Withdrawals {
  const now = deps.now ?? (() => new Date());

  async function contracts(candidateId: string): Promise<WithdrawableContract[]> {
    const at = now();
    const [subscription, sessions, withdrawn] = await Promise.all([
      deps.billing.subscription(candidateId),
      deps.humanCoaches.sessions(candidateId),
      database.query<{ stripe_subscription_id: string }>("SELECT stripe_subscription_id FROM withdrawal WHERE candidate_id = $1 AND stripe_subscription_id IS NOT NULL", [candidateId]),
    ]);
    const found: WithdrawableContract[] = [];
    if (subscription && withdrawalOpen(subscription.startedAt, at) && !withdrawn.rows.some((row) => row.stripe_subscription_id === subscription.id)) {
      found.push({ ref: "plan", kind: "plan", subject: subscription.planName, concludedAt: subscription.startedAt, deadline: withdrawalDeadline(subscription.startedAt), paid: null });
    }
    for (const session of sessions) {
      if (!withdrawalOpen(session.paidAt, at)) continue;
      // Held: no longer withdrawable when bought with the Immediate Performance Request (L221-28 1°, #512).
      if (session.scheduledAt !== null && session.scheduledAt <= at && (await deps.orders.immediateExecutionRequested({ coachingSessionId: session.id }))) continue;
      found.push({
        ref: `coaching-session:${session.id}`,
        kind: "coachingSession",
        sessionId: session.id,
        subject: { fr: session.coach.name, en: session.coach.name },
        concludedAt: session.paidAt,
        deadline: withdrawalDeadline(session.paidAt),
        paid: { amount: session.amount, currency: session.currency },
      });
    }
    return found;
  }

  /** Asks Stripe for one refund: its payment found again first when only its Checkout Session is known. Records the answer. */
  async function attempt(refund: RefundRow): Promise<RefundState> {
    const attempts = refund.attempts + 1;
    let paymentId = refund.stripe_payment_id;
    let outcome: { status: RefundState; refundId: string | null; failureReason: string | null };
    try {
      if (!paymentId && refund.stripe_checkout_session_id) paymentId = (await deps.billing.coachingSessionPayment(refund.stripe_checkout_session_id))?.id ?? null;
      if (!paymentId) {
        outcome = { status: "failed", refundId: null, failureReason: "payment_not_found" };
      } else {
        const payment: Payment = { id: paymentId, amount: refund.amount, currency: refund.currency };
        // A new key per attempt: a retry is a new refund, never the failed one replayed.
        // Part of the payment when some is kept for the service provided (#512); in full otherwise.
        const result = await deps.billing.refund(
          payment,
          `withdrawal-refund-${refund.id}-${attempts}`,
          { withdrawal_id: refund.withdrawal_id, withdrawal_refund_id: refund.id },
          refund.kept > 0 ? refund.amount : undefined,
        );
        outcome = result.ok ? { status: stateOf(result.status), refundId: result.id, failureReason: null } : { status: "failed", refundId: null, failureReason: result.reason };
      }
    } catch (error) {
      console.error("[withdrawals] could not ask Stripe for a refund", error);
      outcome = { status: "failed", refundId: null, failureReason: "stripe_unavailable" };
    }
    await database.query(
      `UPDATE withdrawal_refund SET status = $2, failure_reason = $3, stripe_refund_id = COALESCE($4, stripe_refund_id), stripe_payment_id = COALESCE($5, stripe_payment_id),
              attempts = $6, updated_at = now()
        WHERE id = $1`,
      [refund.id, outcome.status, outcome.failureReason, outcome.refundId, paymentId, attempts],
    );
    return outcome.status;
  }

  async function one(id: string): Promise<Withdrawal> {
    const { rows } = await database.query<WithdrawalRow>(`SELECT ${WITHDRAWAL_COLUMNS} FROM withdrawal w WHERE w.id = $1`, [id]);
    const [withdrawal] = await withRefunds(database, rows);
    return withdrawal!;
  }

  return {
    contracts,

    async contract(candidateId, ref) {
      const found = (await contracts(candidateId)).find((contract) => contract.ref === ref);
      if (!found) return null;
      if (found.kind !== "plan") {
        return { ...found, refund: found.paid, immediateExecutionRequested: await deps.orders.immediateExecutionRequested({ coachingSessionId: found.sessionId }) };
      }
      const subscriptionId = (await deps.billing.subscription(candidateId))?.id;
      const immediateExecutionRequested = subscriptionId ? await deps.orders.immediateExecutionRequested({ subscriptionId }) : false;
      const payments = await deps.billing.paidOnSubscription(candidateId);
      if (!payments) return { ...found, paid: null, refund: null, immediateExecutionRequested };
      const currency = payments[0]?.currency ?? "eur";
      const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const refund = payments.reduce((sum, payment) => sum + withdrawalRefund(payment, now(), immediateExecutionRequested), 0);
      return { ...found, paid: { amount: paid, currency }, refund: { amount: refund, currency }, immediateExecutionRequested };
    },

    async withdraw(candidate, input, language) {
      const parsed = withdrawSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { name, receipt } = parsed.data;
      const receiptEmail = receipt === "other" ? parsed.data.receiptEmail!.toLowerCase() : candidate.email;
      const contract = (await contracts(candidate.id)).find((each) => each.ref === parsed.data.contract);
      if (!contract) return { ok: false, error: "not_withdrawable" };
      const withdrawnAt = now();

      // The Withdrawal first: a second click finds its contract taken and does nothing.
      const subscriptionId = contract.kind === "plan" ? (await deps.billing.subscription(candidate.id))?.id : undefined;
      if (contract.kind === "plan" && !subscriptionId) return { ok: false, error: "not_withdrawable" };
      const { rows } = await database.query<{ id: string }>(
        `INSERT INTO withdrawal (candidate_id, contract, subject, concluded_at, stripe_subscription_id, coaching_session_id, name, receipt_email, withdrawn_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          candidate.id,
          contract.kind === "plan" ? "plan" : "coaching_session",
          JSON.stringify(contract.subject),
          contract.concludedAt,
          subscriptionId ?? null,
          contract.kind === "coachingSession" ? contract.sessionId : null,
          name,
          receiptEmail,
          withdrawnAt,
        ],
      );
      const id = rows[0]?.id;
      if (!id) return { ok: false, error: "not_withdrawable" };
      const undo = () => database.query("DELETE FROM withdrawal WHERE id = $1", [id]);

      // The contract ends, and what it was paid with is to be refunded.
      let toRefund: { amount: number; kept: number; currency: string; paymentId: string | null; checkoutSessionId: string | null }[];
      let coachNotice: (() => Promise<void>) | null = null;
      if (contract.kind === "plan") {
        let payments: Payment[] | null;
        try {
          payments = await deps.billing.endSubscriptionNow(candidate.id);
        } catch (error) {
          console.error("[withdrawals] Stripe could not end a subscription", error);
          await undo();
          return { ok: false, error: "stripe_unavailable" };
        }
        if (payments === null) {
          await undo();
          return { ok: false, error: "not_withdrawable" };
        }
        const immediateExecutionRequested = await deps.orders.immediateExecutionRequested({ subscriptionId: subscriptionId! });
        toRefund = payments.flatMap((payment) => {
          const amount = withdrawalRefund(payment, withdrawnAt, immediateExecutionRequested);
          // Wholly provided: nothing of it to refund.
          return amount > 0 ? [{ amount, kept: payment.amount - amount, currency: payment.currency, paymentId: payment.id, checkoutSessionId: null }] : [];
        });
      } else {
        // Held, it is withdrawn only when bought without the Immediate Performance Request (#512).
        const evenIfHeld = !(await deps.orders.immediateExecutionRequested({ coachingSessionId: contract.sessionId }));
        const session = await deps.humanCoaches.withdrawSession(candidate.id, contract.sessionId, { evenIfHeld });
        if (!session) {
          await undo();
          return { ok: false, error: "not_withdrawable" };
        }
        toRefund = session.amount > 0 ? [{ amount: session.amount, kept: 0, currency: session.currency, paymentId: null, checkoutSessionId: session.checkoutSessionId }] : [];
        coachNotice = async () => {
          const email = withdrawnSessionEmail({ candidateName: session.candidateName, paidAt: session.paidAt, scheduledAt: session.scheduledAt, held: session.held });
          await deps.mailer.send({ to: session.coach.email, ...email });
        };
      }

      for (const each of toRefund) {
        const { rows: inserted } = await database.query<RefundRow>(
          `INSERT INTO withdrawal_refund (withdrawal_id, amount, kept, currency, stripe_payment_id, stripe_checkout_session_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING ${REFUND_COLUMNS}`,
          [id, each.amount, each.kept, each.currency.toLowerCase(), each.paymentId, each.checkoutSessionId],
        );
        await attempt(inserted[0]!);
      }

      // Told whatever happened to the refund: the acknowledgement is due once the Withdrawal is received.
      const recorded = await one(id);
      const refunded = recorded.refunds.reduce((sum, refund) => sum + refund.amount, 0);
      const kept = recorded.refunds.reduce((sum, refund) => sum + refund.kept, 0);
      const email = withdrawalReceiptEmail(
        {
          contract: recorded.contract,
          subject: recorded.subject[language],
          concludedAt: recorded.concludedAt,
          paid: contract.paid ?? (refunded > 0 ? { amount: refunded, currency: recorded.refunds[0]!.currency } : null),
          withdrawnAt,
          name,
          refunded: refunded > 0 ? { amount: refunded, currency: recorded.refunds[0]!.currency } : null,
          kept: kept > 0 ? { amount: kept, currency: recorded.refunds[0]!.currency } : null,
        },
        language,
      );
      try {
        await deps.mailer.send({ to: receiptEmail, ...email });
        await database.query("UPDATE withdrawal SET receipt_sent_at = $2 WHERE id = $1", [id, now()]);
      } catch (error) {
        console.error("[withdrawals] could not send a withdrawal's acknowledgement", error);
      }
      try {
        await coachNotice?.();
      } catch (error) {
        console.error("[withdrawals] could not tell a Human Coach of a withdrawn Coaching Session", error);
      }
      return { ok: true, withdrawal: await one(id) };
    },

    async withdrawal(candidateId, id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<WithdrawalRow>(`SELECT ${WITHDRAWAL_COLUMNS} FROM withdrawal w WHERE w.id = $1 AND w.candidate_id = $2`, [id, candidateId]);
      return (await withRefunds(database, rows))[0] ?? null;
    },

    async list() {
      const { rows } = await database.query<WithdrawalRow>(
        `SELECT ${WITHDRAWAL_COLUMNS}, c.email AS candidate_email FROM withdrawal w JOIN candidate c ON c.id = w.candidate_id ORDER BY w.withdrawn_at DESC, w.id`,
      );
      return (await withRefunds(database, rows)) as ListedWithdrawal[];
    },

    async retryRefund(refundId) {
      if (!UUID.test(refundId)) return { ok: false, error: "not_found" };
      // Taken from `failed` to `pending` first: two retries at once ask Stripe once.
      const { rows } = await database.query<RefundRow>(
        `UPDATE withdrawal_refund r SET status = 'pending', updated_at = now()
           FROM (SELECT id, status FROM withdrawal_refund WHERE id = $1 FOR UPDATE) before
          WHERE r.id = before.id AND before.status = 'failed'
          RETURNING ${REFUND_COLUMNS.split(", ").map((column) => `r.${column}`).join(", ")}`,
        [refundId],
      );
      if (!rows[0]) {
        const { rows: exists } = await database.query("SELECT 1 FROM withdrawal_refund WHERE id = $1", [refundId]);
        return { ok: false, error: exists.length > 0 ? "not_failed" : "not_found" };
      }
      return { ok: true, status: await attempt(rows[0]) };
    },

    async refundChanged({ id, status, failureReason }) {
      const state = stateOf(status);
      await database.query(
        `UPDATE withdrawal_refund SET status = $2, failure_reason = $3, updated_at = now()
          WHERE stripe_refund_id = $1 AND status <> 'failed'`,
        [id, state, state === "failed" ? (failureReason ?? "unknown") : null],
      );
    },
  };
}

/** A Withdrawal as the Data export holds it: no Stripe identifiers, no internal ids. */
export interface ExportedWithdrawal {
  contract: "plan" | "coachingSession";
  subject: PlanName;
  concludedAt: Date;
  withdrawnAt: Date;
  name: string;
  receiptEmail: string;
  receiptSentAt: Date | null;
  refunds: { amount: number; currency: string; status: RefundState }[];
}

/** The Candidate's Withdrawals, newest first, for their Data export. */
export async function withdrawalsOf(database: Pool, candidateId: string): Promise<ExportedWithdrawal[]> {
  const { rows } = await database.query<WithdrawalRow>(`SELECT ${WITHDRAWAL_COLUMNS} FROM withdrawal w WHERE w.candidate_id = $1 ORDER BY w.withdrawn_at DESC, w.id`, [candidateId]);
  return (await withRefunds(database, rows)).map((withdrawal) => ({
    contract: withdrawal.contract,
    subject: withdrawal.subject,
    concludedAt: withdrawal.concludedAt,
    withdrawnAt: withdrawal.withdrawnAt,
    name: withdrawal.name,
    receiptEmail: withdrawal.receiptEmail,
    receiptSentAt: withdrawal.receiptSentAt,
    refunds: withdrawal.refunds.map(({ amount, currency, status }) => ({ amount, currency, status })),
  }));
}

/** Creates or upgrades the Withdrawal tables. Run after the billing and Human Coach tables. Safe to run repeatedly. */
export async function migrateWithdrawals(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS withdrawal (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      contract text NOT NULL CHECK (contract IN ('plan', 'coaching_session')),
      -- The Plan's name, or the Human Coach's, in each Interface Language, as it was.
      subject jsonb NOT NULL,
      concluded_at timestamptz NOT NULL,
      -- One Withdrawal per contract: a double click records one.
      stripe_subscription_id text UNIQUE,
      coaching_session_id uuid UNIQUE REFERENCES coaching_session (id) ON DELETE CASCADE,
      name text NOT NULL,
      receipt_email text NOT NULL,
      withdrawn_at timestamptz NOT NULL,
      receipt_sent_at timestamptz,
      CHECK ((contract = 'plan') = (stripe_subscription_id IS NOT NULL)),
      CHECK ((contract = 'coaching_session') = (coaching_session_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS withdrawal_candidate_id_idx ON withdrawal (candidate_id);
    CREATE TABLE IF NOT EXISTS withdrawal_refund (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      withdrawal_id uuid NOT NULL REFERENCES withdrawal (id) ON DELETE CASCADE,
      amount integer NOT NULL CHECK (amount > 0),
      currency text NOT NULL,
      -- What it refunds: the payment, or the Checkout Session it is found from (a Coaching Session's).
      stripe_payment_id text,
      stripe_checkout_session_id text,
      stripe_refund_id text UNIQUE,
      status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
      -- What was kept of the payment for the service already provided (#512): the refund is then partial.
      kept integer NOT NULL DEFAULT 0 CHECK (kept >= 0),
      failure_reason text,
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS withdrawal_refund_withdrawal_id_idx ON withdrawal_refund (withdrawal_id);
    ALTER TABLE withdrawal_refund ADD COLUMN IF NOT EXISTS kept integer NOT NULL DEFAULT 0 CHECK (kept >= 0);
  `);
}
