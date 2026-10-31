/**
 * Plans, Stripe billing and Plan Quotas (CONTEXT.md, ADR-0014).
 *
 * One deep module. Callers get `createBilling(config)`, whose methods answer:
 *  - what may this Candidate do?  `entitlements`, `use`, `allows`, `release`, `allowsAnother`
 *  - how do they change Plan?     `startCheckout`, `openCustomerPortal`, `handleStripeWebhook`
 *  - how do they pay a Coaching Session?  `coachingSessionPrice`, `startCoachingSessionCheckout`
 *    (the signed webhook reports it paid through `onCoachingSessionPaid`)
 *  - how do they stop paying?     `cancellationTerms`, `scheduleCancellation` (« Résilier votre contrat », #513),
 *                                 and `closeAccount` when they delete their account;
 *                                 `endSubscriptionWithProrataRefund` (`retryProrataRefund`) when they cancel over a
 *                                 Quota Reduction (#514)
 *  - how do they withdraw (#511)?  `subscription` (since when), `paidOnSubscription`, `endSubscriptionNow`,
 *    `coachingSessionPayment`, `refund`
 *    (the signed webhook reports each refund's fate through `onRefundChanged`)
 *  - who pays for a Plan?         `subscribersOf`
 *  - which Plans are there?       `plans`, and in the Back Office `createPlan`, `updatePlan`, `movePlan`
 *  - what do the Plans allow?     `planQuotas`, `setPlanQuotas` (back office), `upgradeFor`
 *  - what do the Plans cost?      `planPrices`
 * and `migrateBilling(database)` to create / upgrade its tables. Stripe, the
 * tables and week boundaries stay behind this seam.
 *
 * Plans live in the `plan` table (ADR-0014 addendum #206, ./plans.ts): each paid Plan is
 * tied to one Stripe product, and every price of that product is the Plan's.
 */
