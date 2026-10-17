/**
 * Plans, Stripe billing and Plan Quotas (CONTEXT.md, ADR-0014).
 *
 * One deep module. Callers get `createBilling(config)`, whose methods answer:
 *  - what may this Candidate do?  `entitlements`, `use`, `allows`, `release`, `allowsAnother`
 *  - how do they change Plan?     `startCheckout`, `openCustomerPortal`, `handleStripeWebhook`
 *  - how do they pay a Coaching Session?  `coachingSessionPrice`, `startCoachingSessionCheckout`
 *    (the signed webhook reports it paid through `onCoachingSessionPaid`)
 *  - how do they stop paying?     `closeAccount`, when they delete their account
 *  - which Plans are there?       `plans`, and in the Back Office `createPlan`, `updatePlan`, `movePlan`
 *  - what do the Plans allow?     `planQuotas`, `setPlanQuotas` (back office), `upgradeFor`
 *  - what do the Plans cost?      `planPrices`
 * and `migrateBilling(database)` to create / upgrade its tables. Stripe, the
 * tables and month boundaries stay behind this seam.
 *
 * Plans live in the `plan` table (ADR-0014 addendum #206, ./plans.ts): each paid Plan is
 * tied to one Stripe product, and every price of that product is the Plan's.
 */
import {
  FREE_PLAN,
  JOB_DIGEST_FREQUENCIES,
  LIMITED_QUOTAS,
  MONTHLY_QUOTAS,
  type LimitedQuota,
  type MonthlyQuota,
  type Plan,
  type PlanFeature,
  type PlanQuotas,
} from "@jobhub/shared";
import type { Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import Stripe from "stripe";
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

export type { PlanDefinition, PlanName } from "./plans";

export interface BillingConfig {
  /** Postgres pool holding the Candidate accounts. */
  database: Pool;
  /** Public origin of the web app; Stripe sends Candidates back here. */
  baseURL: string;
  /** Without Stripe, quotas still apply but nobody can change Plan. */
  stripe?: StripeConfig | undefined;
  /** The current time. Tests move it; month boundaries are taken in Europe/Paris. */
  now?: () => Date;
  /**
   * Told of each Coaching Session Stripe confirms as paid, from its signed webhook
   * (the Human Coaches module records it). Stripe may report one payment more than
   * once, even concurrently: it must be idempotent per Checkout Session. If it
   * throws, the webhook fails and Stripe retries the delivery.
   */
  onCoachingSessionPaid?: (paid: PaidCoachingSession) => Promise<unknown>;
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

/** The quotas Jobbbox's starting Plans start with; Administrators change them in the back office. */
export const STARTING_PLAN_QUOTAS: Record<"free" | "standard" | "premium", PlanQuotas> = {
  free: { profiles: 1, matchScores: 3, atsScores: 1, enrichedContacts: 0, jobSearches: 3, jobDigest: "none" },
  standard: { profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobSearches: 30, jobDigest: "weekly" },
  premium: { profiles: null, matchScores: null, atsScores: null, enrichedContacts: 20, jobSearches: null, jobDigest: "daily" },
};

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
      month text NOT NULL,
      used integer NOT NULL,
      PRIMARY KEY (candidate_id, quota, month)
    );
  `);
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
  // A quota added after the table was created starts at its starting value on every Plan.
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
  /** A paid Plan that is offered, or that already had one, needs a product. */
  | "product_required"
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

/** Stripe calls made while a page renders: given up on quickly, never retried. */
const QUICK: Stripe.RequestOptions = { timeout: 2_500, maxNetworkRetries: 0 };

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

/** "2026-10": the calendar month in France, which monthly quotas count by. */
function monthInFrance(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}`;
}

