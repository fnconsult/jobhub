/**
 * Quota Reductions (CONTEXT.md, #514, ADR-0014 addendum): a Plan's quotas or Plan Features lowered on a paid Plan with
 * subscribers wait at least NOTICE_DAYS, announced to each subscriber, who may cancel meanwhile and up to
 * RESOLUTION_DAYS_AFTER the effective date with a prorata refund (C. conso. L224-25-26).
 *
 * One deep module. `createQuotaReductions(database, deps)` answers:
 *  - Back Office: what does a change do?    `changeQuotas`, `removeFeatures` (in the caller's audited transaction)
 *                 what is scheduled?         `pending`, and `cancel` before its effective date
 *  - worker:      `run`: applies those due (each recorded in the Back Office Audit under the Administrator who
 *                 scheduled it), sends the notices not sent yet (one e-mail per subscriber), asks again for refunds
 *                 Stripe did not answer about
 *  - Candidate:   `openFor` (the reduction they may still cancel over), `resolve` (cancel now, refunded prorata),
 *                 `lastResolution` (how that went)
 * and `migrateQuotaReductions(database)`.
 *
 * An increase, and any change on Free or on a Plan nobody pays for, is not a Quota Reduction: it applies at once.
 */
import { FREE_PLAN, type Plan, type PlanFeature, type PlanQuotas } from "@jobhub/shared";
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import type { BackOfficeChange } from "../admin/back-office";
import { insertAuditEntry } from "../admin/back-office";
import type { Mailer } from "../auth";
import type { Billing, PlanName, ProrataRefundResult } from "../billing";
import type { Queryable } from "../database/pool";
import { routes } from "../routes";
import { quotaReductionEmail } from "./email";
import { addDays, dayInParis, earliestEffectiveOn, effectiveAtOf, RESOLUTION_DAYS_AFTER, splitQuotaChange, type ReducedQuotas } from "./reduction";

export { earliestEffectiveOn, NOTICE_DAYS, RESOLUTION_DAYS_AFTER, splitQuotaChange } from "./reduction";
export type { QuotaReductionStep, ReducedQuotas } from "./reduction";

/** What an Administrator gives when lowering a paid Plan: why, and from when ("2026-11-14", midnight in Paris). */
export interface ReductionNotice {
  reason: string;
  effectiveOn: string;
}

/** Why a change could not be scheduled. */
export type ReductionError =
  /** No reason, or no effective date, for a reduction subscribers must be told of. */
  | "notice_required"
  /** An effective date that is no date. */
  | "invalid_effective_date"
  /** An effective date less than NOTICE_DAYS away. */
  | "too_soon"
  /** The Plan already has a Quota Reduction scheduled: cancel it first. */
  | "reduction_pending"
  | "unknown_plan";

/** A scheduled Quota Reduction, as the Back Office lists it. */
export interface QuotaReduction {
  id: string;
  plan: Plan;
  quotas: ReducedQuotas;
  removedFeatures: PlanFeature[];
  reason: string;
  effectiveOn: string;
  /** The paying subscribers told of it, how many were e-mailed already, and how many cancelled over it. */
  subscribers: number;
  notified: number;
  resolved: number;
  /** Cancellations whose refund Stripe has not made: asked again by the worker when Stripe did not answer, left to Support when it refused. */
  refundsPending: number;
  scheduledBy: string;
}

/** The Quota Reduction a Candidate may cancel their subscription over, until `resolvableUntil` (a day in Paris, included). */
export interface OpenReduction {
  id: string;
  plan: Plan;
  planName: PlanName;
  quotas: ReducedQuotas;
  removedFeatures: PlanFeature[];
  reason: string;
  effectiveOn: string;
  resolvableUntil: string;
}

export interface QuotaReductionsDeps {
  billing: Pick<
    Billing,
    "lockPlanQuotas" | "setPlanQuotas" | "removePlanFeatures" | "subscribersOf" | "plans" | "entitlements" | "endSubscriptionWithProrataRefund" | "retryProrataRefund"
  >;
  mailer: Mailer;
  /** The web app's public origin, which the e-mail links to; asked only when an e-mail is sent. */
  baseURL: string | (() => string);
  now?: () => Date;
}

