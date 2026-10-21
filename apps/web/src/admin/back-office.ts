/**
 * The Back Office's writes, each recorded in the Back Office Audit (CONTEXT.md, #203).
 *
 * One deep module. `createBackOffice(database, deps)` answers:
 *  - change what the Jobbbox team runs     `createPlan`, `updatePlan`, `movePlan`, `setPlanQuotas`,
 *                                          `createCoupon`, `deactivateCoupon`,
 *                                          `addHumanCoach`, `retireHumanCoach`
 *  - record any other Back Office write    `record`, the one seam every write goes through
 *  - record an attempt that failed         `recordFailure`, or `record` when its write is refused
 *  - read the record                       `journal`, newest first, by section and by Outcome
 * and `purgeExpiredBackOfficeAudit(database, now)` (the worker, daily) and
 * `migrateBackOfficeAudit(database)`.
 *
 * A change and its entry are kept together or not at all: both go in one
 * transaction. An entry names its Administrator by Candidate id and by the email
 * they had then, so it outlives their account (the id becomes null). Secret
 * values are never recorded, only that they were replaced. An attempt that failed or was refused
 * (#263, ADR-0030) is recorded on its own, outside the write it undoes: what was tried, on which
 * target, the field at fault and its Failure Reason, never the values entered. Entries are Jobbbox's
 * operations record, not the Administrator's personal data export; they are kept
 * RETENTION_YEARS.
 */
import { cleanTechnicalMessage, FREE_PLAN, type FailureReason, type Plan, type PlanQuotas, type TechnicalReason } from "@jobhub/shared";
import type { Pool } from "pg";
import type {
  Billing,
  Coupon,
  CouponResult,
  PlanDefinition,
  PlanResult,
} from "../billing";
import type { Queryable } from "../database/pool";
import type { AddHumanCoachResult, HumanCoaches } from "../human-coaches";

/** How long a Back Office Audit entry is kept. */
export const RETENTION_YEARS = 3;

/** What part of the Back Office a change was made in. */
export const BACK_OFFICE_SECTIONS = [
  "roles",
  "plans",
  "plan_quotas",
  "coupons",
  "human_coaches",
  "provider_secrets",
  "sign_in_providers",
  "job_discovery_sources",
  "job_discovery_sites",
  "job_sites",
  "ai_messages",
  "coaching_playbooks",
  "eval_cases",
  "guardrails",
] as const;
export type BackOfficeSection = (typeof BACK_OFFICE_SECTIONS)[number];

export const isBackOfficeSection = (
  value: unknown,
): value is BackOfficeSection =>
  BACK_OFFICE_SECTIONS.includes(value as BackOfficeSection);

/**
 * What can be done to a secret (a Provider Secret): replaced, replaced although its
 * connection test failed ("save anyway"), or cleared (back to env). Its value is never
 * recorded, before or after.
 */
export const SECRET_ACTIONS = [
  "replaced",
  "replaced_despite_failed_test",
  "cleared",
] as const;
export type SecretAction = (typeof SECRET_ACTIONS)[number];

/**
 * What was done to the target. `retired` keeps its history (a Human Coach), `removed`
 * deletes it (a search site). `viewed`: an AI Message Log was read (#218), the only read the
 * Back Office Audit records. `validated`, `archived` and `restored`: a Playbook Version was
 * Human-validated, a Coaching Playbook archived or restored (#225). `reset`: the week's Plan Quota
 * usage of every Candidate was forgotten (ADR-0032).
 */
export type BackOfficeAction = "added" | "updated" | "retired" | "removed" | "tested" | "viewed" | "validated" | "archived" | "restored" | "reset" | "refused" | SecretAction;

/** How a Back Office attempt ended (the Outcome, CONTEXT.md): the Back Office Audit only uses these two. */
export const BACK_OFFICE_OUTCOMES = ["succeeded", "failed"] as const;
export type BackOfficeOutcome = (typeof BACK_OFFICE_OUTCOMES)[number];

export const isBackOfficeOutcome = (value: unknown): value is BackOfficeOutcome => BACK_OFFICE_OUTCOMES.includes(value as BackOfficeOutcome);

