/** Stripe Connect accounts and a private, immutable payment context. Public Sale snapshots never contain payment credentials. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import type { CoachingSale } from "@jobhub/shared/coaching-offers";
import type { PaidCoachingSession } from "../billing";
import { ConnectOperationNotCreated, type ConnectPort, type CheckoutRequest, type ConnectCheckout } from "./port";
import { commissionAmount, proportionalAmount, monthlyEarnings, type Earning } from "./earnings";
export type { ConnectPort } from "./port";
export interface ConnectDeps {
  stripe?: ConnectPort;
  /** Human-reviewed rollout prerequisites. Missing checks always close the gate. */
  permitted?(): Promise<boolean>;
  /** Current version acceptance by the authorized business owner, beyond the initial approval flag. */
  maySell?(seller: ConnectSeller): Promise<boolean>;
  now?: () => Date;
  baseURL: string;
  /** Session, validated Sale and ledger are committed together by the existing paid-session seam. */
  recordPaid?(paid: PaidCoachingSession, financials: (within: Queryable) => Promise<void>): Promise<boolean>;
  attachSale?(paid: PaidCoachingSession, within: Queryable): Promise<void>;
  confirmOrder?(paid: {
    checkoutSessionId: string;
    candidateId: string;
    mode: "payment";
    subscriptionId: null;
    amount: number;
    currency: string;
  }): Promise<unknown>;
  sendPayoutNotice?(notice: { sellerId: string; batchId: string; amount: number; currency: string; paidAt: Date }): Promise<void>;
}
export interface ConnectSeller {
  id: string;
  kind: "human_coach" | "association";
  name: string;
  status:string;
  siret:string;
  email: string;
  accountId: string | null;
}
interface Context {
  id: string;
  quoteId: string | null;
  candidateId: string | null;
  coachId: string;
  recipientId: string;
  accountId: string | null;
  amount: number;
  currency: string;
  commission: number;
  payeeAmount: number;
  request: CheckoutRequest;
  sale: CoachingSale;
  createdAt: Date;
  checkoutId: string | null;
  paymentIntent: string | null;
  paidAt: Date | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT = `id,quote_id AS "quoteId",candidate_id AS "candidateId",coach_id AS "coachId",recipient_id AS "recipientId",account_id AS "accountId",amount,currency,commission,payee_amount AS "payeeAmount",request,sale_snapshot AS sale,created_at AS "createdAt",checkout_id AS "checkoutId",payment_intent AS "paymentIntent",paid_at AS "paidAt"`;
export function coachingConnect(database: Pool, deps: ConnectDeps) {
  const now = deps.now ?? (() => new Date());
  const stripe = () => {
    if (!deps.stripe) throw new Error("Connect unavailable");
    return deps.stripe;
  };
  const allowed = async () => !!deps.stripe && (await deps.permitted?.()) === true;
  async function seller(id: string, within: Queryable = database, activeOnly = true): Promise<ConnectSeller | null> {
    if (!UUID.test(id)) return null;
    return (
      (
        await within.query<ConnectSeller>(
          `SELECT s.id,s.kind,s.name,s.status,s.siret,coalesce(h.email,(SELECT c.email FROM coach_association_manager m JOIN candidate c ON c.id=m.candidate_id AND c."emailVerified" WHERE m.association_id=a.id ORDER BY c.id LIMIT 1)) AS email,k.account_id AS "accountId" FROM coaching_seller s LEFT JOIN human_coach h ON h.id=s.coach_id AND (NOT $2::boolean OR h.retired_at IS NULL) LEFT JOIN coach_association a ON a.id=s.association_id AND (NOT $2::boolean OR a.retired_at IS NULL) LEFT JOIN coaching_connect_account k ON k.seller_id=s.id WHERE s.id=$1 AND s.siret ~ '^[0-9]{14}$' AND ((s.kind='human_coach' AND h.id IS NOT NULL AND (NOT $2::boolean OR NOT h.contract_pending)) OR (s.kind='association' AND a.id IS NOT NULL AND (NOT $2::boolean OR NOT a.contract_pending)))`,
          [id, activeOnly],
        )
      ).rows[0] ?? null
    );
  }
  async function active(id: string, financial = false) {
    const found = await seller(id, database, !financial);
    if (!found?.accountId || (!financial && (await deps.maySell?.(found)) !== true)) return null;
    try {
      const status = await stripe().status(found.accountId);
      return (financial ? (status.canReceivePayouts ?? status.active) : status.active) ? found : null;
    } catch {
      return null;
    }
  }
  async function owns(sellerId: string, actorId: string) {
    return !!(
      await database.query(
        `SELECT 1 FROM coaching_seller s JOIN candidate c ON c.id=$2 AND c."emailVerified" LEFT JOIN coaching_connect_account k ON k.seller_id=s.id LEFT JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL LEFT JOIN coach_association a ON a.id=s.association_id AND a.retired_at IS NULL WHERE s.id=$1 AND ((s.kind='human_coach' AND h.id IS NOT NULL AND (k.owner_id=c.id OR (k.seller_id IS NULL AND h.email=lower(c.email)))) OR (s.kind='association' AND a.id IS NOT NULL AND EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=a.id AND m.candidate_id=c.id)))`,
        [sellerId, actorId],
      )
    ).rowCount;
  }
  async function platformRecipient(coachId: string) {
    return (
      (
        await database.query<{ id: string; share: number | null }>(
          `SELECT s.id,o.coach_share_bps AS share FROM coaching_seller s JOIN coaching_offer o ON o.payout_seller_id=s.id JOIN human_coach h ON h.id=o.coach_id AND h.retired_at IS NULL WHERE o.coach_id=$1 AND ((s.kind='human_coach' AND s.coach_id=o.coach_id) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_coach m WHERE m.association_id=s.association_id AND m.coach_id=o.coach_id AND m.removed_at IS NULL)))`,
          [coachId],
        )
      ).rows[0] ?? null
    );
  }
  async function context(id: string) {
    return UUID.test(id) ? ((await database.query<Context>(`SELECT ${CONTEXT} FROM coaching_connect_payment WHERE id=$1`, [id])).rows[0] ?? null) : null;
  }
  async function bind(row: Context, checkout: ConnectCheckout) {
    if (checkout.contextId !== row.id || checkout.amount !== row.amount || checkout.currency !== row.currency)
      throw new Error("Connect Checkout does not match context");
    const bound = await database.query(`UPDATE coaching_connect_payment SET checkout_id=$2 WHERE id=$1 AND (checkout_id IS NULL OR checkout_id=$2)`, [
      row.id,
      checkout.id,
    ]);
    if (!bound.rowCount) throw new Error("Connect Checkout binding conflict");
    return checkout;
  }
  async function recover(row: Context) {
    if (row.checkoutId) {
      const existing = await stripe().readCheckout(row.checkoutId, row.accountId);
      if (!existing) throw new Error("Bound Checkout requires reconciliation");
      return existing;
    }
    // Stripe only guarantees idempotency keys for 24 hours. Later unknown outcomes require reconciliation, never another charge.
    if (now().getTime() - row.createdAt.getTime() > 23 * 3600000) throw new Error("Connect Checkout requires reconciliation");
    return bind(row, await stripe().checkout(row.request, `coaching-checkout:${row.id}`));
  }
  return {
    seller,
    async eligible(sellerId: string) {
      return (await allowed()) && !!(await active(sellerId));
    },
    async eligiblePlatformOffer(coachId: string) {
      if (!(await allowed()) || !UUID.test(coachId)) return false;
      const recipient = await platformRecipient(coachId);
      return !!recipient && recipient.share !== null && !!(await active(recipient.id));
    },
    async onboarding(sellerId: string, returnPath: string, actorId: string) {
      if (!(await allowed()) || !(await owns(sellerId, actorId))) return null;
      const found = await seller(sellerId);
      if (!found?.email || (await deps.maySell?.(found)) !== true) return null;
      let accountId = found.accountId;
      if (!accountId) {
        // Stable per-business identity key: concurrent owners and retries never create another Express account.
        const created = await stripe().account(found, `coach-account:${found.id}`);
        const result = await database.query<{ accountId: string }>(
          `INSERT INTO coaching_connect_account(seller_id,account_id,created_at,owner_id) VALUES($1,$2,$3,$4) ON CONFLICT(seller_id) DO UPDATE SET seller_id=EXCLUDED.seller_id RETURNING account_id AS "accountId"`,
          [sellerId, created.id, now(), actorId],
        );
        accountId = result.rows[0]!.accountId;
      }
      const destination = new URL(returnPath, deps.baseURL);
      if (destination.origin !== new URL(deps.baseURL).origin) throw new Error("Invalid Connect return origin");
      return stripe().onboarding(accountId, destination.toString(), destination.toString());
    },
    async dashboard(sellerId: string, actorId: string) {
      if (!(await allowed()) || !(await owns(sellerId, actorId))) return null;
      const found = await seller(sellerId);
      return found?.accountId ? stripe().dashboard(found.accountId) : null;
    },
    async startCheckout(candidate: { id: string; email: string }, quoteId: string, locale: "fr" | "en", urls: { success: string; cancel: string }) {
      if (!(await allowed()) || !UUID.test(quoteId)) return null;
      const quote = (
        await database.query<{ snapshot: CoachingSale }>("SELECT snapshot FROM coaching_offer_quote WHERE id=$1 AND candidate_id=$2", [quoteId, candidate.id])
      ).rows[0];
      if (!quote) return null;
      const snapshot = quote.snapshot;
      const platform = snapshot.seller.kind === "jobbbox";
      // Jobbbox compensation is an explicit Administrator agreement, never guessed from its retail price.
      const recipient = platform ? await platformRecipient(snapshot.coachId) : { id: snapshot.seller.id, share: 10000 - snapshot.commissionBps };
      if (!recipient || recipient.share === null) return null;
      const payee = await active(recipient.id);
      if (!payee?.accountId) return null;
      const commission = platform ? 0 : commissionAmount(snapshot.amount, snapshot.commissionBps),
        payeeAmount = platform ? commissionAmount(snapshot.amount, recipient.share) : snapshot.amount - commission;
      const id = randomUUID();
      const request: CheckoutRequest = {
        contextId: id,
        accountId: platform ? null : payee.accountId,
        amount: snapshot.amount,
        currency: snapshot.currency,
        commission,
        title: `Coaching · ${snapshot.durationMinutes} min`,
        email: candidate.email,
        locale,
        successUrl: urls.success,
        cancelUrl: urls.cancel,
      };
      await database.query(
        `INSERT INTO coaching_connect_payment(id,quote_id,candidate_id,coach_id,recipient_id,account_id,amount,currency,commission,payee_amount,request,created_at,sale_snapshot,payee_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(quote_id) DO NOTHING`,
        [
          id,
          quoteId,
          candidate.id,
          snapshot.coachId,
          payee.id,
          request.accountId,
          snapshot.amount,
          snapshot.currency,
          commission,
          payeeAmount,
          request,
          now(),
          snapshot,
          {id:payee.id,kind:payee.kind,name:payee.name,status:payee.status,siret:payee.siret},
        ],
      );
      const row = (await database.query<Context>(`SELECT ${CONTEXT} FROM coaching_connect_payment WHERE quote_id=$1`, [quoteId])).rows[0]!;
      // A repeated call may not move an existing payment to a new Seller/account or change its amount.
      const result = await recover(row);
      if (!result.url) throw new Error("Connect Checkout missing URL");
      return { url: result.url, checkoutSessionId: result.id };
    },
    async paid(session: ConnectCheckout, eventAccount: string | null) {
      const { recordPaid, attachSale, confirmOrder } = deps;
      if (!recordPaid || !attachSale || !confirmOrder) throw new Error("Connect payment writer unavailable in this process");
      if (!session.contextId) return false;
      const row = await context(session.contextId);
      if (!row || !row.candidateId || !row.quoteId || row.accountId !== eventAccount) return false;
      if (row.checkoutId && row.checkoutId !== session.id) return false;
      // A signed paid event provides the resource id even after the create idempotency window.
      // Recover only by reading/binding that resource in the frozen account; never create another Checkout here.
      const paid = await stripe().readCheckout(session.id, eventAccount);
      if (
        !paid ||
        paid.id !== session.id ||
        !paid.paid ||
        paid.contextId !== row.id ||
        paid.amount !== row.amount ||
        paid.currency !== row.currency ||
        !paid.paymentIntent
      )
        return false;
      await bind(row, paid);
      const input = {
        checkoutSessionId: paid.id,
        candidateId: row.candidateId,
        coachId: row.coachId,
        quoteId: row.quoteId,
        amount: row.amount,
        currency: row.currency,
      };
      const recorded = await recordPaid(input, async (within) => {
        await attachSale(input, within);
        await within.query(`UPDATE coaching_connect_payment SET payment_intent=$2,paid_at=coalesce(paid_at,$3) WHERE id=$1`, [
          row.id,
          paid.paymentIntent,
          now(),
        ]);
        await within.query(`INSERT INTO coaching_connect_earning(payment_id,amount,commission) VALUES($1,$2,$3) ON CONFLICT(payment_id) DO NOTHING`, [
          row.id,
          row.payeeAmount + row.commission,
          row.commission,
        ]);
      });
      if (recorded) await confirmOrder({ ...input, mode: "payment", subscriptionId: null });
      return recorded;
    },
    async contextForCheckout(checkoutId: string) {
      return (
        (
          await database.query<{ accountId: string | null; paymentIntent: string | null }>(
            `SELECT account_id AS "accountId",payment_intent AS "paymentIntent" FROM coaching_connect_payment WHERE checkout_id=$1 AND paid_at IS NOT NULL`,
            [checkoutId],
          )
        ).rows[0] ?? null
      );
    },
    async reconcile(sellerId: string) {
      return inTransaction(database, async (within) => {
        // Lock before asking Stripe: two workers cannot write an older refund read over a newer one.
        await within.query(
          `SELECT e.payment_id FROM coaching_connect_earning e JOIN coaching_connect_payment p ON p.id=e.payment_id WHERE p.recipient_id=$1 ORDER BY e.payment_id FOR UPDATE OF e`,
          [sellerId],
        );
        const rows = (
          await within.query<Context>(`SELECT ${CONTEXT} FROM coaching_connect_payment WHERE recipient_id=$1 AND paid_at IS NOT NULL ORDER BY paid_at,id`, [
            sellerId,
          ])
        ).rows;
        for (const row of rows) {
          if (!row.paymentIntent) continue;
          const actual = await stripe().payment(row.paymentIntent, row.accountId);
          if (actual.amount !== row.amount) throw new Error("Connect balance amount mismatch");
          const platform = row.accountId === null;
          const refunded = platform ? proportionalAmount(row.payeeAmount, actual.refunded, row.amount) : actual.refunded;
          const refundedCommission = platform ? 0 : actual.refundedCommission,
            processingFees = platform ? 0 : actual.processingFees;
          const remainingNet = Math.max(0, row.payeeAmount - refunded + refundedCommission - processingFees);
          // Zero dispute debit is not proof that the original payment/balance has settled.
          const settlementHold = (actual.settled ?? actual.available) ? 0 : remainingNet;
          const disputeHold =
            actual.held !== undefined ? (platform ? proportionalAmount(row.payeeAmount, Math.min(row.amount, actual.held), row.amount) : actual.held) : 0;
          await within.query(
            `UPDATE coaching_connect_earning SET refunded=$2,refunded_commission=$3,processing_fees=$4,available=$5,checked_at=$6,held=$7 WHERE payment_id=$1`,
            [
              row.id,
              refunded,
              platform ? 0 : actual.refundedCommission,
              platform ? 0 : actual.processingFees,
              actual.available,
              now(),
              settlementHold + disputeHold,
            ],
          );
        }
      });
    },
    async runMonthly() {
      if (!(await allowed())) return { started: 0, paid: 0 };
      let started = 0,
        paid = 0;
      const recipients = (
        await database.query<{ id: string }>(`SELECT DISTINCT recipient_id AS id FROM coaching_connect_payment WHERE paid_at IS NOT NULL ORDER BY recipient_id`)
      ).rows;
      for (const recipient of recipients) {
        try {
          const payee = await active(recipient.id, true);
          if (!payee?.accountId) continue;
          await this.reconcile(recipient.id);
          await inTransaction(database, async (within) => {
            await within.query("SELECT seller_id FROM coaching_connect_account WHERE seller_id=$1 FOR UPDATE", [recipient.id]);
            if ((await within.query("SELECT 1 FROM coaching_connect_batch WHERE seller_id=$1 AND state='needs_review' LIMIT 1", [recipient.id])).rowCount)
              return;
            const entries = (
              await within.query<Earning & { platform: boolean; currency: string }>(
                `SELECT p.id,p.paid_at AS "paidAt",p.currency,(p.account_id IS NULL) AS platform,e.amount,e.commission,e.refunded,e.refunded_commission AS "refundedCommission",e.processing_fees AS "processingFees",e.allocated,e.held FROM coaching_connect_payment p JOIN coaching_connect_earning e ON e.payment_id=p.id WHERE p.recipient_id=$1 FOR UPDATE OF e`,
                [recipient.id],
              )
            ).rows;
            const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(now());
            for (const currency of [...new Set(entries.map((e) => e.currency))]) {
              const group = entries.filter((e) => e.currency === currency),
                result = monthlyEarnings(group, now());
              // A zero/negative balance remains unallocated and offsets later months.
              if (!result.payout) continue;
              const transfer = result.eligible.reduce((sum, line) => sum + (group.find((e) => e.id === line.id)!.platform ? line.due : 0), 0);
              const id = randomUUID(),
                created = await within.query(
                  `INSERT INTO coaching_connect_batch(id,seller_id,month,currency,amount,transfer_amount,account_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(seller_id,month,currency) WHERE state<>'cancelled' DO NOTHING RETURNING id`,
                  [id, recipient.id, month, currency, result.payout, transfer, payee.accountId, now()],
                );
              if (!created.rowCount) continue;
              for (const line of result.eligible.filter((e) => e.due !== 0)) {
                await within.query("INSERT INTO coaching_connect_allocation(batch_id,payment_id,amount) VALUES($1,$2,$3)", [id, line.id, line.due]);
                await within.query("UPDATE coaching_connect_earning SET allocated=allocated+$2 WHERE payment_id=$1", [line.id, line.due]);
              }
              started++;
            }
          });
        } catch {
          /* One unavailable account must not starve the other Sellers. Reconciliation is retried next run. */
        }
      }
      // A per-batch advisory lock covers Stripe calls, including concurrent worker restarts.
      const batches = (
        await database.query<{ id: string }>(
          "SELECT id FROM coaching_connect_batch WHERE state IN ('pending','cancelling','needs_review') AND (retry_at IS NULL OR retry_at<=$1) ORDER BY created_at,id",
          [now()],
        )
      ).rows;
      for (const batch of batches) {
        const client = await database.connect();
        let locked = false,
          phase: "transfer" | "payout" | null = null;
        try {
          locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,878)) AS locked", [batch.id])).rows[0]!.locked;
          if (!locked) continue;
          const row = (
            await client.query<{
              id: string;
              sellerId: string;
              accountId: string;
              amount: number;
              transferAmount: number;
              currency: string;
              createdAt: Date;
              transferId: string | null;
              payoutId: string | null;
              state: string;
              payoutOutcome: string;
              transferOutcome: string;
              cancelTransferId: string | null;
              cancelStartedAt: Date | null;
              payoutAttempt: number;
              payoutAttemptedAt: Date | null;
            }>(
              `SELECT id,seller_id AS "sellerId",account_id AS "accountId",amount,transfer_amount AS "transferAmount",currency,created_at AS "createdAt",transfer_id AS "transferId",payout_id AS "payoutId",state,payout_outcome AS "payoutOutcome",transfer_outcome AS "transferOutcome",cancel_transfer_id AS "cancelTransferId",cancel_started_at AS "cancelStartedAt",payout_attempt AS "payoutAttempt",payout_attempted_at AS "payoutAttemptedAt" FROM coaching_connect_batch WHERE id=$1`,
              [batch.id],
            )
          ).rows[0]!;
          if (!["pending", "cancelling", "needs_review"].includes(row.state)) continue;
          const request = { batchId: row.id, accountId: row.accountId, amount: row.amount, currency: row.currency, createdAt: row.createdAt };
          // Discovery MUST NOT create an old payout while refunds are being revalidated.
          let payout = row.payoutId ? { id: row.payoutId, state: await stripe().payoutState(row.accountId, row.payoutId) } : await stripe().findPayout(request);
          if (!payout) {
            await this.reconcile(row.sellerId);
            const allocations = (
              await client.query<Earning & { ownAllocation: number }>(
                `SELECT p.id,p.paid_at AS "paidAt",e.amount,e.commission,e.refunded,e.refunded_commission AS "refundedCommission",e.processing_fees AS "processingFees",e.held,e.allocated,a.amount AS "ownAllocation" FROM coaching_connect_allocation a JOIN coaching_connect_earning e ON e.payment_id=a.payment_id JOIN coaching_connect_payment p ON p.id=e.payment_id WHERE a.batch_id=$1`,
                [row.id],
              )
            ).rows;
            const liability = monthlyEarnings(
              allocations.map((entry) => ({ ...entry, allocated: entry.allocated - entry.ownAllocation })),
              now(),
            ).due;
            if (row.state === "cancelling" || liability < row.amount || row.transferOutcome === "not_created") {
              const transfer = row.transferAmount ? await stripe().findTransfer({ ...request, amount: row.transferAmount }) : null;
              const payoutUncertain = row.payoutOutcome === "unknown";
              const transferUncertain = row.transferAmount && row.transferOutcome === "unknown" && (!transfer || !transfer.complete);
              if (payoutUncertain || transferUncertain) {
                await client.query("UPDATE coaching_connect_batch SET state='needs_review' WHERE id=$1", [row.id]);
                continue;
              }
              await client.query("UPDATE coaching_connect_batch SET state='cancelling',cancel_started_at=coalesce(cancel_started_at,$2) WHERE id=$1", [
                row.id,
                now(),
              ]);
              if (transfer && !row.cancelTransferId) {
                const reversed = await stripe().transfer({
                  ...request,
                  batchId: `cancel:${row.id}`,
                  amount: -transfer.amount,
                  createdAt: row.cancelStartedAt ?? now(),
                });
                await client.query("UPDATE coaching_connect_batch SET cancel_transfer_id=$2 WHERE id=$1", [row.id, reversed]);
              }
              await inTransaction(database, async (within) => {
                await within.query("SELECT seller_id FROM coaching_connect_account WHERE seller_id=$1 FOR UPDATE", [row.sellerId]);
                if ((await within.query("SELECT 1 FROM coaching_connect_batch WHERE id=$1 AND state='cancelled'", [row.id])).rowCount) return;
                await within.query(
                  "UPDATE coaching_connect_earning e SET allocated=e.allocated-a.amount FROM coaching_connect_allocation a WHERE a.payment_id=e.payment_id AND a.batch_id=$1",
                  [row.id],
                );
                await within.query("UPDATE coaching_connect_batch SET state='cancelled' WHERE id=$1", [row.id]);
              });
              continue;
            }
            if (row.state === "needs_review") continue;
            if (
              (await client.query("SELECT 1 FROM coaching_connect_batch WHERE seller_id=$1 AND state='needs_review' AND id<>$2", [row.sellerId, row.id]))
                .rowCount
            )
              continue;
            if (!(await active(row.sellerId, true))) continue;
            if (row.transferAmount && !row.transferId) {
              phase = "transfer";
              await client.query("UPDATE coaching_connect_batch SET transfer_outcome='unknown' WHERE id=$1", [row.id]);
              const transferId = await stripe().transfer({ ...request, amount: row.transferAmount });
              await client.query("UPDATE coaching_connect_batch SET transfer_id=$2,transfer_outcome='created' WHERE id=$1", [row.id, transferId]);
              phase = null;
            }
            const attempt = row.payoutAttempt + (row.payoutOutcome === "not_created" ? 1 : 0),
              attemptedAt = row.payoutOutcome === "unknown" ? (row.payoutAttemptedAt ?? row.createdAt) : now();
            phase = "payout";
            await client.query("UPDATE coaching_connect_batch SET payout_outcome='unknown',payout_attempt=$2,payout_attempted_at=$3 WHERE id=$1", [
              row.id,
              attempt,
              attemptedAt,
            ]);
            payout = await stripe().payout({ ...request, attempt, attemptedAt });
            phase = null;
          }
          await client.query("UPDATE coaching_connect_batch SET payout_id=$2,payout_outcome='created',state='pending' WHERE id=$1", [row.id, payout.id]);
          if (payout.state === "paid") {
            await client.query("UPDATE coaching_connect_batch SET state='paid',paid_at=$2 WHERE id=$1", [row.id, now()]);
            paid++;
          }
          // Failed bank payouts leave the allocated money visible for Support reconciliation. Never manufacture a second transfer/payout.
          if (payout.state === "failed") await client.query("UPDATE coaching_connect_batch SET state='failed' WHERE id=$1", [row.id]);
        } catch (error) {
          if (error instanceof ConnectOperationNotCreated && phase)
            await client.query(
              phase === "payout"
                ? "UPDATE coaching_connect_batch SET payout_outcome='not_created' WHERE id=$1"
                : "UPDATE coaching_connect_batch SET transfer_outcome='not_created' WHERE id=$1",
              [batch.id],
            );
          await client.query("UPDATE coaching_connect_batch SET retry_at=$2::timestamptz+interval '5 minutes' WHERE id=$1", [batch.id, now()]);
        } finally {
          if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,878))", [batch.id]);
          client.release();
        }
      }
      if (deps.sendPayoutNotice) {
        for (let attempt = 0; attempt < 25; attempt++) {
          const notice = (
            await database.query<{ sellerId: string; batchId: string; amount: number; currency: string; paidAt: Date; claim: string }>(
              `UPDATE coaching_connect_batch b SET notice_claim=gen_random_uuid(),notice_claimed_at=$1 WHERE b.id=(SELECT id FROM coaching_connect_batch WHERE state='paid' AND notice_sent_at IS NULL AND (notice_retry_at IS NULL OR notice_retry_at<=$1) AND (notice_claimed_at IS NULL OR notice_claimed_at<$1::timestamptz-interval '5 minutes') ORDER BY paid_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING seller_id AS "sellerId",id AS "batchId",amount,currency,paid_at AS "paidAt",notice_claim AS claim`,
              [now()],
            )
          ).rows[0];
          if (!notice) break;
          try {
            await deps.sendPayoutNotice(notice);
            await database.query(
              "UPDATE coaching_connect_batch SET notice_sent_at=$3,notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$2",
              [notice.batchId, notice.claim, now()],
            );
          } catch {
            await database.query(
              "UPDATE coaching_connect_batch SET notice_retry_at=$3::timestamptz+interval '5 minutes',notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$2",
              [notice.batchId, notice.claim, now()],
            );
          }
        }
      }
      return { started, paid };
    },
    async purge() {
      return inTransaction(database, async (within) => {
        const unpaid = await within.query("DELETE FROM coaching_connect_payment WHERE paid_at IS NULL AND created_at<$1::timestamptz-interval '7 days'", [
          now(),
        ]);
        const expired = (
          await within.query<{ id: string }>(
            `SELECT p.id FROM coaching_connect_payment p WHERE p.paid_at<$1::timestamptz-interval '10 years' AND NOT EXISTS(SELECT 1 FROM coaching_connect_allocation a JOIN coaching_connect_batch b ON b.id=a.batch_id WHERE a.payment_id=p.id AND b.state NOT IN ('paid','cancelled')) FOR UPDATE`,
            [now()],
          )
        ).rows.map((row) => row.id);
        await within.query("DELETE FROM coaching_connect_allocation WHERE payment_id=ANY($1::uuid[])", [expired]);
        const paid = await within.query("DELETE FROM coaching_connect_payment WHERE id=ANY($1::uuid[])", [expired]);
        await within.query(
          "DELETE FROM coaching_connect_batch b WHERE b.created_at<$1::timestamptz-interval '10 years' AND b.state IN ('paid','cancelled') AND NOT EXISTS(SELECT 1 FROM coaching_connect_allocation a WHERE a.batch_id=b.id)",
          [now()],
        );
        return (unpaid.rowCount ?? 0) + (paid.rowCount ?? 0);
      });
    },
    async earnings(sellerId: string) {
      return (
        await database.query<Earning>(
          `SELECT p.id,p.paid_at AS "paidAt",e.amount,e.commission,e.refunded,e.refunded_commission AS "refundedCommission",e.processing_fees AS "processingFees",e.allocated,e.held FROM coaching_connect_payment p JOIN coaching_connect_earning e ON e.payment_id=p.id WHERE p.recipient_id=$1 ORDER BY p.paid_at,p.id`,
          [sellerId],
        )
      ).rows;
    },
  };
}
export async function migrateCoachingConnect(database: Pool) {
  await database.query(`ALTER TABLE coaching_offer ADD COLUMN IF NOT EXISTS coach_share_bps integer CHECK(coach_share_bps BETWEEN 0 AND 10000);
 CREATE TABLE IF NOT EXISTS coaching_connect_account(seller_id uuid PRIMARY KEY REFERENCES coaching_seller(id),account_id text UNIQUE NOT NULL,created_at timestamptz NOT NULL,owner_id text REFERENCES candidate(id) ON DELETE SET NULL);
 CREATE TABLE IF NOT EXISTS coaching_connect_payment(id uuid PRIMARY KEY,quote_id uuid UNIQUE REFERENCES coaching_offer_quote(id) ON DELETE SET NULL,candidate_id text REFERENCES candidate(id) ON DELETE SET NULL,coach_id uuid NOT NULL REFERENCES human_coach(id),recipient_id uuid NOT NULL REFERENCES coaching_seller(id),account_id text,amount integer NOT NULL,currency text NOT NULL,commission integer NOT NULL,payee_amount integer NOT NULL,request jsonb NOT NULL,sale_snapshot jsonb NOT NULL,payee_snapshot jsonb,service_archived boolean NOT NULL DEFAULT false,service_held_month text,created_at timestamptz NOT NULL,checkout_id text UNIQUE,payment_intent text,paid_at timestamptz);
 ALTER TABLE coaching_connect_payment ADD COLUMN IF NOT EXISTS payee_snapshot jsonb;
 ALTER TABLE coaching_connect_payment ADD COLUMN IF NOT EXISTS service_archived boolean NOT NULL DEFAULT false;
 ALTER TABLE coaching_connect_payment ADD COLUMN IF NOT EXISTS service_held_month text;
 CREATE TABLE IF NOT EXISTS coaching_connect_earning(payment_id uuid PRIMARY KEY REFERENCES coaching_connect_payment(id) ON DELETE CASCADE,amount integer NOT NULL,commission integer NOT NULL,refunded integer NOT NULL DEFAULT 0,refunded_commission integer NOT NULL DEFAULT 0,processing_fees integer NOT NULL DEFAULT 0,allocated integer NOT NULL DEFAULT 0,held integer NOT NULL DEFAULT 0,available boolean NOT NULL DEFAULT false,checked_at timestamptz);
 CREATE TABLE IF NOT EXISTS coaching_connect_batch(id uuid PRIMARY KEY,seller_id uuid NOT NULL REFERENCES coaching_seller(id),month text NOT NULL,currency text NOT NULL,amount integer NOT NULL,transfer_amount integer NOT NULL,account_id text NOT NULL,created_at timestamptz NOT NULL,transfer_id text UNIQUE,payout_id text UNIQUE,state text NOT NULL DEFAULT 'pending',retry_at timestamptz,paid_at timestamptz,notice_sent_at timestamptz,notice_claim uuid,notice_claimed_at timestamptz,notice_retry_at timestamptz,payout_outcome text NOT NULL DEFAULT 'none',transfer_outcome text NOT NULL DEFAULT 'none',cancel_transfer_id text,cancel_started_at timestamptz,payout_attempt integer NOT NULL DEFAULT 0,payout_attempted_at timestamptz);
 ALTER TABLE coaching_connect_batch ADD COLUMN IF NOT EXISTS payout_outcome text;
 ALTER TABLE coaching_connect_batch ADD COLUMN IF NOT EXISTS transfer_outcome text;
 ALTER TABLE coaching_connect_batch ADD COLUMN IF NOT EXISTS cancel_transfer_id text;
 ALTER TABLE coaching_connect_batch ADD COLUMN IF NOT EXISTS cancel_started_at timestamptz;
 ALTER TABLE coaching_connect_batch ADD COLUMN IF NOT EXISTS payout_attempt integer NOT NULL DEFAULT 0;
 ALTER TABLE coaching_connect_batch ADD COLUMN IF NOT EXISTS payout_attempted_at timestamptz;
 UPDATE coaching_connect_batch SET payout_outcome=CASE WHEN payout_id IS NOT NULL THEN 'created' ELSE 'unknown' END WHERE payout_outcome IS NULL;
 UPDATE coaching_connect_batch SET transfer_outcome=CASE WHEN transfer_amount=0 THEN 'none' WHEN transfer_id IS NOT NULL THEN 'created' ELSE 'unknown' END WHERE transfer_outcome IS NULL;
 ALTER TABLE coaching_connect_batch ALTER COLUMN payout_outcome SET DEFAULT 'none';
 ALTER TABLE coaching_connect_batch ALTER COLUMN payout_outcome SET NOT NULL;
 ALTER TABLE coaching_connect_batch ALTER COLUMN transfer_outcome SET DEFAULT 'none';
 ALTER TABLE coaching_connect_batch ALTER COLUMN transfer_outcome SET NOT NULL;
 ALTER TABLE coaching_connect_batch DROP CONSTRAINT IF EXISTS coaching_connect_batch_seller_id_month_currency_key;
 CREATE UNIQUE INDEX IF NOT EXISTS coaching_connect_active_batch ON coaching_connect_batch(seller_id,month,currency) WHERE state<>'cancelled';
 CREATE TABLE IF NOT EXISTS coaching_connect_allocation(batch_id uuid NOT NULL REFERENCES coaching_connect_batch(id),payment_id uuid NOT NULL REFERENCES coaching_connect_earning(payment_id),amount integer NOT NULL,PRIMARY KEY(batch_id,payment_id));`);
}