import {
  FREE_PLAN,
  JOB_DIGEST_FREQUENCIES,
  LIMITED_QUOTAS,
  WEEKLY_QUOTAS,
  type LimitedQuota,
  type Plan,
  type PlanFeature,
  type PlanQuotas,
  type WeeklyQuota,
  type Failure,
} from "@jobhub/shared";
import type { Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import { recordingClient, type ExternalApiLog } from "@jobhub/shared";
import Stripe from "stripe";
import type { Mailer } from "../auth/index";
import type { Queryable } from "../database/pool";
import * as z from "zod";
import { routes } from "../routes";
import {
  adoptProduct,
  findPlan,
  insertPlan,
  listPlans,
  lockedPlan,
  migratePlans,
  newPlanInput,
  PLAN_KEY,
  planChangeInput,
  savePlan,
  swapRanks,
  type PlanDefinition,
  type PlanName,
} from "./plans";
import { cancellationReceiptEmail } from "./cancellation-email";
import { createCodeLookups } from "./code-lookups";
import { type StripeWebhookEvent } from "./webhook-events";
import { couponOf, couponParams, COUPON_CURRENCY, listedCouponOf, termsOf, type ActiveDiscount, type Coupon, type CouponResult, type ListedCoupon } from "./coupons";

export type { PlanDefinition, PlanName } from "./plans";
export type { ActiveDiscount, Coupon, CouponDiscount, CouponDuration, CouponError, CouponResult, ListedCoupon } from "./coupons";

export interface BillingConfig {
  /** Postgres pool holding the Candidate accounts. */
  database: Pool;
  /** Public origin of the web app; Stripe sends Candidates back here. */
  baseURL: string;
  /** Without Stripe, quotas still apply but nobody can change Plan. */
  stripe?: StripeConfig | undefined;
  /** The current time. Tests move it; week boundaries are taken in Europe/Paris. */
  now?: () => Date;
  /**
   * Told of each Coaching Session Stripe confirms as paid, from its signed webhook
   * (the Human Coaches module records it). Stripe may report one payment more than
   * once, even concurrently: it must be idempotent per Checkout Session. If it
   * throws, the webhook fails and Stripe retries the delivery.
   */
  onCoachingSessionPaid?: (paid: PaidCoachingSession) => Promise<unknown>;
  /** Where each Stripe call, webhooks received included, is recorded (#234): its API method, never its parameters. Default: nowhere. */
  externalApis?: ExternalApiLog;
  /**
   * Told of each refund whose status Stripe reports from its signed webhook (`refund.updated`, `refund.failed`): a refund
   * can fail days after it was made (#511). Stripe may report one more than once: it must be idempotent. If it throws,
   * the webhook fails and Stripe retries the delivery.
   */
  onRefundChanged?: (change: RefundChange) => Promise<unknown>;
  /** Sends the acknowledgement of a cancellation (Brevo). Without one, nothing is sent. */
  mailer?: Pick<Mailer, "send">;
}

/** A payment Stripe took (a PaymentIntent, or a charge without one), in the currency's smallest unit (cents). */
export interface Payment {
  id: string;
  amount: number;
  currency: string;
}

/** Where a refund stands, as Stripe says. */
export type RefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

/** A refund Stripe took (with its status), or why it refused it: Stripe's error code, or `stripe_unavailable`. */
export type RefundResult = { ok: true; id: string; status: RefundStatus } | { ok: false; reason: string };

/** A refund's status as Stripe reported it later, with why it failed (Stripe's `failure_reason`). */
export interface RefundChange {
  id: string;
  status: RefundStatus;
  failureReason: string | null;
}

/** The Candidate's paid subscription: its Plan, and since when it runs (when the contract was concluded). */
export interface CurrentSubscription {
  id: string;
  plan: Plan;
  planName: PlanName;
  startedAt: Date;
}

/** A paid Plan the Candidate may cancel from Jobbbox, as the confirmation page shows it. */
export interface CancellationTerms {
  plan: Plan;
  planName: PlanName;
  /** The end of the paid period: the Candidate keeps the Plan until then, and is not charged again. */
  endsAt: Date;
}

/**
 * What confirming a cancellation did: scheduled it in Stripe at `endsAt` (and `acknowledged` says whether its
 * acknowledgement was emailed), or nothing, the Candidate having no paid Plan whose cancellation is not scheduled yet.
 */
export type CancellationResult = { ok: true; plan: Plan; requestedAt: Date; endsAt: Date; acknowledged: boolean } | { ok: false; error: "not_cancellable" };

/**
 * How a subscription ended over a Quota Reduction (#514) was refunded: the refund Stripe made (null when nothing was
 * left to refund, or nothing was paid), or why it was not: Stripe's error code, or `stripe_unavailable`. The
 * subscription is ended either way; a refund that was not made can be asked again with `retryProrataRefund`.
 */
export type ProrataRefundResult =
  | { ok: true; refund: { id: string; amount: number; currency: string } | null }
  | {
      ok: false;
      reason: string;
      subscription: string;
      /** What was to be refunded, when Stripe refused it after it was worked out (null when Stripe could not tell it). */
      due: { amount: number; currency: string } | null;
    };

/** How a Candidate checks out. */
export interface CheckoutOptions {
  /**
   * A code they brought (a shared link's `?code=`): applied at Checkout when it can be redeemed on the
   * Plan; otherwise Checkout goes on without it, and they may type one there.
   */
  promotionCode?: string | undefined;
}

/** A Coaching Session payment Stripe confirmed. */
export interface PaidCoachingSession {
  checkoutSessionId: string;
  candidateId: string;
  coachId: string;
  /** In the currency's smallest unit (cents). */
  amount: number;
  currency: string;
}

/** How often a subscription is charged, as Stripe names it. */
export const BILLING_INTERVALS = ["day", "week", "month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** What a Plan costs, in the currency's smallest unit (cents), each `interval`. */
export interface PlanPrice {
  amount: number;
  currency: string;
  interval: BillingInterval;
}

/** What a Coaching Session costs a Candidate, in the currency's smallest unit (cents). */
export interface CoachingSessionPrice {
  amount: number;
  currency: string;
  /** What it costs without the Coaching Session discount; equal to `amount` on a Plan without it. */
  regularAmount: number;
  /** The name of the Candidate's Plan, which the discount comes with. */
  planName: PlanName;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /**
   * Stripe Price ids the paid Plans were sold at before Plans lived in the database
   * (STRIPE_PRICE_STANDARD, STRIPE_PRICE_PREMIUM), by Plan key. A paid Plan with no
   * Stripe product yet gets its Price's product (`linkPlansToEnvPrices`, at startup);
   * afterwards the database wins. Optional fallbacks, to be removed in a later release.
   */
  envPlanPrices?: Partial<Record<Plan, string>> | undefined;
  /**
   * Stripe Price ids of the one-off Coaching Session Price: the regular one, and the
   * discounted one for Plans with the Coaching Session discount (a Plan Feature).
   * Without them, Coaching Sessions cannot be paid.
   */
  coachingSessionPrices?: { regular: string; discounted: string } | undefined;
  /** Another Stripe API origin (a fake one in tests and e2e). */
  apiUrl?: string | undefined;
}

/** The quotas Jobbbox's starting Plans start with, per week (ADR-0032); Administrators change them in the back office. */
export const STARTING_PLAN_QUOTAS: Record<"free" | "standard" | "premium", PlanQuotas> = {
  free: { profiles: 1, matchScores: 1, atsScores: 1, enrichedContacts: 0, jobSearches: 1, jobDigest: "none" },
  standard: { profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobSearches: 7, jobDigest: "weekly" },
  premium: { profiles: null, matchScores: null, atsScores: null, enrichedContacts: 5, jobSearches: null, jobDigest: "daily" },
};

/**
 * The starting amounts while quotas were counted per calendar month, before ADR-0032. A
 * database still counting by the month has each amount still at one of these divided by
 * the weeks of a month, rounded up; an amount an Administrator changed stays as it is.
 */
const MONTHLY_STARTING_AMOUNTS: Record<"free" | "standard" | "premium", Partial<Record<WeeklyQuota, number>>> = {
  free: { matchScores: 3, atsScores: 1, jobSearches: 3 },
  standard: { jobSearches: 30 },
  premium: { enrichedContacts: 20 },
};
const WEEKS_A_MONTH = 52 / 12;

const COLUMNS = {
  profiles: "profiles",
  matchScores: "match_scores",
  atsScores: "ats_scores",
  enrichedContacts: "enriched_contacts",
  jobSearches: "job_searches",
  jobDigest: "job_digest",
} as const satisfies Record<keyof PlanQuotas, string>;

/** Creates or upgrades the billing tables. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateBilling(database: Pool): Promise<void> {
  await migratePlans(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS plan_quota (
      plan text PRIMARY KEY REFERENCES plan (key),
      ${LIMITED_QUOTAS.map((quota) => `${COLUMNS[quota]} integer CHECK (${COLUMNS[quota]} >= 0)`).join(",\n      ")},
      job_digest text NOT NULL CHECK (job_digest IN (${JOB_DIGEST_FREQUENCIES.map((f) => `'${f}'`).join(", ")})),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS candidate_plan (
      candidate_id text PRIMARY KEY REFERENCES candidate(id) ON DELETE CASCADE,
      plan text NOT NULL REFERENCES plan_quota(plan),
      stripe_customer_id text UNIQUE,
      stripe_subscription_id text,
      stripe_status text,
      stripe_event_at timestamptz,
      charged boolean NOT NULL DEFAULT false,
      ends_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS quota_usage (
      candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
      quota text NOT NULL,
      week text NOT NULL,
      used integer NOT NULL,
      PRIMARY KEY (candidate_id, quota, week)
    );
  `);
  // Databases from before weekly quotas (ADR-0032): `month` becomes `week`. Its rows keep their month
  // ("2026-10"), so they are history the week never counts, and the monthly starting amounts become weekly.
  const { rows: monthColumn } = await database.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'quota_usage' AND column_name = 'month'",
  );
  if (monthColumn.length > 0) {
    await database.query("ALTER TABLE quota_usage RENAME COLUMN month TO week");
    for (const [plan, amounts] of Object.entries(MONTHLY_STARTING_AMOUNTS)) {
      for (const [quota, monthly] of Object.entries(amounts) as [WeeklyQuota, number][]) {
        const column = COLUMNS[quota];
        await database.query(`UPDATE plan_quota SET ${column} = $3, updated_at = now() WHERE plan = $1 AND ${column} = $2`, [
          plan,
          monthly,
          Math.ceil(monthly / WEEKS_A_MONTH),
        ]);
      }
    }
  }
  // Databases from before `charged`: a subscription Stripe reports paid or since cancelled was charged (Plans have no trial).
  const { rows: chargedColumn } = await database.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'candidate_plan' AND column_name = 'charged'",
  );
  if (chargedColumn.length === 0) {
    await database.query(`
      ALTER TABLE candidate_plan ADD COLUMN IF NOT EXISTS charged boolean NOT NULL DEFAULT false;
      UPDATE candidate_plan SET charged = true WHERE stripe_status IN (${[...CHARGED_STATUSES, "canceled"].map((status) => `'${status}'`).join(", ")});
    `);
  }
  // Databases from before scheduled cancellations were kept (#169): Stripe tells again on the next change.
  await database.query("ALTER TABLE candidate_plan ADD COLUMN IF NOT EXISTS ends_at timestamptz");
  // When the current subscription started (#511): its Withdrawal period runs from then. Before, it is asked of Stripe once.
  await database.query("ALTER TABLE candidate_plan ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz");
  // Databases from before Plans lived in the database (#206): a CHECK named the three Plans; now a Plan is a row of `plan`.
  // Candidates' Plans are untouched: `candidate_plan` still references `plan_quota`.
  await database.query("ALTER TABLE plan_quota DROP CONSTRAINT IF EXISTS plan_quota_plan_check");
  const { rows: planReference } = await database.query(
    "SELECT 1 FROM pg_constraint WHERE conname = 'plan_quota_plan_fkey' AND conrelid = 'plan_quota'::regclass",
  );
  if (planReference.length === 0) {
    await database.query("ALTER TABLE plan_quota ADD CONSTRAINT plan_quota_plan_fkey FOREIGN KEY (plan) REFERENCES plan (key)");
  }
  const startingPlans = Object.keys(STARTING_PLAN_QUOTAS) as (keyof typeof STARTING_PLAN_QUOTAS)[];
  // A quota added after the table was created starts at its starting value on the starting Plans, and on
  // each Plan an Administrator created at the value of the Plan ranked just below it (Free's at worst):
  // never NULL, which would mean unlimited.
  const { rows: existing } = await database.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'plan_quota'",
  );
  for (const quota of LIMITED_QUOTAS) {
    const column = COLUMNS[quota];
    if (existing.some((row) => row.column_name === column)) continue;
    await database.query(`ALTER TABLE plan_quota ADD COLUMN IF NOT EXISTS ${column} integer CHECK (${column} >= 0)`);
    for (const plan of startingPlans) {
      await database.query(`UPDATE plan_quota SET ${column} = $2 WHERE plan = $1`, [plan, STARTING_PLAN_QUOTAS[plan][quota]]);
    }
    const { rows: ranked } = await database.query<{ plan: string }>("SELECT q.plan FROM plan_quota q JOIN plan p ON p.key = q.plan ORDER BY p.rank");
    let below: string | undefined;
    for (const { plan } of ranked) {
      if (below && !(startingPlans as string[]).includes(plan)) {
        await database.query(`UPDATE plan_quota SET ${column} = (SELECT ${column} FROM plan_quota WHERE plan = $2) WHERE plan = $1`, [plan, below]);
      }
      below = plan;
    }
  }
  for (const plan of startingPlans) {
    const quotas = STARTING_PLAN_QUOTAS[plan];
    const keys = Object.keys(COLUMNS) as (keyof PlanQuotas)[];
    await database.query(
      `INSERT INTO plan_quota (plan, ${keys.map((key) => COLUMNS[key]).join(", ")})
       VALUES ($1, ${keys.map((_, index) => `$${index + 2}`).join(", ")})
       ON CONFLICT (plan) DO NOTHING`,
      [plan, ...keys.map((key) => quotas[key])],
    );
  }
}

type QuotaRow = Record<(typeof COLUMNS)[keyof PlanQuotas], unknown>;

const QUOTA_COLUMNS = Object.values(COLUMNS).join(", ");

/** The PlanError for a Plan form that does not parse: the first field at fault. */
function inputError(error: z.ZodError): PlanError {
  const field = error.issues[0]?.path[0];
  if (field === "key") return "invalid_key";
  if (field === "name") return "invalid_name";
  if (field === "status") return "invalid_status";
  if (field === "features") return "invalid_feature";
  return "not_a_product_id";
}

const PRODUCT_ID = /^prod_[A-Za-z0-9_]+$/;

/** The starting Plans first, in their order, then any other key: how env variables are named in a message. */
const byStartingOrder = (a: string, b: string) => {
  const order = Object.keys(STARTING_PLAN_QUOTAS);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  return rank(a) - rank(b) || a.localeCompare(b);
};

/**
 * Why Stripe refused, or did not answer, a Back Office write (#263): a 4xx is `stripe_refused`, anything
 * else `provider_unavailable`; Stripe's error code and message are the technical reason.
 */
export function stripeFailure(error: unknown): Failure {
  const stripeError = error instanceof Stripe.errors.StripeError ? error : null;
  const status = stripeError?.statusCode;
  const message = error instanceof Error ? error.message : String(error);
  return {
    reason: status !== undefined && status >= 400 && status < 500 ? "stripe_refused" : "provider_unavailable",
    technical: {
      class: stripeError?.type ?? (error instanceof Error ? error.name : "unknown"),
      provider: "stripe",
      ...(status === undefined ? {} : { status }),
      message: stripeError?.code ? `${stripeError.code}: ${message}` : message,
    },
  };
}

/** Why a product cannot be a Plan's; with `failure` when Stripe itself refused it or did not answer. */
export type StripeProductProblem = { error: PlanError; failure?: Failure };

/** For writes made in a transaction that already asked Stripe about the product (`checkStripeProduct`). */
export interface PlanWriteOptions {
  productChecked?: boolean;
}

/**
 * Runs a Plan write, answering a unique violation (a key, product or rank taken at the same
 * moment) with a PlanError rather than an error page. Inside a caller's transaction the
 * transaction is then aborted, so nothing of it is kept.
 */
async function uniquely<T>(write: () => Promise<PlanResult<T>>): Promise<PlanResult<T>> {
  try {
    return await write();
  } catch (error) {
    const violation = error as { code?: string; constraint?: string };
    if (violation.code !== "23505") throw error;
    if (violation.constraint === "plan_pkey") return { ok: false, error: "key_taken" };
    if (violation.constraint === "plan_stripe_product_id_key") return { ok: false, error: "product_taken" };
    return { ok: false, error: "conflict" };
  }
}

/** The id of a Stripe object field that may be expanded. */
const idOf = (value: string | { id: string } | null | undefined): string | null => (value ? (typeof value === "string" ? value : value.id) : null);

function quotasFromRow(row: QuotaRow): PlanQuotas {
  const quotas = { jobDigest: row.job_digest } as PlanQuotas;
  for (const quota of LIMITED_QUOTAS) quotas[quota] = row[COLUMNS[quota]] as number | null;
  return quotas;
}

/**
 * The answer to "may this Candidate do one more?". When refused, it names the
 * lowest-ranked offered Plan above theirs that would allow it (null when none does),
 * for the Upgrade Prompt, with both Plans' names.
 */
export type QuotaDecision =
  | { allowed: true; /** Left after this one; null when unlimited. */ remaining: number | null }
  | { allowed: false; quota: LimitedQuota; plan: Plan; planName: PlanName; limit: number; upgradeTo: Plan | null; upgradeToName: PlanName | null };

/** Why the Back Office could not create, change or move a Plan. */
export type PlanError =
  | "unknown_plan"
  | "invalid_key"
  | "key_taken"
  | "invalid_name"
  | "invalid_status"
  | "invalid_feature"
  /** Not a Stripe product ID (prod_…): a price ID, typically. */
  | "not_a_product_id"
  /** Another Plan is tied to that product. */
  | "product_taken"
  | "product_not_found"
  | "product_archived"
  /** The product has no default price charged once each day, week, month or year. */
  | "no_recurring_default_price"
  /** Stripe is not configured or could not be reached: the product cannot be checked. */
  | "stripe_unavailable"
  /** A paid Plan that is offered needs a product. */
  | "product_required"
  /** A paid Plan's product never changes once set: its subscribers stay on it (moving them is done in Stripe). */
  | "product_frozen"
  /** Another change to the Plans was saved at the same moment: try again. */
  | "conflict"
  /** Free cannot be hidden, moved or given a product. */
  | "free_plan_built_in"
  /** Nothing to swap with in that direction (or only Free). */
  | "cannot_move";

export type PlanResult<T> = ({ ok: true } & T) | { ok: false; error: PlanError };

/** A Stripe subscription's status, as Stripe last reported it (customer.subscription.* webhooks). */
export type SubscriptionStatus = Stripe.Subscription.Status;

/** Why a billing request could not be served. `message` is for logs, not for Candidates. */
export class BillingError extends Error {
  constructor(
    readonly code:
      | "stripe_not_configured"
      | "coaching_sessions_not_configured"
      | "no_checkout_for_free_plan"
      /** An unknown or hidden Plan, or one with no Stripe product yet. */
      | "plan_not_offered"
      | "invalid_webhook_signature",
    message: string = code,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/** Why a code a Candidate brought cannot be applied at Checkout. */
export type PromotionCodeRefusal =
  /** Not one of the Plans it is for. */
  | "not_for_plan"
  /** Stripe will not apply it for them: they have paid before (a first-payment-only code), or it was used up meanwhile. */
  | "not_for_you"
  /** Unknown, deactivated, expired or used up. */
  | "unavailable"
  /** Stripe could not be asked. */
  | "unchecked"
  /** They tried too many codes lately. */
  | "too_many_tries";

export const PROMOTION_CODE_REFUSALS = ["not_for_plan", "not_for_you", "unavailable", "unchecked", "too_many_tries"] as const satisfies readonly PromotionCodeRefusal[];

/** A code brought to Checkout that cannot be applied; nothing was sent to Checkout. */
export class PromotionCodeRefused extends Error {
  constructor(readonly reason: PromotionCodeRefusal) {
    super(`promotion code refused: ${reason}`);
    this.name = "PromotionCodeRefused";
  }
}

/** Stripe calls made while a page renders: given up on quickly, never retried. */
const QUICK: Stripe.RequestOptions = { timeout: 2_500, maxNetworkRetries: 0 };

/** Stripe writes made from the Back Office: given up on after a few seconds, retried once (with the same idempotency key). */
const STRIPE_WRITE: Stripe.RequestOptions = { timeout: 5_000, maxNetworkRetries: 1 };

/** The most Coupons the Back Office lists, read in pages of COUPON_PAGE (Stripe's largest). */
const MAX_COUPONS = 1_000;
const COUPON_PAGE = 100;

/** A promotion code's coupon and the Plans' products it applies to, expanded in one call. */
const PROMOTION_CODE_EXPAND = ["promotion.coupon.applies_to"];

/** Subscription statuses that keep the paid Plan; Stripe retries failed payments while past_due. */
const PAYING_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Subscription statuses only reached once Stripe has taken a first payment, so the customer portal holds an invoice. */
const CHARGED_STATUSES = ["active", "past_due", "unpaid", "paused"];

/**
 * How far along its life a subscription is, by status. Stripe stamps events in
 * whole seconds and does not guarantee their order, so two events of one
 * subscription often share a timestamp (a checkout's `created` (incomplete)
 * and `updated` (active)); the one further along is then the later state.
 * Statuses that move back and forth (active, past_due) share a stage.
 */
const STATUS_STAGES: Record<string, number> = {
  incomplete: 0,
  trialing: 1,
  active: 2,
  past_due: 2,
  unpaid: 2,
  paused: 2,
  canceled: 3,
  incomplete_expired: 3,
};
const stageOf = (status: string) => STATUS_STAGES[status] ?? 2;
const STORED_STAGE_SQL = `CASE stripe_status ${Object.entries(STATUS_STAGES)
  .map(([status, stage]) => `WHEN '${status}' THEN ${stage}`)
  .join(" ")} ELSE 2 END`;

/** How long after Stripe failed to give the Plan prices before asking it again. */
const PLAN_PRICE_RETRY_AFTER_MS = 60_000;

/** "2026-10-12": the Monday the week in France starts on (at 00:00, Paris time), which weekly quotas count by. */
export function weekInFrance(date: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function createBilling(config: BillingConfig) {
  const { database } = config;
  const now = config.now ?? (() => new Date());
  let stripeClient: Stripe | undefined;

  function stripe(): { client: Stripe; config: StripeConfig } {
    if (!config.stripe) throw new BillingError("stripe_not_configured");
    if (!stripeClient) {
      const api = config.stripe.apiUrl ? new URL(config.stripe.apiUrl) : undefined;
      const client = new Stripe(config.stripe.secretKey, {
        maxNetworkRetries: 2,
        ...(api && { host: api.hostname, port: api.port, protocol: api.protocol === "http:" ? "http" : "https" }),
      });
      stripeClient = config.externalApis ? recordingClient(client, config.externalApis, { provider: "stripe" }) : client;
    }
    return { client: stripeClient, config: config.stripe };
  }

  const pageURL = (query = "") => new URL(routes.subscription + query, config.baseURL).toString();
  const coachingPageURL = (query = "") => new URL(routes.coaching + query, config.baseURL).toString();

  /** The Coaching Session Prices, or a BillingError when Stripe or the Prices are not configured. */
  function coachingSessionPrices(): { regular: string; discounted: string } {
    const prices = stripe().config.coachingSessionPrices;
    if (!prices) throw new BillingError("coaching_sessions_not_configured");
    return prices;
  }

  /** Stripe Prices' amounts, kept a few minutes: Jobbbox sets them in Stripe and rarely changes them. */
  /** `interval` is set for a recurring Price charged once each interval (not every 3 months, say). */
  type StripeAmount = { amount: number; currency: string; interval: string | null; product: string };
  /** When Stripe last failed to give the Plan prices: pages render without them for a minute, without asking again. */
  let planPricesFailedAt: number | undefined;
  const priceCache = new Map<string, StripeAmount & { at: number }>();
  async function amountOf(priceId: string, options?: Stripe.RequestOptions): Promise<StripeAmount> {
    const cached = priceCache.get(priceId);
    if (cached && now().getTime() - cached.at < 10 * 60_000) return cached;
    return remember(await stripe().client.prices.retrieve(priceId, {}, options));
  }
  /** Keeps a Price Stripe gave, for `amountOf`. */
  function remember(price: Stripe.Price): StripeAmount {
    if (price.unit_amount === null) throw new Error(`Stripe Price ${price.id} has no fixed amount`);
    const fetched = { at: now().getTime(), amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval_count === 1 ? price.recurring.interval : null, product: productOf(price) };
    priceCache.set(price.id, fetched);
    return fetched;
  }

  /**
   * A paid Plan's subscription Price; it must recur once each day, week, month or year.
   * Read while a page renders, so a slow or hanging Stripe is given up on quickly
   * (the SDK otherwise waits 80 s per try, and tries 3 times).
   */
  async function subscriptionPrice(priceId: string): Promise<PlanPrice> {
    const { amount, currency, interval } = await amountOf(priceId, QUICK);
    if (!BILLING_INTERVALS.includes(interval as BillingInterval)) throw new Error(`Stripe Price ${priceId} is not charged once each day, week, month or year`);
    return { amount, currency, interval: interval as BillingInterval };
  }

  /** Stripe products' default Prices, kept a few minutes like the amounts. */
  const productCache = new Map<string, { at: number; defaultPrice: string | null }>();
  /**
   * The Price a paid Plan is sold at: its Stripe product's default Price. Asked in one call, the
   * Price expanded in the product, so a Stripe that never answers costs one short timeout, not two.
   */
  async function defaultPriceOf(product: string): Promise<string> {
    const cached = productCache.get(product);
    let defaultPrice = cached && now().getTime() - cached.at < 10 * 60_000 ? cached.defaultPrice : undefined;
    if (defaultPrice === undefined) {
      const fetched = await stripe().client.products.retrieve(product, { expand: ["default_price"] }, QUICK);
      defaultPrice = idOf(fetched.default_price);
      // A Price that is no fixed amount is left for subscriptionPrice to refuse.
      if (fetched.default_price && typeof fetched.default_price === "object" && fetched.default_price.unit_amount !== null) remember(fetched.default_price);
      productCache.set(product, { at: now().getTime(), defaultPrice });
    }
    if (!defaultPrice) throw new Error(`Stripe product ${product} has no default price`);
    return defaultPrice;
  }

  /**
   * Ties each paid Plan with no Stripe product yet to the product of its env Price
   * (STRIPE_PRICE_STANDARD, STRIPE_PRICE_PREMIUM): how the Plans sold before #206 find
   * their products. Once done it is not done again; if Stripe fails, it is tried again next time.
   */
  async function linkPlansToEnvPrices(): Promise<void> {
    const prices = config.stripe?.envPlanPrices;
    if (!prices) return;
    const plans = await listPlans(database);
    const unlinked = plans.filter((plan) => plan.key !== FREE_PLAN && !plan.stripeProductId && prices[plan.key]);
    if (unlinked.length === 0) return;
    // Every env Price's product, so two Plans sharing one is seen before either is tied to it.
    const products = new Map<Plan, string>();
    for (const [plan, price] of Object.entries(prices)) if (price) products.set(plan, (await amountOf(price, QUICK)).product);
    const envName = (plan: Plan) => `STRIPE_PRICE_${plan.toUpperCase()}`;
    for (const plan of unlinked) {
      const product = products.get(plan.key)!;
      const sharing = [...products].filter(([other, otherProduct]) => other !== plan.key && otherProduct === product).map(([other]) => other);
      if (sharing.length > 0) {
        console.warn(
          `[billing] ${[plan.key, ...sharing].sort(byStartingOrder).map(envName).join(" and ")} are prices of the same Stripe product ${product}: ` +
            `the ${plan.key} Plan is not tied to it, since a product is one Plan's. Each of those prices still follows its own Plan; ` +
            "give each Plan its own product in Stripe, then set it in the Back Office (Offres).",
        );
        continue;
      }
      const holder = plans.find((other) => other.stripeProductId === product);
      if (holder) {
        console.warn(
          `[billing] ${envName(plan.key)} is a price of Stripe product ${product}, already the ${holder.name.en} Plan's: the ${plan.key} Plan is not tied to it. ` +
            "Set its own product in the Back Office (Offres).",
        );
        continue;
      }
      await adoptProduct(database, plan.key, product);
    }
  }
  let linking: Promise<void> | undefined;
  function linked(): Promise<void> {
    linking ??= linkPlansToEnvPrices().catch((error: unknown) => {
      linking = undefined;
      throw error;
    });
    return linking;
  }
  /**
   * Links the Plans to their env Prices' products if not done yet, without failing what
   * needs it: a Plan with a product works whatever happens to an env Price (the database
   * wins), and one without is simply not sold yet.
   */
  async function linkedIfPossible(): Promise<void> {
    try {
      await linked();
    } catch (error) {
      console.error("[billing] could not tie the Plans to the products of STRIPE_PRICE_STANDARD / STRIPE_PRICE_PREMIUM", error);
    }
  }

  /**
   * Why Stripe will not let `product` be a Plan's, or null when it can: it exists, is active and has
   * a recurring default Price. Asked quickly, never retried: run it before any transaction opens.
   */
  async function stripeProductProblem(product: string): Promise<PlanError | null> {
    return (await stripeProductCheck(product))?.error ?? null;
  }

  /** As `stripeProductProblem`, with Stripe's own error when it refused the product or did not answer. */
  async function stripeProductCheck(product: string): Promise<StripeProductProblem | null> {
    const problem = (error: PlanError): StripeProductProblem => ({ error });
    if (!PRODUCT_ID.test(product)) return problem("not_a_product_id");
    if (!config.stripe) return problem("stripe_unavailable");
    try {
      const fetched = await stripe().client.products.retrieve(product, {}, QUICK);
      if (!fetched.active) return problem("product_archived");
      const priceId = idOf(fetched.default_price);
      if (!priceId) return problem("no_recurring_default_price");
      productCache.set(product, { at: now().getTime(), defaultPrice: priceId });
      priceCache.delete(priceId);
      const { interval } = await amountOf(priceId, QUICK);
      return BILLING_INTERVALS.includes(interval as BillingInterval) ? null : problem("no_recurring_default_price");
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return { error: "product_not_found", failure: stripeFailure(error) };
      if (error instanceof Error && /has no fixed amount/.test(error.message)) return problem("no_recurring_default_price");
      console.error("[billing] could not check a Stripe product", error);
      return { error: "stripe_unavailable", failure: stripeFailure(error) };
    }
  }

  /** Why `product` cannot be `key`'s: another Plan has it, or Stripe refuses it (unless `checked` says it was asked already). */
  async function productProblem(product: string, key: string, within: Queryable, checked: boolean): Promise<PlanError | null> {
    if (!PRODUCT_ID.test(product)) return "not_a_product_id";
    const { rows } = await within.query("SELECT 1 FROM plan WHERE stripe_product_id = $1 AND key <> $2", [product, key]);
    if (rows.length > 0) return "product_taken";
    return checked ? null : stripeProductProblem(product);
  }

  /**
   * The Coupon behind a code a Candidate brought (a shared link's `?code=`), if it can be redeemed now:
   * active, not expired, not used up. Null when it cannot; throws when Stripe does not answer quickly.
   */
  async function redeemableCoupon(code: string): Promise<Coupon | null> {
    const typed = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,40}$/.test(typed)) return null;
    const [listed, plans] = await Promise.all([
      stripe().client.promotionCodes.list({ code: typed, active: true, limit: 1, expand: PROMOTION_CODE_EXPAND.map((field) => `data.${field}`) }, QUICK),
      listPlans(database),
    ]);
    const listedCoupon = listed.data[0] && listedCouponOf(listed.data[0], plans, now());
    return listedCoupon && !("unreadable" in listedCoupon) && listedCoupon.active ? listedCoupon : null;
  }
  /** Codes brought by Candidates: each answer kept a minute, and each Candidate held to a few lookups. */
  const codeLookups = createCodeLookups({ lookup: redeemableCoupon, now });

  /**
   * The promotion code to apply at a Plan's Checkout for the code a Candidate brought; throws a
   * PromotionCodeRefused saying why it cannot be applied.
   */
  async function promotionCodeFor(code: string, plan: Plan, requester: string): Promise<string> {
    let found;
    try {
      found = await codeLookups.find(code.trim().toUpperCase(), requester);
    } catch (error) {
      console.error("[billing] could not check a promotion code", error);
      throw new PromotionCodeRefused("unchecked");
    }
    if (found.status === "throttled") throw new PromotionCodeRefused("too_many_tries");
    if (!found.value) throw new PromotionCodeRefused("unavailable");
    if (found.value.plans !== null && !found.value.plans.includes(plan)) throw new PromotionCodeRefused("not_for_plan");
    return found.value.id;
  }

  /** Reports a paid Coaching Session from a checkout.session.* event; ignores any other checkout. */
  async function applyCheckout(session: Stripe.Checkout.Session) {
    if (session.mode !== "payment" || session.metadata?.purpose !== "coaching_session") return;
    if (session.payment_status === "unpaid") return; // async payment methods: wait for async_payment_succeeded
    const candidateId = session.metadata.candidate_id ?? session.client_reference_id;
    const coachId = session.metadata.coach_id;
    if (!candidateId || !coachId) return;
    await config.onCoachingSessionPaid?.({
      checkoutSessionId: session.id,
      candidateId,
      coachId,
      amount: session.amount_total ?? 0,
      currency: session.currency ?? "eur",
    });
  }

  async function stripeAccountOf(candidateId: string) {
    const { rows } = await database.query(
      "SELECT plan, stripe_customer_id, stripe_subscription_id, stripe_status, ends_at FROM candidate_plan WHERE candidate_id = $1",
      [candidateId],
    );
    return rows[0] as { plan: Plan; stripe_customer_id: string | null; stripe_subscription_id: string | null; stripe_status: string | null; ends_at: Date | null } | undefined;
  }

  /** The Candidate's Stripe customer, created on their first checkout. */
  async function stripeCustomerFor(candidate: { id: string; email: string }): Promise<string> {
    const existing = (await stripeAccountOf(candidate.id))?.stripe_customer_id;
    if (existing) return existing;
    const customer = await stripe().client.customers.create(
      { email: candidate.email, metadata: { candidate_id: candidate.id } },
      // Two clicks in a row get the same customer back from Stripe.
      { idempotencyKey: `candidate-customer-${candidate.id}` },
    );
    const { rows } = await database.query(
      `INSERT INTO candidate_plan (candidate_id, plan, stripe_customer_id) VALUES ($1, 'free', $2)
       ON CONFLICT (candidate_id) DO UPDATE SET stripe_customer_id = COALESCE(candidate_plan.stripe_customer_id, $2)
       RETURNING stripe_customer_id`,
      [candidate.id, customer.id],
    );
    return rows[0].stripe_customer_id as string;
  }

  async function portalFor(customer: string, locale: Locale): Promise<string> {
    const session = await stripe().client.billingPortal.sessions.create({ customer, return_url: pageURL(), locale });
    return session.url;
  }

  /**
   * When a still-paying subscription is due to end: the date Stripe set (`cancel_at`), else the
   * end of the paid period when cancelled at period end. Since API version 2025-03-31.basil that
   * period end is on the subscription item, not the subscription. Null when it simply renews.
   */
  function scheduledEndOf(subscription: Stripe.Subscription): number | null {
    if (subscription.cancel_at) return subscription.cancel_at;
    if (!subscription.cancel_at_period_end) return null;
    return periodEndOf(subscription);
  }

  /** When the subscription's paid period ends. */
  function periodEndOf(subscription: Stripe.Subscription): number | null {
    // A webhook endpoint pinned to an older API version still has it on the subscription.
    const legacy = (subscription as { current_period_end?: number }).current_period_end;
    return subscription.items.data[0]?.current_period_end ?? legacy ?? null;
  }

  /** The Candidate's subscription, when they are on a paid Plan whose cancellation is not scheduled. */
  const cancellable = (account: { plan: Plan; stripe_subscription_id: string | null; ends_at: Date | null } | undefined) =>
    account && account.plan !== FREE_PLAN && account.stripe_subscription_id && !account.ends_at ? account.stripe_subscription_id : null;

  function productOf(price: Stripe.Price): string {
    return typeof price.product === "string" ? price.product : price.product.id;
  }

  /**
   * The paid Plan a subscription Price belongs to: the Plan tied to the Price's Stripe product,
   * whichever Price of it this is (the default one, an archived older amount, another interval
   * switched to in the portal), offered or hidden.
   */
  async function paidPlanOf(price: Stripe.Price | undefined): Promise<Plan | undefined> {
    if (!price) return undefined;
    // An env Price names its Plan exactly, whatever product it is on (STRIPE_PRICE_STANDARD / _PREMIUM sharing one, say).
    const envPlan = Object.entries(config.stripe?.envPlanPrices ?? {}).find(([, envPrice]) => envPrice === price.id)?.[0];
    if (envPlan && (await findPlan(database, envPlan))) return envPlan;
    const planOfProduct = async () =>
      (await database.query("SELECT key FROM plan WHERE stripe_product_id = $1 AND key <> $2", [productOf(price), FREE_PLAN])).rows[0]?.key as Plan | undefined;
    const known = await planOfProduct();
    if (known) return known;
    // Before the startup link to the env Prices' products is done, a starting Plan's subscriber is not lost.
    await linkedIfPossible();
    return planOfProduct();
  }

  /** Applies a customer.subscription.* event: the Plan follows the subscription's product, status and scheduled end. */
  async function applySubscription(event: Stripe.Event, subscription: Stripe.Subscription) {
    const paidPlan = await paidPlanOf(subscription.items.data[0]?.price);
    if (!paidPlan) return; // Not one of our Plans' prices.
    const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    // Past due with no card to retry (a 100 % Coupon's free period over): nothing will be paid, so no Plan is kept meanwhile.
    const cardless = subscription.status === "past_due" && !subscription.default_payment_method && !subscription.default_source;
    const ended = event.type === "customer.subscription.deleted" || !PAYING_STATUSES.has(subscription.status) || cardless;
    if (CHARGED_STATUSES.includes(subscription.status)) {
      // Whatever order Stripe delivers events in, a payment once taken stays taken.
      await database.query("UPDATE candidate_plan SET charged = true WHERE stripe_customer_id = $1", [customer]);
    }
    await database.query(
      `UPDATE candidate_plan
       SET plan = $2, stripe_subscription_id = $3, stripe_status = $4, stripe_event_at = to_timestamp($5), ends_at = to_timestamp($8),
           -- a report without its start keeps the one known for the same subscription
           subscription_started_at = COALESCE(to_timestamp($9::double precision), CASE WHEN stripe_subscription_id IS NOT DISTINCT FROM $3 THEN subscription_started_at END)
       WHERE stripe_customer_id = $1
         AND (
           stripe_event_at IS NULL
           OR stripe_event_at < to_timestamp($5)
           -- same second: keep whichever state of the subscription is further along
           OR (stripe_event_at = to_timestamp($5)
               AND (stripe_subscription_id IS DISTINCT FROM $3 OR ${STORED_STAGE_SQL} <= $7))
         )
         -- the end of an older subscription does not end the current one
         AND NOT ($6 AND stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> $3)`,
      [
        customer,
        ended ? FREE_PLAN : paidPlan,
        subscription.id,
        subscription.status,
        event.created,
        ended,
        event.type === "customer.subscription.deleted" ? STATUS_STAGES.canceled : stageOf(subscription.status),
        ended ? null : scheduledEndOf(subscription),
        // A webhook endpoint pinned to an older API version may leave it out.
        (subscription as { start_date?: number }).start_date ?? null,
      ],
    );
  }

  /**
   * What the signed webhook does with each event it acts on: one handler for each of STRIPE_WEBHOOK_EVENTS, the list
   * the setup instructions give the operator, so no handler waits for an event the destination was never subscribed to.
   */
  const webhookHandlers: { [Type in StripeWebhookEvent]: (event: Extract<Stripe.Event, { type: Type }>) => Promise<void> } = {
    "customer.subscription.created": (event) => applySubscription(event, event.data.object),
    "customer.subscription.updated": (event) => applySubscription(event, event.data.object),
    "customer.subscription.deleted": (event) => applySubscription(event, event.data.object),
    "checkout.session.completed": (event) => applyCheckout(event.data.object),
    "checkout.session.async_payment_succeeded": (event) => applyCheckout(event.data.object),
    "refund.updated": (event) => applyRefund(event.data.object),
    "refund.failed": (event) => applyRefund(event.data.object),
  };

  async function applyRefund(refund: Stripe.Refund) {
    await config.onRefundChanged?.({ id: refund.id, status: refund.status as RefundStatus, failureReason: refund.failure_reason ?? null });
  }

  /** Each payment taken on a subscription's paid invoices; an invoice a 100 % code left at 0 took none. */
  async function paymentsOn(subscriptionId: string, options: Stripe.RequestOptions = STRIPE_WRITE): Promise<Payment[]> {
    const invoices = await stripe()
      .client.invoices.list({ subscription: subscriptionId, status: "paid", limit: 100, expand: ["data.payments"] }, options)
      .autoPagingToArray({ limit: 1_000 });
    return invoices.flatMap((invoice) =>
      (invoice.payments?.data ?? []).flatMap((paid) => {
        const id = idOf(paid.payment.payment_intent) ?? idOf(paid.payment.charge);
        const amount = paid.amount_paid ?? 0;
        return paid.status === "paid" && id && amount > 0 ? [{ id, amount, currency: paid.currency }] : [];
      }),
    );
  }

  /**
   * Refunds the part of a subscription's latest paid period still to run at `at`, prorata of its length, on the
   * payment that paid it. `key` makes Stripe refund once however often it is asked.
   */
  async function prorataRefund(subscriptionId: string, key: string, at: Date): Promise<ProrataRefundResult> {
    let due: { amount: number; currency: string } | null = null;
    try {
      const { client } = stripe();
      const subscription = await client.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payments"] }, STRIPE_WRITE);
      const invoice = subscription.latest_invoice;
      if (!invoice || typeof invoice === "string") return { ok: true, refund: null };
      const period = invoice.lines.data[0]?.period;
      const payment = invoice.payments?.data.find((each) => each.status === "paid")?.payment.payment_intent;
      const paymentIntent = typeof payment === "string" ? payment : payment?.id;
      if (!period || !paymentIntent || invoice.amount_paid <= 0 || period.end <= period.start) return { ok: true, refund: null };
      const unused = Math.min(1, Math.max(0, (period.end * 1000 - at.getTime()) / ((period.end - period.start) * 1000)));
      const amount = Math.round(invoice.amount_paid * unused);
      if (amount <= 0) return { ok: true, refund: null };
      due = { amount, currency: invoice.currency };
      const refund = await client.refunds.create(
        { payment_intent: paymentIntent, amount, metadata: { purpose: "plan_quota_reduction", subscription: subscriptionId } },
        { ...STRIPE_WRITE, idempotencyKey: key },
      );
      return { ok: true, refund: { id: refund.id, amount: refund.amount, currency: refund.currency } };
    } catch (error) {
      console.error("[billing] could not refund a subscription prorata", error);
      const reason = error instanceof Stripe.errors.StripeInvalidRequestError ? (error.code ?? "stripe_refused") : "stripe_unavailable";
      return { ok: false, reason, subscription: subscriptionId, due };
    }
  }

  async function planOf(candidateId: string): Promise<Plan> {
    const { rows } = await database.query("SELECT plan FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
    return (rows[0]?.plan as Plan | undefined) ?? FREE_PLAN;
  }

  async function quotasOf(plan: Plan): Promise<PlanQuotas> {
    const { rows } = await database.query("SELECT * FROM plan_quota WHERE plan = $1", [plan]);
    return quotasFromRow(rows[0]);
  }

  /** Whether the Candidate's Plan has a Plan Feature. */
  async function hasFeature(candidateId: string, feature: PlanFeature): Promise<boolean> {
    return (await findPlan(database, await planOf(candidateId)))?.features.includes(feature) ?? false;
  }

  /** Every Plan's quotas, lowest rank first. */
  async function allPlanQuotas(): Promise<Record<Plan, PlanQuotas>> {
    const { rows } = await database.query("SELECT q.* FROM plan_quota q JOIN plan p ON p.key = q.plan ORDER BY p.rank");
    return Object.fromEntries(rows.map((row) => [row.plan as Plan, quotasFromRow(row)]));
  }

  /** The lowest-ranked offered Plan above `plan` whose quotas `allow` what was asked; null when none. */
  async function upgradeFor(plan: Plan, allow: (quotas: PlanQuotas) => boolean): Promise<PlanDefinition | null> {
    const [plans, quotas] = await Promise.all([listPlans(database), allPlanQuotas()]);
    const rank = plans.find((candidate) => candidate.key === plan)?.rank ?? 0;
    return plans.find((higher) => higher.status === "offered" && higher.rank > rank && quotas[higher.key] !== undefined && allow(quotas[higher.key]!)) ?? null;
  }

  async function nameOf(plan: Plan): Promise<PlanName> {
    return (await findPlan(database, plan))?.name ?? { fr: plan, en: plan };
  }

  async function refusal(plan: Plan, quota: LimitedQuota, limit: number): Promise<QuotaDecision> {
    const [upgrade, planName] = await Promise.all([
      upgradeFor(plan, (quotas) => quotas[quota] === null || quotas[quota]! > limit),
      nameOf(plan),
    ]);
    return { allowed: false, quota, plan, planName, limit, upgradeTo: upgrade?.key ?? null, upgradeToName: upgrade?.name ?? null };
  }

  return {
    /**
     * Records one use of a weekly quota (a Match Score, an ATS Score, an
     * Enriched Contact, a Job Search) if the Candidate's Plan allows it this week. Call it
     * before doing the work; nothing is recorded when refused. Safe under
     * concurrent requests.
     */
    async use(candidateId: string, quota: WeeklyQuota): Promise<QuotaDecision> {
      const plan = await planOf(candidateId);
      const limit = (await quotasOf(plan))[quota];
      const week = weekInFrance(now());
      if (limit !== null && limit <= 0) return refusal(plan, quota, limit);
      const { rows } = await database.query(
        `INSERT INTO quota_usage (candidate_id, quota, week, used) VALUES ($1, $2, $3, 1)
         ON CONFLICT (candidate_id, quota, week) DO UPDATE SET used = quota_usage.used + 1
         WHERE $4::integer IS NULL OR quota_usage.used < $4::integer
         RETURNING used`,
        [candidateId, quota, week, limit],
      );
      if (rows.length === 0) return refusal(plan, quota, limit!);
      return { allowed: true, remaining: limit === null ? null : limit - (rows[0].used as number) };
    },

    /**
     * Closes the Candidate's billing before their account is deleted (ADR-0010):
     * deletes their Stripe customer, which cancels any subscription at once, so
     * they are never charged again. Nothing to do for a Candidate who never went
     * to Stripe; a customer Stripe no longer has counts as closed. Throws if
     * Stripe could not be reached, so the account is not deleted while still paying.
     */
    async closeAccount(candidateId: string): Promise<void> {
      const customer = (await stripeAccountOf(candidateId))?.stripe_customer_id;
      if (!customer) return;
      try {
        await stripe().client.customers.del(customer);
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return;
        throw error;
      }
    },

    /**
     * What « Résilier votre contrat » would cancel (#513): the Candidate's paid Plan and the end of its paid period,
     * read from Stripe. Null on Free, once a cancellation is scheduled (here or in the customer portal), and for a
     * subscription Stripe gives no period end for. Throws when Stripe cannot be reached.
     */
    async cancellationTerms(candidateId: string): Promise<CancellationTerms | null> {
      const account = await stripeAccountOf(candidateId);
      const subscriptionId = cancellable(account);
      if (!account || !subscriptionId) return null;
      const subscription = await stripe().client.subscriptions.retrieve(subscriptionId);
      const end = subscription.cancel_at || subscription.cancel_at_period_end ? null : periodEndOf(subscription);
      return end === null ? null : { plan: account.plan, planName: await nameOf(account.plan), endsAt: new Date(end * 1000) };
    },

    /**
     * « Confirmer la résiliation » (#513, C. conso. L215-1-1): schedules the cancellation of the Candidate's paid Plan
     * in Stripe at the end of the paid period (`cancel_at_period_end`), keeps its end date at once (Stripe's webhook
     * then reports the same), and emails the acknowledgement D215-2 asks for: when the request was received, when the
     * contract ends. The Candidate's row is locked meanwhile, each Stripe call bounded to a few seconds, so a cancellation
     * confirmed twice is scheduled and acknowledged once; one already scheduled in the customer portal, its webhook not
     * arrived yet, is left as Stripe has it. Throws when Stripe could not schedule it; a failed email does not undo it.
     */
    async scheduleCancellation(candidate: { id: string; email: string }, locale: Locale = "fr"): Promise<CancellationResult> {
      const requestedAt = now();
      const client = await database.connect();
      let scheduled: { plan: Plan; endsAt: Date };
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT plan, stripe_subscription_id, ends_at FROM candidate_plan WHERE candidate_id = $1 FOR UPDATE", [candidate.id]);
        const account = rows[0] as { plan: Plan; stripe_subscription_id: string | null; ends_at: Date | null } | undefined;
        const subscriptionId = cancellable(account);
        if (!account || !subscriptionId) {
          await client.query("ROLLBACK");
          return { ok: false, error: "not_cancellable" };
        }
        // Scheduled already in the customer portal, its webhook not here yet: keep Stripe's date, change nothing there.
        const current = await stripe().client.subscriptions.retrieve(subscriptionId, {}, STRIPE_WRITE);
        const scheduledEnd = scheduledEndOf(current);
        if (scheduledEnd !== null) {
          await client.query("UPDATE candidate_plan SET ends_at = to_timestamp($2) WHERE candidate_id = $1", [candidate.id, scheduledEnd]);
          await client.query("COMMIT");
          return { ok: false, error: "not_cancellable" };
        }
        const subscription = await stripe().client.subscriptions.update(subscriptionId, { cancel_at_period_end: true }, STRIPE_WRITE);
        const end = scheduledEndOf(subscription);
        if (end === null) throw new Error(`Stripe gave no end date for the cancellation of ${subscriptionId}`);
        await client.query("UPDATE candidate_plan SET ends_at = to_timestamp($2) WHERE candidate_id = $1", [candidate.id, end]);
        await client.query("COMMIT");
        scheduled = { plan: account.plan, endsAt: new Date(end * 1000) };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      let acknowledged = false;
      if (config.mailer) {
        try {
          const names = { plan: await nameOf(scheduled.plan), free: await nameOf(FREE_PLAN) };
          const email = cancellationReceiptEmail({ planName: names.plan[locale], freePlanName: names.free[locale], requestedAt, endsAt: scheduled.endsAt, subscriptionUrl: pageURL() }, locale);
          await config.mailer.send({ to: candidate.email, ...email });
          acknowledged = true;
        } catch (error) {
          console.error("[billing] the acknowledgement of a cancellation could not be sent", error);
        }
      }
      return { ok: true, ...scheduled, requestedAt, acknowledged };
    },

    /**
     * Ends the Candidate's subscription at once, over a Quota Reduction they were told of (#514, L224-25-26): cancelled
     * in Stripe now, the Candidate on Free here without waiting for the webhook, and the part of the paid period not used
     * refunded (see ProrataRefundResult). `key` makes Stripe refund once. Null when they have no subscription to end.
     * Throws when Stripe could not cancel it: nothing has changed then.
     */
    async endSubscriptionWithProrataRefund(candidateId: string, key: string): Promise<ProrataRefundResult | null> {
      const { rows } = await database.query("SELECT plan, stripe_subscription_id FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
      const account = rows[0] as { plan: Plan; stripe_subscription_id: string | null } | undefined;
      if (!account?.stripe_subscription_id || account.plan === FREE_PLAN) return null;
      const subscriptionId = account.stripe_subscription_id;
      const at = now();
      try {
        await stripe().client.subscriptions.cancel(subscriptionId, { cancellation_details: { comment: "plan_quota_reduction" } }, STRIPE_WRITE);
      } catch (error) {
        // Already cancelled (a second click, Stripe's own cancellation): what was to be done is done.
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing")) throw error;
      }
      // Stamped now, so a report of the subscription Stripe sent before does not bring the Plan back.
      await database.query(
        `UPDATE candidate_plan SET plan = $3, stripe_status = 'canceled', ends_at = NULL, stripe_event_at = GREATEST(stripe_event_at, $4)
         WHERE candidate_id = $1 AND stripe_subscription_id = $2`,
        [candidateId, subscriptionId, FREE_PLAN, at],
      );
      return prorataRefund(subscriptionId, key, at);
    },

    /** Asks again for the prorata refund of a subscription ended at `at` whose refund was not made; same `key`, same refund. */
    retryProrataRefund(subscriptionId: string, key: string, at: Date): Promise<ProrataRefundResult> {
      return prorataRefund(subscriptionId, key, at);
    },

    /** The Candidates paying for `plan` now (Stripe reports their subscription active, trialing or past due); none on Free. */
    async subscribersOf(plan: Plan, within: Queryable = database): Promise<string[]> {
      if (plan === FREE_PLAN) return [];
      const { rows } = await within.query<{ candidate_id: string }>(
        `SELECT candidate_id FROM candidate_plan WHERE plan = $1 AND stripe_status IN (${[...PAYING_STATUSES].map((status) => `'${status}'`).join(", ")}) ORDER BY candidate_id`,
        [plan],
      );
      return rows.map((row) => row.candidate_id);
    },

    /**
     * Whether `use` would allow one more of a weekly quota now. Records nothing:
     * for asking before work whose cost is only known once done (see `release`).
     */
    async allows(candidateId: string, quota: WeeklyQuota): Promise<QuotaDecision> {
      const plan = await planOf(candidateId);
      const limit = (await quotasOf(plan))[quota];
      if (limit === null) return { allowed: true, remaining: null };
      const { rows } = await database.query("SELECT used FROM quota_usage WHERE candidate_id = $1 AND quota = $2 AND week = $3", [
        candidateId,
        quota,
        weekInFrance(now()),
      ]);
      const used = (rows[0]?.used as number | undefined) ?? 0;
      if (used >= limit) return refusal(plan, quota, limit);
      return { allowed: true, remaining: limit - used - 1 };
    },

    /** Gives back one use recorded this week by `use` whose work could not be done. Never below zero. */
    async release(candidateId: string, quota: WeeklyQuota): Promise<void> {
      await database.query("UPDATE quota_usage SET used = used - 1 WHERE candidate_id = $1 AND quota = $2 AND week = $3 AND used > 0", [
        candidateId,
        quota,
        weekInFrance(now()),
      ]);
    },

    /**
     * Back Office: forgets this week's uses of every Candidate, so each starts the week
     * again from nothing. Earlier weeks stay as history. Says which week, and how many Candidates had any.
     */
    async resetWeeklyUsage(within: Queryable = database): Promise<{ week: string; candidates: number }> {
      const week = weekInFrance(now());
      const { rows } = await within.query<{ candidates: number }>(
        `WITH reset AS (DELETE FROM quota_usage WHERE week = $1 RETURNING candidate_id)
         SELECT count(DISTINCT candidate_id)::integer AS candidates FROM reset`,
        [week],
      );
      return { week, candidates: rows[0]?.candidates ?? 0 };
    },

    /**
     * Whether a Candidate who already holds `held` of something (Profiles) may
     * create one more. Records nothing: what they hold is the count.
     */
    async allowsAnother(candidateId: string, quota: "profiles", held: number): Promise<QuotaDecision> {
      const plan = await planOf(candidateId);
      const limit = (await quotasOf(plan))[quota];
      if (limit === null) return { allowed: true, remaining: null };
      if (held >= limit) return refusal(plan, quota, limit);
      return { allowed: true, remaining: limit - held - 1 };
    },

    /**
     * Where to send a Candidate who chose a paid Plan: a Stripe Checkout for
     * its subscription, or the customer portal if they already pay (Plans are
     * switched there, never by a second subscription). A code they brought is
     * applied, or refused with a PromotionCodeRefused saying why: never dropped
     * silently, so they choose whether to go on without it.
     */
    async startCheckout(candidate: { id: string; email: string }, plan: Plan, locale: Locale = "fr", options: CheckoutOptions = {}): Promise<string> {
      if (plan === FREE_PLAN) throw new BillingError("no_checkout_for_free_plan");
      const { client } = stripe();
      await linkedIfPossible();
      const chosen = await findPlan(database, plan);
      if (!chosen || chosen.status !== "offered" || !chosen.stripeProductId) throw new BillingError("plan_not_offered", `Plan ${plan} is not offered`);
      const customer = await stripeCustomerFor(candidate);
      const account = await stripeAccountOf(candidate.id);
      if (account && account.plan !== FREE_PLAN && PAYING_STATUSES.has(account.stripe_status ?? "")) {
        return portalFor(customer, locale);
      }
      const promotionCode = options.promotionCode ? await promotionCodeFor(options.promotionCode, plan, candidate.id) : null;
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        customer,
        client_reference_id: candidate.id,
        line_items: [{ price: await defaultPriceOf(chosen.stripeProductId), quantity: 1 }],
        // A 100 % Coupon needs no card: Stripe asks for one only when something is due.
        payment_method_collection: "if_required",
        locale,
        success_url: pageURL("?checkout=success"),
        cancel_url: pageURL(),
      };
      // Stripe takes either a code applied up front or the field to type one, never both.
      const withCodeField = { ...params, allow_promotion_codes: true };
      let session: Stripe.Checkout.Session;
      if (promotionCode) {
        try {
          session = await client.checkout.sessions.create({ ...params, discounts: [{ promotion_code: promotionCode }] });
        } catch (error) {
          // A code Stripe will not apply for this customer (they have paid before, it was used up meanwhile):
          // the Candidate is told, and chooses whether to go on without it.
          if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
          console.warn("[billing] Stripe refused a promotion code at checkout:", error.message);
          throw new PromotionCodeRefused("not_for_you");
        }
      } else {
        session = await client.checkout.sessions.create(withCodeField);
      }
      if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
      return session.url;
    },

    /**
     * What a code a Candidate (`requester`, their id) brought in a shared link (`?code=`) gives, for the
     * subscription page: `valid` with its Coupon when it can be redeemed now (on `coupon.plans`), `invalid`
     * when not (unknown, deactivated, expired, used up), `throttled` when they tried too many codes lately.
     * Null when Stripe is not configured or does not answer quickly. Answers are kept a minute per code.
     */
    async checkPromotionCode(code: string, requester: string): Promise<{ status: "valid"; coupon: Coupon } | { status: "invalid" } | { status: "throttled" } | null> {
      if (!config.stripe) return null;
      try {
        const found = await codeLookups.find(code.trim().toUpperCase(), requester);
        if (found.status === "throttled") return found;
        return found.value ? { status: "valid", coupon: found.value } : { status: "invalid" };
      } catch (error) {
        console.error("[billing] could not check a promotion code", error);
        return null;
      }
    },

    /**
     * The discount the Candidate's subscription is getting from a Coupon, for the subscription page;
     * null on Free, without one, or when Stripe does not answer quickly.
     */
    async activeDiscount(candidateId: string): Promise<ActiveDiscount | null> {
      if (!config.stripe) return null;
      const { rows } = await database.query("SELECT plan, stripe_subscription_id FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
      const account = rows[0] as { plan: Plan; stripe_subscription_id: string | null } | undefined;
      if (!account?.stripe_subscription_id || account.plan === FREE_PLAN) return null;
      try {
        const subscription = await stripe().client.subscriptions.retrieve(account.stripe_subscription_id, { expand: ["discounts.source.coupon"] }, QUICK);
        for (const discount of subscription.discounts) {
          const coupon = typeof discount === "object" ? discount.source.coupon : null;
          if (!coupon || typeof coupon === "string" || typeof discount === "string") continue;
          if (discount.end !== null && discount.end * 1000 <= now().getTime()) continue;
          return { ...termsOf(coupon), endsAt: discount.end === null ? null : new Date(discount.end * 1000) };
        }
        return null;
      } catch (error) {
        console.error("[billing] could not read the subscription's discount from Stripe", error);
        return null;
      }
    },

    /** What a Coaching Session costs the Candidate on their Plan, or null when Coaching Sessions cannot be paid yet. */
    async coachingSessionPrice(candidateId: string): Promise<CoachingSessionPrice | null> {
      if (!config.stripe?.coachingSessionPrices) return null;
      const prices = coachingSessionPrices();
      const plan = await planOf(candidateId);
      const definition = await findPlan(database, plan);
      const discounted = definition?.features.includes("coachingSessionDiscount") ?? false;
      const regular = await amountOf(prices.regular);
      const charged = discounted ? await amountOf(prices.discounted) : regular;
      return { amount: charged.amount, currency: charged.currency, regularAmount: regular.amount, planName: definition?.name ?? { fr: plan, en: plan } };
    },

    /**
     * Where to send a Candidate who books a Coaching Session with a Human Coach: a one-off
     * Stripe Checkout at their Plan's Coaching Session Price (discounted on a Plan with the
     * Coaching Session discount). The
     * Coaching Session exists only once the signed webhook confirms the payment.
     * Throws a BillingError("coaching_sessions_not_configured") without the Prices.
     */
    async startCoachingSessionCheckout(candidate: { id: string; email: string }, coachId: string, locale: Locale = "fr"): Promise<string> {
      const prices = coachingSessionPrices();
      const customer = await stripeCustomerFor(candidate);
      const discounted = await hasFeature(candidate.id, "coachingSessionDiscount");
      const session = await stripe().client.checkout.sessions.create({
        mode: "payment",
        customer,
        client_reference_id: candidate.id,
        line_items: [{ price: discounted ? prices.discounted : prices.regular, quantity: 1 }],
        metadata: { purpose: "coaching_session", coach_id: coachId, candidate_id: candidate.id },
        locale,
        success_url: coachingPageURL("?session=paid"),
        cancel_url: coachingPageURL(),
      });
      if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
      return session.url;
    },

    /** The Stripe customer portal (invoices, payment method, change or cancel Plan), or null if they never subscribed. */
    async openCustomerPortal(candidateId: string, locale: Locale = "fr"): Promise<string | null> {
      const customer = (await stripeAccountOf(candidateId))?.stripe_customer_id;
      return customer ? portalFor(customer, locale) : null;
    },

    /**
     * Whether the Candidate has invoices to download from the Stripe customer
     * portal: they pay for a Plan, or Stripe once charged them for one.
     */
    async hasInvoices(candidateId: string): Promise<boolean> {
      const { rows } = await database.query("SELECT plan, charged FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
      const account = rows[0] as { plan: Plan; charged: boolean } | undefined;
      return account !== undefined && (account.plan !== FREE_PLAN || account.charged);
    },

    /**
     * Applies a webhook delivery from Stripe (raw body and Stripe-Signature
     * header). Throws a BillingError for a bad signature; ignores events it has
     * no use for. Idempotent, and tolerant of out-of-order delivery.
     */
    async handleStripeWebhook(payload: string, signature: string): Promise<void> {
      const { client, config: stripeConfig } = stripe();
      let event: Stripe.Event;
      try {
        event = client.webhooks.constructEvent(payload, signature, stripeConfig.webhookSecret);
      } catch (error) {
        throw new BillingError("invalid_webhook_signature", error instanceof Error ? error.message : undefined);
      }
      if (!Object.hasOwn(webhookHandlers, event.type)) return;
      await (webhookHandlers[event.type as StripeWebhookEvent] as (event: Stripe.Event) => Promise<void>)(event);
    },

    /**
     * The Candidate's paid subscription, with when Stripe started it: a Plan changed in the customer portal keeps
     * it (no new contract). Null on Free. A subscription reported before its start was kept is asked of Stripe once;
     * null when Stripe cannot tell.
     */
    async subscription(candidateId: string): Promise<CurrentSubscription | null> {
      const { rows } = await database.query(
        "SELECT plan, stripe_subscription_id, stripe_status, subscription_started_at FROM candidate_plan WHERE candidate_id = $1",
        [candidateId],
      );
      const account = rows[0] as { plan: Plan; stripe_subscription_id: string | null; stripe_status: string | null; subscription_started_at: Date | null } | undefined;
      if (!account?.stripe_subscription_id || account.plan === FREE_PLAN) return null;
      let startedAt = account.subscription_started_at;
      if (!startedAt && config.stripe) {
        try {
          const started = (await stripe().client.subscriptions.retrieve(account.stripe_subscription_id, {}, QUICK)).start_date;
          if (started) {
            startedAt = new Date(started * 1000);
            await database.query("UPDATE candidate_plan SET subscription_started_at = $3 WHERE candidate_id = $1 AND stripe_subscription_id = $2", [
              candidateId,
              account.stripe_subscription_id,
              startedAt,
            ]);
          }
        } catch (error) {
          console.error("[billing] could not ask Stripe when a subscription started", error);
        }
      }
      if (!startedAt) return null;
      return { id: account.stripe_subscription_id, plan: account.plan, planName: await nameOf(account.plan), startedAt };
    },

    /**
     * What was paid so far on the Candidate's subscription (each payment), for the Withdrawal form; null on Free, or when
     * Stripe does not answer quickly.
     */
    async paidOnSubscription(candidateId: string): Promise<Payment[] | null> {
      const { rows } = await database.query("SELECT plan, stripe_subscription_id FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
      const account = rows[0] as { plan: Plan; stripe_subscription_id: string | null } | undefined;
      if (!account?.stripe_subscription_id || account.plan === FREE_PLAN || !config.stripe) return null;
      try {
        return await paymentsOn(account.stripe_subscription_id, QUICK);
      } catch (error) {
        console.error("[billing] could not read what was paid on a subscription", error);
        return null;
      }
    },

    /**
     * Ends the Candidate's subscription at once (a Withdrawal, #511): cancelled in Stripe now, not at the end of the
     * period, without proration or final invoice, and the Candidate on Free here without waiting for the webhook.
     * Returns each payment taken on it, for a full refund (none for a subscription a 100 % code made free); null when
     * they have none to end. Throws when Stripe could not be reached: nothing has changed then.
     */
    async endSubscriptionNow(candidateId: string): Promise<Payment[] | null> {
      const { rows } = await database.query("SELECT plan, stripe_subscription_id FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
      const account = rows[0] as { plan: Plan; stripe_subscription_id: string | null } | undefined;
      if (!account?.stripe_subscription_id || account.plan === FREE_PLAN) return null;
      const subscriptionId = account.stripe_subscription_id;
      const payments = await paymentsOn(subscriptionId);
      try {
        await stripe().client.subscriptions.cancel(subscriptionId, { cancellation_details: { comment: "withdrawal" } }, STRIPE_WRITE);
      } catch (error) {
        // Already cancelled (a second click, Stripe's own cancellation): what was to be done is done.
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing")) throw error;
      }
      // Stamped now, so a report of the subscription Stripe sent before does not bring the Plan back.
      await database.query(
        `UPDATE candidate_plan SET plan = $3, stripe_status = 'canceled', ends_at = NULL, stripe_event_at = GREATEST(stripe_event_at, $4)
         WHERE candidate_id = $1 AND stripe_subscription_id = $2`,
        [candidateId, subscriptionId, FREE_PLAN, now()],
      );
      return payments;
    },

    /** What a Coaching Session was paid with, from its Checkout Session; null when it took no payment. Throws when Stripe could not be reached. */
    async coachingSessionPayment(checkoutSessionId: string): Promise<Payment | null> {
      const session = await stripe().client.checkout.sessions.retrieve(checkoutSessionId, {}, STRIPE_WRITE);
      const id = idOf(session.payment_intent);
      return id && session.amount_total ? { id, amount: session.amount_total, currency: session.currency ?? "eur" } : null;
    },

    /**
     * Refunds a payment in full (`requested_by_customer`), with `metadata` to find it again. `key` is the request's
     * idempotency key: asked again with it (within Stripe's 24 hours), the same refund is answered, never a second one.
     * Stripe's refusal, or no answer, is a result, not an error.
     */
    async refund(payment: Payment, key: string, metadata: Record<string, string>): Promise<RefundResult> {
      try {
        const target = payment.id.startsWith("ch_") ? { charge: payment.id } : { payment_intent: payment.id };
        const refund = await stripe().client.refunds.create({ ...target, reason: "requested_by_customer", metadata }, { ...STRIPE_WRITE, idempotencyKey: key });
        return { ok: true, id: refund.id, status: (refund.status ?? "pending") as RefundStatus };
      } catch (error) {
        console.error("[billing] Stripe refused or did not answer a refund", error);
        const code = error instanceof Stripe.errors.StripeError && error.statusCode !== undefined && error.statusCode < 500 ? error.code : undefined;
        return { ok: false, reason: code ?? "stripe_unavailable" };
      }
    },

    /**
     * What each offered Plan costs: a paid Plan's Stripe product's default Price, and the
     * Free Plan at 0 in the first paid one's currency and interval. Null when Stripe is not
     * configured or cannot tell (unreachable, or a Price that is not a fixed recurring amount).
     */
    async planPrices(): Promise<Record<Plan, PlanPrice> | null> {
      if (!config.stripe) return null;
      if (planPricesFailedAt !== undefined && now().getTime() - planPricesFailedAt < PLAN_PRICE_RETRY_AFTER_MS) return null;
      await linkedIfPossible();
      try {
        const paid = (await listPlans(database)).filter((plan) => plan.status === "offered" && plan.key !== FREE_PLAN && plan.stripeProductId);
        const settled = await Promise.allSettled(paid.map(async (plan) => [plan.key, await subscriptionPrice(await defaultPriceOf(plan.stripeProductId!))] as const));
        const prices = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        const failures = settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
        // One product Stripe cannot price leaves out its own Plan's price; none at all, every price.
        if (failures.length > 0 && prices.length === 0) throw failures[0];
        for (const failure of failures) console.error("[billing] a Plan price is unavailable from Stripe", failure);
        planPricesFailedAt = undefined;
        const free: PlanPrice = { currency: prices[0]?.[1].currency ?? "eur", interval: prices[0]?.[1].interval ?? "month", amount: 0 };
        return { [FREE_PLAN]: free, ...Object.fromEntries(prices) };
      } catch (error) {
        planPricesFailedAt = now().getTime();
        console.error("[billing] Plan prices unavailable from Stripe", error);
        return null;
      }
    },

    /** Every Plan, offered and hidden, lowest rank first. */
    plans(): Promise<PlanDefinition[]> {
      return listPlans(database);
    },

    /**
     * Ties the paid Plans sold before #206 to their Stripe products, from their env Prices
     * (see StripeConfig.envPlanPrices). Run at startup; billing also does it before it
     * first needs a product. Throws if Stripe could not be reached.
     */
    linkPlansToEnvPrices: linked,

    /** The lowest-ranked offered Plan above `plan` whose quotas `allow` what was asked (an Upgrade Prompt's); null when none. */
    upgradeFor,

    /**
     * Creates a Plan (Back Office) from untrusted `input`: `{ key, name: { fr, en },
     * stripeProductId, features }`. The product must exist in Stripe, be active and have a
     * recurring default Price, and be no other Plan's. The Plan starts hidden, ranked above
     * every other, with the Plan Quotas of the Plan ranked just below it. `within` runs it
     * in the caller's transaction.
     */
    async createPlan(input: unknown, within: Queryable = database, options: PlanWriteOptions = {}): Promise<PlanResult<{ plan: PlanDefinition; quotas: PlanQuotas }>> {
      const parsed = newPlanInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: inputError(parsed.error) };
      const { key, name, stripeProductId, features } = parsed.data;
      if (!PLAN_KEY.test(key)) return { ok: false, error: "invalid_key" };
      if (!options.productChecked) {
        const problem = await stripeProductProblem(stripeProductId);
        if (problem) return { ok: false, error: problem };
      }
      return uniquely<{ plan: PlanDefinition; quotas: PlanQuotas }>(async () => {
        // Concurrent creates take their turn, each ranked above the one before.
        await within.query("SELECT key FROM plan FOR UPDATE");
        const plans = await listPlans(within);
        if (plans.some((plan) => plan.key === key)) return { ok: false, error: "key_taken" };
        const problem = await productProblem(stripeProductId, key, within, true);
        if (problem) return { ok: false, error: problem };
        const below = plans.at(-1)!;
        const plan: PlanDefinition = { key, name, rank: below.rank + 1, status: "hidden", stripeProductId, features };
        await insertPlan(within, plan);
        const { rows } = await within.query(
          `INSERT INTO plan_quota (plan, ${QUOTA_COLUMNS}) SELECT $1, ${QUOTA_COLUMNS} FROM plan_quota WHERE plan = $2 RETURNING *`,
          [key, below.key],
        );
        return { ok: true, plan, quotas: quotasFromRow(rows[0]) };
      });
    },

    /**
     * Asks Stripe whether `product` may be a Plan's (exists, active, recurring default Price), quickly.
     * For callers that write in a transaction: ask first, then pass `productChecked` to `createPlan` /
     * `updatePlan`, so no transaction waits on Stripe. With Stripe's own error when it refused or did not answer.
     */
    checkStripeProduct: stripeProductCheck,

    /**
     * Changes a Plan (Back Office) from untrusted `input`: `{ name: { fr, en }, status,
     * stripeProductId, features }`. Free keeps no product and stays offered; a paid Plan
     * offered, or once tied to a product, needs one (checked as for `createPlan` when it
     * changes). Hiding a Plan keeps its subscribers on it. Returns it before and after.
     */
    async updatePlan(key: Plan, input: unknown, within: Queryable = database, options: PlanWriteOptions = {}): Promise<PlanResult<{ before: PlanDefinition; after: PlanDefinition }>> {
      const parsed = planChangeInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: inputError(parsed.error) };
      const { name, status, features } = parsed.data;
      const submittedProduct = parsed.data.stripeProductId || null;
      const current = await findPlan(within, key);
      // A product given to a Plan with none yet is asked of Stripe before anything is locked.
      if (current && key !== FREE_PLAN && !current.stripeProductId && submittedProduct && !options.productChecked) {
        const problem = await stripeProductProblem(submittedProduct);
        if (problem) return { ok: false, error: problem };
      }
      return uniquely<{ before: PlanDefinition; after: PlanDefinition }>(async () => {
        const before = await lockedPlan(within, key);
        if (!before) return { ok: false, error: "unknown_plan" };
        let stripeProductId: string | null;
        if (key === FREE_PLAN) {
          if (status !== "offered" || submittedProduct) return { ok: false, error: "free_plan_built_in" };
          stripeProductId = null;
        } else if (before.stripeProductId) {
          // Frozen: left out of the form, or the same, it stays.
          if (submittedProduct && submittedProduct !== before.stripeProductId) return { ok: false, error: "product_frozen" };
          stripeProductId = before.stripeProductId;
        } else {
          if (!submittedProduct && status === "offered") return { ok: false, error: "product_required" };
          if (submittedProduct) {
            const problem = await productProblem(submittedProduct, key, within, true);
            if (problem) return { ok: false, error: problem };
          }
          stripeProductId = submittedProduct;
        }
        const after: PlanDefinition = { ...before, name, status, stripeProductId, features };
        await savePlan(within, after);
        return { ok: true, before, after };
      });
    },

    /**
     * Moves a paid Plan one rank up or down (Back Office), swapping it with its neighbour.
     * Free stays first: it does not move, and nothing moves below it. Returns the Plan's rank before and after.
     */
    async movePlan(key: Plan, direction: "up" | "down", within: Queryable = database): Promise<PlanResult<{ before: number; after: number }>> {
      if (key === FREE_PLAN) return { ok: false, error: "free_plan_built_in" };
      await within.query("SELECT key FROM plan FOR UPDATE");
      const plans = await listPlans(within);
      const index = plans.findIndex((plan) => plan.key === key);
      if (index < 0) return { ok: false, error: "unknown_plan" };
      const plan = plans[index]!;
      const neighbour = plans[direction === "up" ? index + 1 : index - 1];
      if (!neighbour || neighbour.key === FREE_PLAN) return { ok: false, error: "cannot_move" };
      await swapRanks(within, plan, neighbour);
      return { ok: true, before: plan.rank, after: neighbour.rank };
    },

    /** Every Plan's quotas, lowest rank first. */
    planQuotas: allPlanQuotas,

    /**
     * Creates a Coupon (Back Office) from untrusted `input` (see coupons.ts `newCouponInput`): a Stripe
     * coupon on the eligible Plans' products, and its promotion code. Calls Stripe only, briefly: run it
     * outside any transaction. Nothing is left in Stripe when it fails.
     */
    async createCoupon(input: unknown): Promise<CouponResult<{ coupon: Coupon }>> {
      const plans = await listPlans(database);
      const params = couponParams(input, plans, now());
      if (!params.ok) return params;
      if (!config.stripe) return { ok: false, error: "stripe_unavailable" };
      const { client } = stripe();
      let couponId: string | undefined;
      try {
        const taken = await client.promotionCodes.list({ code: params.promotionCode.code!, active: true, limit: 1 }, QUICK);
        if (taken.data.length > 0) return { ok: false, error: "code_taken" };
        const amount = params.coupon.amount_off;
        if (amount != null) {
          // A fixed amount is in euros: every eligible Plan must be priced in euros, and, for good, cost more.
          for (const product of params.coupon.applies_to!.products!) {
            const price = await amountOf(await defaultPriceOf(product), QUICK);
            if (price.currency !== COUPON_CURRENCY) return { ok: false, error: "currency_not_eur" };
            if (params.coupon.duration === "forever" && amount >= price.amount) return { ok: false, error: "amount_covers_price" };
          }
        }
        couponId = (await client.coupons.create(params.coupon, STRIPE_WRITE)).id;
        const created = await client.promotionCodes.create({ promotion: { type: "coupon", coupon: couponId }, ...params.promotionCode, expand: PROMOTION_CODE_EXPAND }, STRIPE_WRITE);
        codeLookups.forget();
        return { ok: true, coupon: couponOf(created, plans, now()) };
      } catch (error) {
        // A coupon without its code would only clutter Stripe.
        if (couponId) await client.coupons.del(couponId, QUICK).catch((cleanup: unknown) => console.error("[billing] could not delete a coupon left without its code", cleanup));
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.param === "code") return { ok: false, error: "code_taken", failure: stripeFailure(error) };
        console.error("[billing] could not create a Coupon in Stripe", error);
        return { ok: false, error: "stripe_unavailable", failure: stripeFailure(error) };
      }
    },

    /**
     * Every Coupon (the Stripe account's promotion codes, page after page, at most MAX_COUPONS), newest
     * first, with Stripe's redemption counts; one Stripe gives without its coupon is listed as unreadable.
     * Read while a page renders: null when Stripe is not configured or does not answer quickly.
     */
    async coupons(): Promise<ListedCoupon[] | null> {
      if (!config.stripe) return null;
      try {
        const [listed, plans] = await Promise.all([
          stripe()
            .client.promotionCodes.list({ limit: COUPON_PAGE, expand: PROMOTION_CODE_EXPAND.map((field) => `data.${field}`) }, QUICK)
            .autoPagingToArray({ limit: MAX_COUPONS }),
          listPlans(database),
        ]);
        return listed.map((promotionCode) => listedCouponOf(promotionCode, plans, now()));
      } catch (error) {
        console.error("[billing] Coupons unavailable from Stripe", error);
        return null;
      }
    },

    /**
     * Deactivates a Coupon (Back Office): its code can no longer be redeemed, and discounts already
     * given run their course. Calls Stripe only: run it outside any transaction. Returns it before and after.
     */
    async deactivateCoupon(id: string): Promise<CouponResult<{ before: Coupon; after: Coupon; /** False when it was deactivated already: nothing was written. */ changed: boolean }>> {
      if (!config.stripe) return { ok: false, error: "stripe_unavailable" };
      const { client } = stripe();
      try {
        const plans = await listPlans(database);
        const current = await client.promotionCodes.retrieve(id, { expand: PROMOTION_CODE_EXPAND }, QUICK);
        const before = couponOf(current, plans, now());
        if (!current.active) return { ok: true, before, after: before, changed: false };
        const after = couponOf(await client.promotionCodes.update(id, { active: false, expand: PROMOTION_CODE_EXPAND }, STRIPE_WRITE), plans, now());
        codeLookups.forget();
        return { ok: true, before, after, changed: true };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return { ok: false, error: "unknown_coupon", failure: stripeFailure(error) };
        console.error("[billing] could not deactivate a Coupon in Stripe", error);
        return { ok: false, error: "stripe_unavailable", failure: stripeFailure(error) };
      }
    },

    /**
     * Reactivates a Coupon: only to undo a deactivation the Back Office Audit could not record, so that
     * no change goes unrecorded. Calls Stripe only.
     */
    async reactivateCoupon(id: string): Promise<CouponResult<object>> {
      if (!config.stripe) return { ok: false, error: "stripe_unavailable" };
      try {
        await stripe().client.promotionCodes.update(id, { active: true }, STRIPE_WRITE);
        codeLookups.forget();
        return { ok: true };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return { ok: false, error: "unknown_coupon" };
        console.error("[billing] could not reactivate a Coupon in Stripe", error);
        return { ok: false, error: "stripe_unavailable" };
      }
    },

    /**
     * Replaces one Plan's quotas (Back Office) and returns the ones it replaced; null for an unknown
     * Plan. Applies at once to every Candidate on that Plan: a reduction on a paid Plan is scheduled
     * first, by the Quota Reductions module (#514), which calls this on its effective date. `within` runs it in the caller's transaction.
     */
    async setPlanQuotas(plan: Plan, quotas: PlanQuotas, within: Queryable = database): Promise<PlanQuotas | null> {
      const keys = Object.keys(COLUMNS) as (keyof PlanQuotas)[];
      const { rows } = await within.query(
        `UPDATE plan_quota p SET ${keys.map((key, index) => `${COLUMNS[key]} = $${index + 2}`).join(", ")}, updated_at = now()
         FROM (SELECT * FROM plan_quota WHERE plan = $1 FOR UPDATE) previous
         WHERE p.plan = previous.plan
         RETURNING previous.*`,
        [plan, ...keys.map((key) => quotas[key])],
      );
      return rows[0] ? quotasFromRow(rows[0]) : null;
    },

    /** One Plan's quotas, its row locked until `within`'s transaction ends (a Quota Reduction is weighed against them); null for an unknown Plan. */
    async lockPlanQuotas(plan: Plan, within: Queryable): Promise<PlanQuotas | null> {
      const { rows } = await within.query("SELECT * FROM plan_quota WHERE plan = $1 FOR UPDATE", [plan]);
      return rows[0] ? quotasFromRow(rows[0]) : null;
    },

    /** Takes Plan Features off a Plan (a Quota Reduction, #514, on its effective date); returns its Plan Features before and after, or null for an unknown Plan. */
    async removePlanFeatures(plan: Plan, features: readonly PlanFeature[], within: Queryable = database): Promise<{ before: PlanFeature[]; after: PlanFeature[] } | null> {
      const current = await lockedPlan(within, plan);
      if (!current) return null;
      const after = current.features.filter((feature) => !features.includes(feature));
      await savePlan(within, { ...current, features: after });
      return { before: current.features, after };
    },

    /**
     * The Candidate's Plan, the Plan Quotas that apply to them, and the status
     * Stripe last reported for their subscription (null if they never subscribed):
     * `past_due` while Stripe retries a failed payment, the Plan still kept (never on Free).
     * `endsAt` is when a paid Plan whose cancellation is scheduled ends (the
     * Candidate keeps it until then); null when it renews, and on Free.
     */
    async entitlements(candidateId: string) {
      const account = await stripeAccountOf(candidateId);
      const plan = account?.plan ?? FREE_PLAN;
      const reported = (account?.stripe_status ?? null) as SubscriptionStatus | null;
      // Past due on Free (no card to retry, see applySubscription): no paid Plan is kept, so no Payment Failed Notice.
      const stripeStatus = plan === FREE_PLAN && reported === "past_due" ? null : reported;
      const endsAt = plan === FREE_PLAN ? null : (account?.ends_at ?? null);
      const { rows } = await database.query("SELECT quota, used FROM quota_usage WHERE candidate_id = $1 AND week = $2", [
        candidateId,
        weekInFrance(now()),
      ]);
      const usedThisWeek = Object.fromEntries(
        WEEKLY_QUOTAS.map((quota) => [quota, (rows.find((row) => row.quota === quota)?.used as number | undefined) ?? 0]),
      ) as Record<WeeklyQuota, number>;
      return { plan, stripeStatus, endsAt, quotas: await quotasOf(plan), usedThisWeek };
    },
  };
}

export type Billing = ReturnType<typeof createBilling>;