export function createBilling(config: BillingConfig) {
  const { database } = config;
  const now = config.now ?? (() => new Date());
  let stripeClient: Stripe | undefined;

  function stripe(): { client: Stripe; config: StripeConfig } {
    if (!config.stripe) throw new BillingError("stripe_not_configured");
    if (!stripeClient) {
      const api = config.stripe.apiUrl ? new URL(config.stripe.apiUrl) : undefined;
      stripeClient = new Stripe(config.stripe.secretKey, {
        maxNetworkRetries: 2,
        ...(api && { host: api.hostname, port: api.port, protocol: api.protocol === "http:" ? "http" : "https" }),
      });
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
    const price = await stripe().client.prices.retrieve(priceId, {}, options);
    if (price.unit_amount === null) throw new Error(`Stripe Price ${priceId} has no fixed amount`);
    const fetched = { at: now().getTime(), amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval_count === 1 ? price.recurring.interval : null, product: productOf(price) };
    priceCache.set(priceId, fetched);
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
  /** The Price a paid Plan is sold at: its Stripe product's default Price. */
  async function defaultPriceOf(product: string): Promise<string> {
    const cached = productCache.get(product);
    let defaultPrice = cached && now().getTime() - cached.at < 10 * 60_000 ? cached.defaultPrice : undefined;
    if (defaultPrice === undefined) {
      const fetched = await stripe().client.products.retrieve(product, {}, QUICK);
      defaultPrice = idOf(fetched.default_price);
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
    for (const plan of await listPlans(database)) {
      const price = prices[plan.key];
      if (plan.key === FREE_PLAN || plan.stripeProductId || !price) continue;
      await adoptProduct(database, plan.key, (await amountOf(price, QUICK)).product);
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

  /** Why `product` cannot be a Plan's (other than `key`'s), or null when it can: it exists, is active and has a recurring default Price. */
  async function productProblem(product: string, key: string, within: Queryable): Promise<PlanError | null> {
    if (!/^prod_[A-Za-z0-9_]+$/.test(product)) return "not_a_product_id";
    const { rows } = await within.query("SELECT 1 FROM plan WHERE stripe_product_id = $1 AND key <> $2", [product, key]);
    if (rows.length > 0) return "product_taken";
    if (!config.stripe) return "stripe_unavailable";
    try {
      const fetched = await stripe().client.products.retrieve(product);
      if (!fetched.active) return "product_archived";
      const priceId = idOf(fetched.default_price);
      if (!priceId) return "no_recurring_default_price";
      productCache.set(product, { at: now().getTime(), defaultPrice: priceId });
      priceCache.delete(priceId);
      const { interval } = await amountOf(priceId);
      return BILLING_INTERVALS.includes(interval as BillingInterval) ? null : "no_recurring_default_price";
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return "product_not_found";
      if (error instanceof Error && /has no fixed amount/.test(error.message)) return "no_recurring_default_price";
      console.error("[billing] could not check a Stripe product", error);
      return "stripe_unavailable";
    }
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
      "SELECT plan, stripe_customer_id, stripe_status, ends_at FROM candidate_plan WHERE candidate_id = $1",
      [candidateId],
    );
    return rows[0] as { plan: Plan; stripe_customer_id: string | null; stripe_status: string | null; ends_at: Date | null } | undefined;
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
    // A webhook endpoint pinned to an older API version still has it on the subscription.
    const legacy = (subscription as { current_period_end?: number }).current_period_end;
    return subscription.items.data[0]?.current_period_end ?? legacy ?? null;
  }

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
    await linked();
    const { rows } = await database.query("SELECT key FROM plan WHERE stripe_product_id = $1 AND key <> $2", [productOf(price), FREE_PLAN]);
    return rows[0]?.key as Plan | undefined;
  }

  /** Applies a customer.subscription.* event: the Plan follows the subscription's product, status and scheduled end. */
  async function applySubscription(event: Stripe.Event, subscription: Stripe.Subscription) {
    const paidPlan = await paidPlanOf(subscription.items.data[0]?.price);
    if (!paidPlan) return; // Not one of our Plans' prices.
    const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const ended = event.type === "customer.subscription.deleted" || !PAYING_STATUSES.has(subscription.status);
    if (CHARGED_STATUSES.includes(subscription.status)) {
      // Whatever order Stripe delivers events in, a payment once taken stays taken.
      await database.query("UPDATE candidate_plan SET charged = true WHERE stripe_customer_id = $1", [customer]);
    }
    await database.query(
      `UPDATE candidate_plan
       SET plan = $2, stripe_subscription_id = $3, stripe_status = $4, stripe_event_at = to_timestamp($5), ends_at = to_timestamp($8)
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
      ],
    );
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
     * Records one use of a monthly quota (a Match Score, an ATS Score, an
     * Enriched Contact) if the Candidate's Plan allows it this month. Call it
     * before doing the work; nothing is recorded when refused. Safe under
     * concurrent requests.
     */
    async use(candidateId: string, quota: MonthlyQuota): Promise<QuotaDecision> {
      const plan = await planOf(candidateId);
      const limit = (await quotasOf(plan))[quota];
      const month = monthInFrance(now());
      if (limit !== null && limit <= 0) return refusal(plan, quota, limit);
      const { rows } = await database.query(
        `INSERT INTO quota_usage (candidate_id, quota, month, used) VALUES ($1, $2, $3, 1)
         ON CONFLICT (candidate_id, quota, month) DO UPDATE SET used = quota_usage.used + 1
         WHERE $4::integer IS NULL OR quota_usage.used < $4::integer
         RETURNING used`,
        [candidateId, quota, month, limit],
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
     * Whether `use` would allow one more of a monthly quota now. Records nothing:
     * for asking before work whose cost is only known once done (see `release`).
     */
    async allows(candidateId: string, quota: MonthlyQuota): Promise<QuotaDecision> {
      const plan = await planOf(candidateId);
      const limit = (await quotasOf(plan))[quota];
      if (limit === null) return { allowed: true, remaining: null };
      const { rows } = await database.query("SELECT used FROM quota_usage WHERE candidate_id = $1 AND quota = $2 AND month = $3", [
        candidateId,
        quota,
        monthInFrance(now()),
      ]);
      const used = (rows[0]?.used as number | undefined) ?? 0;
      if (used >= limit) return refusal(plan, quota, limit);
      return { allowed: true, remaining: limit - used - 1 };
    },

    /** Gives back one use recorded this month by `use` whose work could not be done. Never below zero. */
    async release(candidateId: string, quota: MonthlyQuota): Promise<void> {
      await database.query("UPDATE quota_usage SET used = used - 1 WHERE candidate_id = $1 AND quota = $2 AND month = $3 AND used > 0", [
        candidateId,
        quota,
        monthInFrance(now()),
      ]);
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
     * switched there, never by a second subscription).
     */
    async startCheckout(candidate: { id: string; email: string }, plan: Plan, locale: Locale = "fr"): Promise<string> {
      if (plan === FREE_PLAN) throw new BillingError("no_checkout_for_free_plan");
      const { client } = stripe();
      await linked();
      const chosen = await findPlan(database, plan);
      if (!chosen || chosen.status !== "offered" || !chosen.stripeProductId) throw new BillingError("plan_not_offered", `Plan ${plan} is not offered`);
      const customer = await stripeCustomerFor(candidate);
      const account = await stripeAccountOf(candidate.id);
      if (account && account.plan !== FREE_PLAN && PAYING_STATUSES.has(account.stripe_status ?? "")) {
        return portalFor(customer, locale);
      }
      const session = await client.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: candidate.id,
        line_items: [{ price: await defaultPriceOf(chosen.stripeProductId), quantity: 1 }],
        locale,
        success_url: pageURL("?checkout=success"),
        cancel_url: pageURL(),
      });
      if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
      return session.url;
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
      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await applySubscription(event, event.data.object);
      }
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        await applyCheckout(event.data.object);
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
      try {
        await linked();
        const paid = (await listPlans(database)).filter((plan) => plan.status === "offered" && plan.key !== FREE_PLAN && plan.stripeProductId);
        const prices = await Promise.all(paid.map(async (plan) => [plan.key, await subscriptionPrice(await defaultPriceOf(plan.stripeProductId!))] as const));
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
    async createPlan(input: unknown, within: Queryable = database): Promise<PlanResult<{ plan: PlanDefinition; quotas: PlanQuotas }>> {
      const parsed = newPlanInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: inputError(parsed.error) };
      const { key, name, stripeProductId, features } = parsed.data;
      if (!PLAN_KEY.test(key)) return { ok: false, error: "invalid_key" };
      const plans = await listPlans(within);
      if (plans.some((plan) => plan.key === key)) return { ok: false, error: "key_taken" };
      const problem = await productProblem(stripeProductId, key, within);
      if (problem) return { ok: false, error: problem };
      const below = plans.at(-1)!;
      const plan: PlanDefinition = { key, name, rank: below.rank + 1, status: "hidden", stripeProductId, features };
      await insertPlan(within, plan);
      const { rows } = await within.query(
        `INSERT INTO plan_quota (plan, ${QUOTA_COLUMNS}) SELECT $1, ${QUOTA_COLUMNS} FROM plan_quota WHERE plan = $2 RETURNING *`,
        [key, below.key],
      );
      return { ok: true, plan, quotas: quotasFromRow(rows[0]) };
    },

    /**
     * Changes a Plan (Back Office) from untrusted `input`: `{ name: { fr, en }, status,
     * stripeProductId, features }`. Free keeps no product and stays offered; a paid Plan
     * offered, or once tied to a product, needs one (checked as for `createPlan` when it
     * changes). Hiding a Plan keeps its subscribers on it. Returns it before and after.
     */
    async updatePlan(key: Plan, input: unknown, within: Queryable = database): Promise<PlanResult<{ before: PlanDefinition; after: PlanDefinition }>> {
      const parsed = planChangeInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: inputError(parsed.error) };
      const before = await lockedPlan(within, key);
      if (!before) return { ok: false, error: "unknown_plan" };
      const { name, status, features } = parsed.data;
      const stripeProductId = parsed.data.stripeProductId || null;
      if (key === FREE_PLAN) {
        if (status !== "offered" || stripeProductId) return { ok: false, error: "free_plan_built_in" };
      } else {
        if (!stripeProductId && (status === "offered" || before.stripeProductId)) return { ok: false, error: "product_required" };
        if (stripeProductId && stripeProductId !== before.stripeProductId) {
          const problem = await productProblem(stripeProductId, key, within);
          if (problem) return { ok: false, error: problem };
        }
      }
      const after: PlanDefinition = { ...before, name, status, stripeProductId, features };
      await savePlan(within, after);
      return { ok: true, before, after };
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
     * Replaces one Plan's quotas (Back Office) and returns the ones it replaced; null for an unknown
     * Plan. Applies at once to every Candidate on that Plan. `within` runs it in the caller's transaction.
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

    /**
     * The Candidate's Plan, the Plan Quotas that apply to them, and the status
     * Stripe last reported for their subscription (null if they never subscribed):
     * `past_due` while Stripe retries a failed payment, the Plan still kept.
     * `endsAt` is when a paid Plan whose cancellation is scheduled ends (the
     * Candidate keeps it until then); null when it renews, and on Free.
     */
    async entitlements(candidateId: string) {
      const account = await stripeAccountOf(candidateId);
      const plan = account?.plan ?? FREE_PLAN;
      const stripeStatus = (account?.stripe_status ?? null) as SubscriptionStatus | null;
      const endsAt = plan === FREE_PLAN ? null : (account?.ends_at ?? null);
      const { rows } = await database.query("SELECT quota, used FROM quota_usage WHERE candidate_id = $1 AND month = $2", [
        candidateId,
        monthInFrance(now()),
      ]);
      const usedThisMonth = Object.fromEntries(
        MONTHLY_QUOTAS.map((quota) => [quota, (rows.find((row) => row.quota === quota)?.used as number | undefined) ?? 0]),
      ) as Record<MonthlyQuota, number>;
      return { plan, stripeStatus, endsAt, quotas: await quotasOf(plan), usedThisMonth };
    },
  };
}

export type Billing = ReturnType<typeof createBilling>;