/** Export money summaries without Stripe credentials or any other Candidate's identity. */
export async function connectDataOf(database: Queryable, candidateId: string) {
  const purchases = (
    await database.query(
      `SELECT p.id,p.coach_id AS "coachId",p.amount,p.currency,p.paid_at AS "paidAt",e.refunded FROM coaching_connect_payment p LEFT JOIN coaching_connect_earning e ON e.payment_id=p.id WHERE p.candidate_id=$1 ORDER BY p.created_at,p.id`,
      [candidateId],
    )
  ).rows;
  const sellerIds = (
    await database.query<{ id: string }>(
      `SELECT k.seller_id AS id FROM coaching_connect_account k JOIN coaching_seller s ON s.id=k.seller_id WHERE (s.kind='human_coach' AND k.owner_id=$1) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=s.association_id AND m.candidate_id=$1))`,
      [candidateId],
    )
  ).rows.map((r) => r.id);
  const earnings = (
    await database.query(
      `SELECT p.id,p.recipient_id AS "sellerId",p.paid_at AS "paidAt",p.currency,p.payee_snapshot AS "payee",p.service_held_month AS "serviceMonth",e.amount,e.commission,e.refunded,e.refunded_commission AS "refundedCommission",e.processing_fees AS "processingFees",e.held,e.allocated FROM coaching_connect_payment p JOIN coaching_connect_earning e ON e.payment_id=p.id WHERE p.recipient_id=ANY($1::uuid[]) ORDER BY p.paid_at,p.id`,
      [sellerIds],
    )
  ).rows;
  const payouts = (
    await database.query(
      `SELECT id,seller_id AS "sellerId",month,currency,amount,state,created_at AS "createdAt",paid_at AS "paidAt" FROM coaching_connect_batch WHERE seller_id=ANY($1::uuid[]) ORDER BY created_at,id`,
      [sellerIds],
    )
  ).rows;
  return { purchases, earnings, payouts };
}
/** Keep pseudonymous accounting for the Seller, detach the purchaser and remove their Checkout email. */
export async function deleteConnectDataOf(database: Queryable, candidateId: string) {
  await database.query("DELETE FROM coaching_connect_payment WHERE candidate_id=$1 AND paid_at IS NULL", [candidateId]);
  await database.query("UPDATE coaching_connect_payment SET request=request-'email',candidate_id=NULL WHERE candidate_id=$1", [candidateId]);
}