export const isSecretAction = (
  action: BackOfficeAction,
): action is SecretAction => SECRET_ACTIONS.includes(action as SecretAction);

/** A value as recorded: what JSON can hold. */
export type Recorded =
  string | number | boolean | null | Recorded[] | { [key: string]: Recorded };

/** One change to record. */
export type BackOfficeChange = {
  section: BackOfficeSection;
  /** What was changed: a Plan, a Human Coach's email, an Administrator's email... */
  target: string;
} & (
  | {
      action: Exclude<BackOfficeAction, SecretAction>;
      before: Recorded;
      after: Recorded;
    }
  /** A secret was replaced or cleared: no value is recorded, before or after. */
  | { action: SecretAction }
);

/**
 * The fields an attempt in each section can fail on (#263): the only ones a BackOfficeFailure may name,
 * so the Journal has a label for every one (journal-fields.ts).
 */
export const FAILURE_FIELDS = {
  roles: ["email", "roles"],
  plans: ["stripeProductId"],
  coupons: ["code"],
  provider_secrets: ["value"],
  sign_in_providers: ["enabled", "privateKey"],
  coaching_playbooks: ["version"],
  guardrails: ["setting"],
} as const satisfies Partial<Record<BackOfficeSection, readonly string[]>>;

/** The fields an attempt in `S` can fail on. */
export type FailureField<S extends BackOfficeSection> = S extends keyof typeof FAILURE_FIELDS ? (typeof FAILURE_FIELDS)[S][number] : never;

/**
 * An attempt that failed or was refused (#263): what was `tried` on `target`, the `field` at fault, and
 * why. Never the values entered. A failed test is recorded as `tested`; anything else as `refused`.
 */
export type BackOfficeFailure = {
  [S in BackOfficeSection]: {
    section: S;
    target: string;
    tried: Exclude<BackOfficeAction, "refused">;
    reason: FailureReason;
    field?: FailureField<S>;
    /** Its message is scrubbed of keys and cut at 500 characters before it is kept. */
    technical?: TechnicalReason;
  };
}[BackOfficeSection];

/** What `record` keeps of a write: a change, a refusal, or nothing (null). */
export type BackOfficeAttempt = BackOfficeChange | BackOfficeFailure;

const isFailure = (attempt: BackOfficeAttempt): attempt is BackOfficeFailure => "reason" in attempt;

/** The Administrator making a change, as signed in. */
export interface BackOfficeActor {
  /** Their Candidate id. */
  id: string;
  email: string;
}

/** One entry of the Back Office Audit, as the Journal lists it. */
export interface BackOfficeAuditEntry {
  id: string;
  at: Date;
  /** Who made the change: their Candidate id (null once their account is deleted) and the email they had then. */
  actor: { candidateId: string | null; email: string };
  section: BackOfficeSection;
  target: string;
  action: BackOfficeAction;
  /** Null when there was nothing before (added), and for a secret. */
  before: Recorded;
  /** Null when there is nothing after (retired, removed), for a secret, and for a failed attempt. */
  after: Recorded;
  outcome: BackOfficeOutcome;
  /** Why a failed attempt failed; null when it succeeded. */
  failure: { reason: FailureReason; tried: BackOfficeAction; field: string | null; technical: TechnicalReason | null } | null;
}

export interface BackOfficeDeps {
  billing: Pick<
    Billing,
    | "setPlanQuotas"
    | "resetWeeklyUsage"
    | "createPlan"
    | "updatePlan"
    | "movePlan"
    | "checkStripeProduct"
    | "plans"
    | "createCoupon"
    | "deactivateCoupon"
    | "reactivateCoupon"
  >;
  humanCoaches: Pick<HumanCoaches, "add" | "retire">;
}