/** Creates the tables. Run after billing's and the Back Office Audit's. Safe to run repeatedly. */
export async function migrateQuotaReductions(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS plan_quota_reduction (
      id bigserial PRIMARY KEY,
      plan text NOT NULL REFERENCES plan (key),
      -- The quotas it lowers, each { before, after }; the Plan Features it takes off.
      quotas jsonb NOT NULL DEFAULT '{}',
      removed_features text[] NOT NULL DEFAULT '{}',
      reason text NOT NULL,
      effective_on date NOT NULL,
      effective_at timestamptz NOT NULL,
      -- The Administrator who scheduled it, as the Back Office Audit names them: their id (no reference, so their account
      -- may go; the entry applying it then names them by email only) and the email they had then.
      scheduled_by text,
      scheduled_by_email text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      cancelled_at timestamptz,
      applied_at timestamptz
    );
    -- One Quota Reduction waits per Plan at a time.
    CREATE UNIQUE INDEX IF NOT EXISTS plan_quota_reduction_pending_idx ON plan_quota_reduction (plan) WHERE cancelled_at IS NULL AND applied_at IS NULL;
    CREATE TABLE IF NOT EXISTS plan_quota_reduction_notice (
      reduction_id bigint NOT NULL REFERENCES plan_quota_reduction (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      sent_at timestamptz,
      -- When they cancelled over it, the subscription ended, and its prorata refund (or why Stripe did not make it).
      resolved_at timestamptz,
      subscription_id text,
      refund_id text,
      refund_amount integer,
      refund_failure text,
      PRIMARY KEY (reduction_id, candidate_id)
    );
    CREATE INDEX IF NOT EXISTS plan_quota_reduction_notice_candidate_idx ON plan_quota_reduction_notice (candidate_id);
  `);
}

type ReductionRow = {
  id: string;
  plan: Plan;
  quotas: ReducedQuotas;
  removed_features: PlanFeature[];
  reason: string;
  effective_on: string;
  effective_at: Date;
  scheduled_by: string | null;
  scheduled_by_email: string;
};

const REDUCTION_COLUMNS =
  "r.id::text AS id, r.plan, r.quotas, r.removed_features, r.reason, to_char(r.effective_on, 'YYYY-MM-DD') AS effective_on, r.effective_at, (SELECT id FROM candidate WHERE id = r.scheduled_by) AS scheduled_by, r.scheduled_by_email";

export function createQuotaReductions(database: Pool, deps: QuotaReductionsDeps) {
  const now = deps.now ?? (() => new Date());

  /** Schedules a reduction of `plan` after checking its notice; tells its paying subscribers (the worker e-mails them). */
  async function schedule(
    plan: Plan,
    change: { quotas: ReducedQuotas; removedFeatures: PlanFeature[] },
    notice: ReductionNotice | null,
    subscribers: string[],
    within: Queryable,
    actor: { id: string; email: string },
  ): Promise<{ ok: true; reduction: QuotaReduction } | { ok: false; error: ReductionError }> {
    const reason = notice?.reason.trim() ?? "";
    const effectiveOn = notice?.effectiveOn.trim() ?? "";
    if (!reason || !effectiveOn) return { ok: false, error: "notice_required" };
    const effectiveAt = effectiveAtOf(effectiveOn);
    if (!effectiveAt) return { ok: false, error: "invalid_effective_date" };
    if (effectiveOn < earliestEffectiveOn(now())) return { ok: false, error: "too_soon" };
    const { rows: pending } = await within.query("SELECT 1 FROM plan_quota_reduction WHERE plan = $1 AND cancelled_at IS NULL AND applied_at IS NULL", [plan]);
    if (pending.length > 0) return { ok: false, error: "reduction_pending" };
    const { rows } = await within.query<{ id: string }>(
      `INSERT INTO plan_quota_reduction (plan, quotas, removed_features, reason, effective_on, effective_at, scheduled_by, scheduled_by_email)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8) RETURNING id::text AS id`,
      [plan, JSON.stringify(change.quotas), change.removedFeatures, reason, effectiveOn, effectiveAt, actor.id, actor.email.trim().toLowerCase()],
    );
    const id = rows[0]!.id;
    await within.query("INSERT INTO plan_quota_reduction_notice (reduction_id, candidate_id) SELECT $1, unnest($2::text[])", [id, subscribers]);
    return {
      ok: true,
      reduction: { id, plan, ...change, reason, effectiveOn, subscribers: subscribers.length, notified: 0, resolved: 0, refundsPending: 0, scheduledBy: actor.email.trim().toLowerCase() },
    };
  }

  async function planNames(): Promise<Map<Plan, PlanName>> {
    return new Map((await deps.billing.plans()).map((plan) => [plan.key, plan.name]));
  }

  /** Records what Stripe did with a prorata refund on the notice it was for. */
  async function keepRefund(reductionId: string, candidateId: string, result: ProrataRefundResult): Promise<void> {
    await database.query(
      `UPDATE plan_quota_reduction_notice SET refund_id = $3, refund_amount = $4, refund_failure = $5, subscription_id = COALESCE($6, subscription_id)
       WHERE reduction_id = $1 AND candidate_id = $2`,
      [reductionId, candidateId, result.ok ? (result.refund?.id ?? null) : null, result.ok ? (result.refund?.amount ?? 0) : null, result.ok ? null : result.reason, result.ok ? null : result.subscription],
    );
  }

  /**
   * The Quota Reduction the Candidate was told of and may still cancel their subscription over (until RESOLUTION_DAYS_AFTER
   * its effective date, while they still pay for its Plan); null when none.
   */
async function openFor(candidateId: string): Promise<OpenReduction | null> {
    const { plan } = await deps.billing.entitlements(candidateId);
    if (plan === FREE_PLAN) return null;
    const today = dayInParis(now());
    const { rows } = await database.query<ReductionRow>(
      `SELECT ${REDUCTION_COLUMNS} FROM plan_quota_reduction r JOIN plan_quota_reduction_notice n ON n.reduction_id = r.id
       WHERE n.candidate_id = $1 AND n.resolved_at IS NULL AND r.cancelled_at IS NULL AND r.plan = $2
         AND r.effective_on + $3::integer >= $4::date
       ORDER BY r.effective_at DESC, r.id DESC LIMIT 1`,
      [candidateId, plan, RESOLUTION_DAYS_AFTER, today],
    );
    const row = rows[0];
    if (!row) return null;
    const name = (await planNames()).get(row.plan) ?? { fr: row.plan, en: row.plan };
    return {
      id: row.id,
      plan: row.plan,
      planName: name,
      quotas: row.quotas,
      removedFeatures: row.removed_features,
      reason: row.reason,
      effectiveOn: row.effective_on,
      resolvableUntil: addDays(row.effective_on, RESOLUTION_DAYS_AFTER),
    };
  }

  const refundKey = (reductionId: string, candidateId: string) => `quota-reduction-${reductionId}-${candidateId}`;

  return {
    /**
     * Changes one Plan's quotas (Back Office), in `within`'s transaction: increases apply now; quotas it lowers on a
     * Plan with paying subscribers wait for `notice`'s effective date, and each subscriber is told. Lowered on Free, or on
     * a Plan nobody pays for, everything applies now. Returns the quotas before, those applied now, and the reduction
     * scheduled (null when none).
     */
    async changeQuotas(
      plan: Plan,
      quotas: PlanQuotas,
      notice: ReductionNotice | null,
      within: Queryable,
      actor: { id: string; email: string },
    ): Promise<{ ok: true; before: PlanQuotas; applied: PlanQuotas; scheduled: QuotaReduction | null } | { ok: false; error: ReductionError }> {
      const before = await deps.billing.lockPlanQuotas(plan, within);
      if (!before) return { ok: false, error: "unknown_plan" };
      const { now: raised, reduced } = splitQuotaChange(before, quotas);
      const subscribers = Object.keys(reduced).length > 0 ? await deps.billing.subscribersOf(plan, within) : [];
      if (plan === FREE_PLAN || subscribers.length === 0) {
        await deps.billing.setPlanQuotas(plan, quotas, within);
        return { ok: true, before, applied: quotas, scheduled: null };
      }
      const scheduled = await schedule(plan, { quotas: reduced, removedFeatures: [] }, notice, subscribers, within, actor);
      if (!scheduled.ok) return scheduled;
      await deps.billing.setPlanQuotas(plan, raised, within);
      return { ok: true, before, applied: raised, scheduled: scheduled.reduction };
    },

    /**
     * Whether Plan Features an Administrator takes off `plan` (Back Office) must wait: on a Plan with paying subscribers they
     * are scheduled with `notice` (the caller keeps them on the Plan until then), and `scheduled` is the reduction; null
     * when they may go now. In `within`'s transaction.
     */
    async removeFeatures(
      plan: Plan,
      removed: PlanFeature[],
      notice: ReductionNotice | null,
      within: Queryable,
      actor: { id: string; email: string },
    ): Promise<{ ok: true; scheduled: QuotaReduction | null } | { ok: false; error: ReductionError }> {
      if (removed.length === 0 || plan === FREE_PLAN) return { ok: true, scheduled: null };
      const subscribers = await deps.billing.subscribersOf(plan, within);
      if (subscribers.length === 0) return { ok: true, scheduled: null };
      const scheduled = await schedule(plan, { quotas: {}, removedFeatures: removed }, notice, subscribers, within, actor);
      return scheduled.ok ? { ok: true, scheduled: scheduled.reduction } : scheduled;
    },

    /** The Quota Reductions waiting for their effective date, soonest first. */
    async pending(): Promise<QuotaReduction[]> {
      const { rows } = await database.query<ReductionRow & { subscribers: number; notified: number; resolved: number; refunds_pending: number }>(
        `SELECT ${REDUCTION_COLUMNS},
                count(n.candidate_id)::integer AS subscribers,
                count(n.sent_at)::integer AS notified,
                count(n.resolved_at)::integer AS resolved,
                count(n.refund_failure)::integer AS refunds_pending
         FROM plan_quota_reduction r LEFT JOIN plan_quota_reduction_notice n ON n.reduction_id = r.id
         WHERE r.cancelled_at IS NULL AND r.applied_at IS NULL
         GROUP BY r.id ORDER BY r.effective_at, r.id`,
      );
      return rows.map((row) => ({
        id: row.id,
        plan: row.plan,
        quotas: row.quotas,
        removedFeatures: row.removed_features,
        reason: row.reason,
        effectiveOn: row.effective_on,
        subscribers: row.subscribers,
        notified: row.notified,
        resolved: row.resolved,
        refundsPending: row.refunds_pending,
        scheduledBy: row.scheduled_by_email,
      }));
    },

    /**
     * Cancels a Quota Reduction before its effective date (Back Office), in `within`'s transaction: the Plan keeps what it
     * has, and the notices not sent yet never are. Returns it, or null when there is none waiting by that id.
     */
    async cancel(id: string, within: Queryable): Promise<QuotaReduction | null> {
      if (!/^\d+$/.test(id)) return null;
      const { rows } = await within.query<ReductionRow>(
        `UPDATE plan_quota_reduction r SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL AND applied_at IS NULL AND effective_at > $2 RETURNING ${REDUCTION_COLUMNS}`,
        [id, now()],
      );
      const row = rows[0];
      if (!row) return null;
      const { rows: counts } = await within.query<{ subscribers: number }>("SELECT count(*)::integer AS subscribers FROM plan_quota_reduction_notice WHERE reduction_id = $1", [id]);
      return {
        id: row.id,
        plan: row.plan,
        quotas: row.quotas,
        removedFeatures: row.removed_features,
        reason: row.reason,
        effectiveOn: row.effective_on,
        subscribers: counts[0]?.subscribers ?? 0,
        notified: 0,
        resolved: 0,
        refundsPending: 0,
        scheduledBy: row.scheduled_by_email,
      };
    },

    /**
     * The worker's round: applies the Quota Reductions now due, each with its Back Office Audit entry (`applied`, under the
     * Administrator who scheduled it); e-mails each notice not sent yet, once; asks Stripe again for refunds it did not make.
     */
    async run(): Promise<{ applied: number; sent: number; failed: number; refunds: number }> {
      let applied = 0;
      for (;;) {
        const client = await database.connect();
        try {
          await client.query("BEGIN");
          const { rows } = await client.query<ReductionRow>(
            `SELECT ${REDUCTION_COLUMNS} FROM plan_quota_reduction r
             WHERE cancelled_at IS NULL AND applied_at IS NULL AND effective_at <= $1
             ORDER BY effective_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [now()],
          );
          const due = rows[0];
          if (!due) {
            await client.query("COMMIT");
            break;
          }
          const changes: BackOfficeChange[] = [];
          const lowered = Object.entries(due.quotas) as [keyof PlanQuotas, { after: unknown }][];
          if (lowered.length > 0) {
            const current = await deps.billing.lockPlanQuotas(due.plan, client);
            if (current) {
              const after = { ...current, ...Object.fromEntries(lowered.map(([quota, step]) => [quota, step.after])) } as PlanQuotas;
              await deps.billing.setPlanQuotas(due.plan, after, client);
              changes.push({ section: "plan_quotas", target: due.plan, action: "applied", before: { ...current }, after: { ...after, reduction: due.id } });
            }
          }
          if (due.removed_features.length > 0) {
            const features = await deps.billing.removePlanFeatures(due.plan, due.removed_features, client);
            if (features) changes.push({ section: "plans", target: due.plan, action: "applied", before: { features: features.before }, after: { features: features.after, reduction: due.id } });
          }
          await client.query("UPDATE plan_quota_reduction SET applied_at = $2 WHERE id = $1", [due.id, now()]);
          for (const change of changes) await insertAuditEntry(client, { id: due.scheduled_by, email: due.scheduled_by_email }, change);
          await client.query("COMMIT");
          applied += 1;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }

      let sent = 0;
      let failed = 0;
      // Claimed before it is sent, so two workers never send one twice; given back when it could not be sent.
      const { rows: claimed } = await database.query<ReductionRow & { candidate_id: string; email: string; language: string | null }>(
        `UPDATE plan_quota_reduction_notice n SET sent_at = $1
         FROM plan_quota_reduction r, candidate c
         WHERE n.reduction_id = r.id AND c.id = n.candidate_id AND n.sent_at IS NULL AND r.cancelled_at IS NULL
         RETURNING ${REDUCTION_COLUMNS}, n.candidate_id, c.email, c."interfaceLanguage" AS language`,
        [now()],
      );
      const names = claimed.length > 0 ? await planNames() : new Map<Plan, PlanName>();
      for (const notice of claimed) {
        const language: Locale = isSupportedLocale(notice.language) ? notice.language : DEFAULT_LOCALE;
        try {
          const email = quotaReductionEmail(
            {
              planName: names.get(notice.plan)?.[language] ?? notice.plan,
              quotas: notice.quotas,
              removedFeatures: notice.removed_features,
              reason: notice.reason,
              effectiveOn: notice.effective_on,
              resolvableUntil: addDays(notice.effective_on, RESOLUTION_DAYS_AFTER),
              resolveUrl: new URL(routes.subscriptionQuotaReduction, typeof deps.baseURL === "string" ? deps.baseURL : deps.baseURL()).toString(),
            },
            language,
          );
          await deps.mailer.send({ to: notice.email, ...email });
          sent += 1;
        } catch (error) {
          console.error("[quota-reductions] could not send a notice; it is sent again on the next run", error);
          await database.query("UPDATE plan_quota_reduction_notice SET sent_at = NULL WHERE reduction_id = $1 AND candidate_id = $2", [notice.id, notice.candidate_id]);
          failed += 1;
        }
      }

      let refunds = 0;
      const { rows: unrefunded } = await database.query<{ reduction_id: string; candidate_id: string; subscription_id: string; resolved_at: Date }>(
        // Only those Stripe did not answer: one it refused (a disputed payment, say) is for Support, in Stripe.
        "SELECT reduction_id::text AS reduction_id, candidate_id, subscription_id, resolved_at FROM plan_quota_reduction_notice WHERE refund_failure = 'stripe_unavailable' AND subscription_id IS NOT NULL",
      );
      for (const notice of unrefunded) {
        const result = await deps.billing.retryProrataRefund(notice.subscription_id, refundKey(notice.reduction_id, notice.candidate_id), notice.resolved_at);
        await keepRefund(notice.reduction_id, notice.candidate_id, result);
        if (result.ok) refunds += 1;
      }
      return { applied, sent, failed, refunds };
    },

    openFor,

    /** How the Candidate's latest cancellation over a Quota Reduction was refunded, to tell them; null when they made none. */
    async lastResolution(candidateId: string): Promise<{ refund: { amount: number; currency: string } | null; refundPending: boolean } | null> {
      const { rows } = await database.query<{ refund_amount: number | null; refund_failure: string | null }>(
        "SELECT refund_amount, refund_failure FROM plan_quota_reduction_notice WHERE candidate_id = $1 AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 1",
        [candidateId],
      );
      const row = rows[0];
      if (!row) return null;
      if (row.refund_failure) return { refund: null, refundPending: true };
      return { refund: row.refund_amount ? { amount: row.refund_amount, currency: "eur" } : null, refundPending: false };
    },

    /**
     * Ends the Candidate's subscription now over the Quota Reduction open to them, refunded prorata of the paid period not
     * used (Stripe asked again by the worker if it did not make the refund). Throws when Stripe could not cancel it.
     */
    async resolve(candidateId: string): Promise<{ ok: true; refund: { amount: number; currency: string } | null; refundPending: boolean } | { ok: false; error: "not_open" }> {
      const open = await openFor(candidateId);
      if (!open) return { ok: false, error: "not_open" };
      const ended = await deps.billing.endSubscriptionWithProrataRefund(candidateId, refundKey(open.id, candidateId));
      if (!ended) return { ok: false, error: "not_open" };
      await database.query("UPDATE plan_quota_reduction_notice SET resolved_at = $3 WHERE reduction_id = $1 AND candidate_id = $2", [open.id, candidateId, now()]);
      await keepRefund(open.id, candidateId, ended);
      return ended.ok ? { ok: true, refund: ended.refund && { amount: ended.refund.amount, currency: ended.refund.currency }, refundPending: false } : { ok: true, refund: null, refundPending: true };
    },
  };
}

export type QuotaReductions = ReturnType<typeof createQuotaReductions>;