export interface BackOffice {
  /** Creates a Plan, hidden; `input` is untrusted (see Billing.createPlan); a product Stripe refuses is recorded as a failed attempt, nothing else refused is. */
  createPlan(
    actor: BackOfficeActor,
    input: unknown,
  ): Promise<PlanResult<{ plan: PlanDefinition }>>;
  /** Changes a Plan's names, status, Stripe product or Plan Features (see Billing.updatePlan); nothing is recorded when refused. */
  updatePlan(
    actor: BackOfficeActor,
    plan: Plan,
    input: unknown,
  ): Promise<PlanResult<object>>;
  /** Moves a Plan one rank up or down (see Billing.movePlan); nothing is recorded when refused. */
  movePlan(
    actor: BackOfficeActor,
    plan: Plan,
    direction: "up" | "down",
  ): Promise<PlanResult<{ before: number; after: number }>>;
  /** Replaces one Plan's quotas; nothing is recorded for an unknown Plan. */
  setPlanQuotas(
    actor: BackOfficeActor,
    plan: Plan,
    quotas: PlanQuotas,
  ): Promise<void>;
  /**
   * Forgets this week's Plan Quota usage of every Candidate (see Billing.resetWeeklyUsage),
   * recorded with the Administrator's reason; refused, and nothing reset, without one.
   */
  resetWeeklyUsage(
    actor: BackOfficeActor,
    reason: string,
  ): Promise<{ ok: true; candidates: number } | { ok: false; error: "reason_required" }>;
  /**
   * Creates a Coupon in Stripe; `input` is untrusted (see Billing.createCoupon). Stripe is called before the
   * audit transaction; if the entry cannot be recorded, the code is deactivated again. When Stripe refuses it, or does
   * not answer, that is recorded as a failed attempt; nothing is recorded for any other refusal.
   */
  createCoupon(
    actor: BackOfficeActor,
    input: unknown,
  ): Promise<CouponResult<{ coupon: Coupon }>>;
  /**
   * Deactivates a Coupon in Stripe (see Billing.deactivateCoupon), before the audit transaction; reactivated
   * if the entry cannot be recorded. Stripe's refusal is recorded as a failed attempt; nothing else is when refused, nor
   * when it was inactive already.
   */
  deactivateCoupon(
    actor: BackOfficeActor,
    id: string,
  ): Promise<CouponResult<object>>;
  /** Adds a Human Coach. `input` is untrusted (see HumanCoaches.add); nothing is recorded when refused. */
  addHumanCoach(
    actor: BackOfficeActor,
    input: unknown,
  ): Promise<AddHumanCoachResult>;
  /** Retires a Human Coach; nothing is recorded for an unknown or already retired one. */
  retireHumanCoach(actor: BackOfficeActor, coachId: string): Promise<void>;
  /**
   * Runs one Back Office write and records it, in one transaction: `write` runs on the
   * transaction it is given, then `changeOf` says what it changed (null: nothing to record).
   * If the write, or recording it, fails, neither is kept and the error is thrown.
   * When `changeOf` says the write was refused (a BackOfficeFailure), the write is undone and
   * the refusal recorded on its own.
   */
  record<T>(
    actor: BackOfficeActor,
    write: (within: Queryable) => Promise<T>,
    changeOf: (result: T) => BackOfficeAttempt | null,
  ): Promise<T>;
  /** Records an attempt that failed or was refused, outside any write (#263). */
  recordFailure(actor: BackOfficeActor, failure: BackOfficeFailure): Promise<void>;
  /** The Back Office Audit, newest first: everything, or one section, one Outcome, or both. At most `limit` entries (default 200). */
  journal(filter?: {
    section?: BackOfficeSection;
    outcome?: BackOfficeOutcome;
    limit?: number;
  }): Promise<BackOfficeAuditEntry[]>;
}

interface EntryRow {
  id: string;
  created_at: Date;
  candidate_id: string | null;
  actor_email: string;
  section: BackOfficeSection;
  target: string;
  action: BackOfficeAction;
  before: Recorded;
  after: Recorded;
  outcome: BackOfficeOutcome;
  reason: FailureReason | null;
  tried: BackOfficeAction | null;
  field: string | null;
  technical_reason: TechnicalReason | null;
}

const entryFrom = (row: EntryRow): BackOfficeAuditEntry => ({
  id: row.id,
  at: row.created_at,
  actor: { candidateId: row.candidate_id, email: row.actor_email },
  section: row.section,
  target: row.target,
  action: row.action,
  before: row.before,
  after: row.after,
  outcome: row.outcome,
  failure:
    row.outcome === "failed"
      ? { reason: row.reason ?? "other", tried: row.tried ?? row.action, field: row.field, technical: row.technical_reason }
      : null,
});

/** A technical reason as kept: its message scrubbed of keys and cut. */
const keptTechnical = (technical: TechnicalReason): TechnicalReason => ({
  class: technical.class,
  ...(technical.provider === undefined ? {} : { provider: technical.provider }),
  ...(technical.status === undefined ? {} : { status: technical.status }),
  message: cleanTechnicalMessage(technical.message),
});

/** A recorded value as a jsonb parameter; nothing is SQL NULL. */
const json = (value: Recorded): string | null =>
  value === null ? null : JSON.stringify(value);

/** The Stripe product named in an untrusted Plan form, trimmed; "" when none. */
const productOf = (input: unknown): string => {
  const product =
    typeof input === "object" && input !== null
      ? (input as { stripeProductId?: unknown }).stripeProductId
      : undefined;
  return typeof product === "string" ? product.trim() : "";
};

/** The Plan key named in an untrusted Plan form, trimmed; "" when none. */
const keyOf = (input: unknown): string => {
  const key = typeof input === "object" && input !== null ? (input as { key?: unknown }).key : undefined;
  return typeof key === "string" ? key.trim() : "";
};

/** The Coupon code named in an untrusted Coupon form, trimmed and in capitals; "" when none. */
const codeOf = (input: unknown): string => {
  const code = typeof input === "object" && input !== null ? (input as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.trim().toUpperCase() : "";
};

/** A Plan's quotas as recorded. */
const recordedQuotas = (quotas: PlanQuotas): Recorded => ({ ...quotas });

/** A Coupon's terms as recorded; its code is the entry's target too. */
const recordedCoupon = (coupon: Coupon): { [key: string]: Recorded } => ({
  code: coupon.code,
  discount: { ...coupon.discount },
  duration:
    typeof coupon.duration === "string"
      ? coupon.duration
      : { ...coupon.duration },
  plans: coupon.plans ? [...coupon.plans] : null,
  expiresAt: coupon.expiresAt ? coupon.expiresAt.toISOString() : null,
  maxRedemptions: coupon.maxRedemptions,
  firstPaymentOnly: coupon.firstPaymentOnly,
});

/** What an Administrator sets on a Plan, as recorded; its key is the entry's target, its rank changes on its own. */
const recordedPlan = ({
  name,
  status,
  stripeProductId,
  features,
}: PlanDefinition): { [key: string]: Recorded } => ({
  name: { ...name },
  status,
  stripeProductId,
  features: [...features],
});

export function createBackOffice(
  database: Pool,
  deps: BackOfficeDeps,
): BackOffice {
  async function recordFailure(actor: BackOfficeActor, failure: BackOfficeFailure): Promise<void> {
    await database.query(
      `INSERT INTO back_office_audit (candidate_id, actor_email, section, target, action, outcome, reason, tried, field, technical_reason)
       VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7, $8, $9::jsonb)`,
      [
        actor.id,
        actor.email.trim().toLowerCase(),
        failure.section,
        failure.target,
        failure.tried === "tested" ? "tested" : "refused",
        failure.reason,
        failure.tried,
        failure.field ?? null,
        failure.technical ? JSON.stringify(keptTechnical(failure.technical)) : null,
      ],
    );
  }

  async function record<T>(
    actor: BackOfficeActor,
    write: (within: Queryable) => Promise<T>,
    changeOf: (result: T) => BackOfficeAttempt | null,
  ): Promise<T> {
    const client = await database.connect();
    let refused: BackOfficeFailure | null = null;
    let result: T;
    try {
      await client.query("BEGIN");
      result = await write(client);
      const change = changeOf(result);
      if (change && isFailure(change)) {
        // Refused: whatever the write did is undone; the refusal is recorded on its own, below.
        refused = change;
        await client.query("ROLLBACK");
        return result;
      }
      if (change) {
        const secret = isSecretAction(change.action);
        await client.query(
          `INSERT INTO back_office_audit (candidate_id, actor_email, section, target, action, before, after)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
          [
            actor.id,
            actor.email.trim().toLowerCase(),
            change.section,
            change.target,
            change.action,
            secret || !("before" in change) ? null : json(change.before),
            secret || !("after" in change) ? null : json(change.after),
          ],
        );
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      if (refused) await recordFailure(actor, refused);
    }
  }

  return {
    record,
    recordFailure,

    async createPlan(actor, input) {
      // Stripe is asked before the transaction opens, so none waits on it.
      const problem = await deps.billing.checkStripeProduct(productOf(input));
      if (problem) {
        if (problem.failure) await recordFailure(actor, { section: "plans", target: keyOf(input), tried: "added", field: "stripeProductId", ...problem.failure });
        return { ok: false, error: problem.error };
      }
      const created = await record(
        actor,
        (within) =>
          deps.billing.createPlan(input, within, { productChecked: true }),
        (result) =>
          result.ok
            ? {
                section: "plans",
                target: result.plan.key,
                action: "added",
                before: null,
                after: {
                  ...recordedPlan(result.plan),
                  rank: result.plan.rank,
                  quotas: recordedQuotas(result.quotas),
                },
              }
            : null,
      );
      return created.ok ? { ok: true, plan: created.plan } : created;
    },

    async updatePlan(actor, plan, input) {
      // A product given to a Plan with none yet is asked of Stripe before the transaction opens.
      const current = (await deps.billing.plans()).find(
        (each) => each.key === plan,
      );
      const product = productOf(input);
      let productChecked = false;
      if (
        current &&
        !current.stripeProductId &&
        product &&
        current.key !== FREE_PLAN
      ) {
        const problem = await deps.billing.checkStripeProduct(product);
        if (problem) {
          if (problem.failure) await recordFailure(actor, { section: "plans", target: plan, tried: "updated", field: "stripeProductId", ...problem.failure });
          return { ok: false, error: problem.error };
        }
        productChecked = true;
      }
      const updated = await record(
        actor,
        (within) =>
          deps.billing.updatePlan(plan, input, within, { productChecked }),
        (result) =>
          result.ok
            ? {
                section: "plans",
                target: plan,
                action: "updated",
                before: recordedPlan(result.before),
                after: recordedPlan(result.after),
              }
            : null,
      );
      return updated.ok ? { ok: true } : updated;
    },

    movePlan(actor, plan, direction) {
      return record(
        actor,
        (within) => deps.billing.movePlan(plan, direction, within),
        (result) =>
          result.ok
            ? {
                section: "plans",
                target: plan,
                action: "updated",
                before: { rank: result.before },
                after: { rank: result.after },
              }
            : null,
      );
    },

    async setPlanQuotas(actor, plan, quotas) {
      await record(
        actor,
        (within) => deps.billing.setPlanQuotas(plan, quotas, within),
        (before) =>
          before
            ? {
                section: "plan_quotas",
                target: plan,
                action: "updated",
                before: recordedQuotas(before),
                after: recordedQuotas(quotas),
              }
            : null,
      );
    },

    async resetWeeklyUsage(actor, reason) {
      const why = reason.trim();
      if (!why) return { ok: false, error: "reason_required" };
      const { candidates } = await record(
        actor,
        (within) => deps.billing.resetWeeklyUsage(within),
        (reset) => ({ section: "plan_quotas", target: reset.week, action: "reset", before: null, after: { reason: why, candidates: reset.candidates } }),
      );
      return { ok: true, candidates };
    },

    async createCoupon(actor, input) {
      // Stripe is the Coupon's only home, written before the transaction opens, so none waits on it.
      const created = await deps.billing.createCoupon(input);
      if (!created.ok) {
        if (created.failure) await recordFailure(actor, { section: "coupons", target: codeOf(input), tried: "added", ...(created.error === "code_taken" ? { field: "code" } : {}), ...created.failure });
        return { ok: false, error: created.error };
      }
      try {
        await record(
          actor,
          async () => created.coupon,
          (coupon) => ({
            section: "coupons",
            target: coupon.code,
            action: "added",
            before: null,
            after: recordedCoupon(coupon),
          }),
        );
      } catch (error) {
        // Unrecorded, the code must not be redeemable.
        await deps.billing
          .deactivateCoupon(created.coupon.id)
          .catch(() => undefined);
        throw error;
      }
      return created;
    },

    async deactivateCoupon(actor, id) {
      // As for createCoupon: Stripe first, outside the transaction; undone there if the entry cannot be recorded.
      const deactivated = await deps.billing.deactivateCoupon(id);
      if (!deactivated.ok) {
        if (deactivated.failure) await recordFailure(actor, { section: "coupons", target: id, tried: "updated", ...deactivated.failure });
        return { ok: false, error: deactivated.error };
      }
      if (!deactivated.changed) return { ok: true };
      try {
        await record(
          actor,
          async () => deactivated,
          ({ after }) => ({
            section: "coupons",
            target: after.code,
            action: "updated",
            before: { active: true },
            after: { active: false },
          }),
        );
      } catch (error) {
        await deps.billing.reactivateCoupon(id).catch(() => undefined);
        throw error;
      }
      return { ok: true };
    },

    addHumanCoach(actor, input) {
      return record(
        actor,
        (within) => deps.humanCoaches.add(input, within),
        (added) =>
          added.ok
            ? {
                section: "human_coaches",
                target: added.coach.email,
                action: "added",
                before: null,
                after: { ...added.coach },
              }
            : null,
      );
    },

    async retireHumanCoach(actor, coachId) {
      await record(
        actor,
        (within) => deps.humanCoaches.retire(coachId, within),
        (retired) =>
          retired
            ? {
                section: "human_coaches",
                target: retired.email,
                action: "retired",
                before: { ...retired },
                after: null,
              }
            : null,
      );
    },

    async journal({ section, outcome, limit = 200 } = {}) {
      // Ordered by the table's id, a number: a bare "id" would be the text column selected (10 before 9).
      const { rows } = await database.query<EntryRow>(
        `SELECT id::text, created_at, candidate_id, actor_email, section, target, action, before, after, outcome, reason, tried, field, technical_reason
         FROM back_office_audit WHERE ($1::text IS NULL OR section = $1) AND ($3::text IS NULL OR outcome = $3)
         ORDER BY back_office_audit.id DESC LIMIT $2`,
        [section ?? null, limit, outcome ?? null],
      );
      return rows.map(entryFrom);
    },
  };
}

/**
 * Deletes the Back Office Audit entries RETENTION_YEARS old or more at `now`;
 * returns how many. Safe to run again.
 */
export async function purgeExpiredBackOfficeAudit(
  database: Queryable,
  now: Date,
): Promise<number> {
  const { rowCount } = await database.query(
    "DELETE FROM back_office_audit WHERE created_at <= $1::timestamptz - make_interval(years => $2)",
    [now, RETENTION_YEARS],
  );
  return rowCount ?? 0;
}

/** Creates or upgrades the Back Office Audit table. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateBackOfficeAudit(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS back_office_audit (
      id bigserial PRIMARY KEY,
      candidate_id text REFERENCES candidate (id) ON DELETE SET NULL,
      actor_email text NOT NULL,
      section text NOT NULL,
      target text NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    -- An attempt that failed or was refused (#263): its Outcome, Failure Reason code, what was tried,
    -- the field at fault and the technical reason (scrubbed and cut). Never the values entered.
    ALTER TABLE back_office_audit ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'succeeded';
    ALTER TABLE back_office_audit ADD COLUMN IF NOT EXISTS reason text;
    ALTER TABLE back_office_audit ADD COLUMN IF NOT EXISTS tried text;
    ALTER TABLE back_office_audit ADD COLUMN IF NOT EXISTS field text;
    ALTER TABLE back_office_audit ADD COLUMN IF NOT EXISTS technical_reason jsonb;
    CREATE INDEX IF NOT EXISTS back_office_audit_outcome_idx ON back_office_audit (outcome, id DESC);
    CREATE INDEX IF NOT EXISTS back_office_audit_section_idx ON back_office_audit (section, id DESC);
    CREATE INDEX IF NOT EXISTS back_office_audit_created_at_idx ON back_office_audit (created_at);
    CREATE INDEX IF NOT EXISTS back_office_audit_candidate_id_idx ON back_office_audit (candidate_id);
  `);
}
