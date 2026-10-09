/**
 * Plans, Stripe billing and Plan Quotas (CONTEXT.md, ADR-0014).
 *
 * One deep module. Callers get `createBilling(config)`, whose methods answer:
 *  - what may this Candidate do?  `entitlements`, `use`, `allows`, `release`, `allowsAnother`
 *  - how do they change Plan?     `startCheckout`, `openCustomerPortal`, `handleStripeWebhook`
 *  - how do they pay a Coaching Session?  `coachingSessionPrice`, `startCoachingSessionCheckout`
 *    (the signed webhook reports it paid through `onCoachingSessionPaid`)
 *  - what do the Plans allow?     `planQuotas`, `setPlanQuotas` (back office)
 * and `migrateBilling(database)` to create / upgrade its tables. Stripe, the
 * tables and month boundaries stay behind this seam.
 */
import {
  JOB_DIGEST_FREQUENCIES,
  LIMITED_QUOTAS,
  MONTHLY_QUOTAS,
  PLANS,
  type LimitedQuota,
  type MonthlyQuota,
  type Plan,
  type PlanQuotas,
} from "@jobhub/shared";
import type { Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import Stripe from "stripe";
import { routes } from "../routes";

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

/** What a Coaching Session costs a Candidate, in the currency's smallest unit (cents). */
export interface CoachingSessionPrice {
  amount: number;
  currency: string;
  /** What it costs without the Premium discount; equal to `amount` off Premium. */
  regularAmount: number;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe Price ids of the paid Plans' subscriptions. */
  prices: { standard: string; premium: string };
  /**
   * Stripe Price ids of the one-off Coaching Session Price: the regular one, and the
   * discounted one for the Premium Plan. Without them, Coaching Sessions cannot be paid.
   */
  coachingSessionPrices?: { regular: string; premium: string } | undefined;
  /** Another Stripe API origin (a fake one in tests and e2e). */
  apiUrl?: string | undefined;
}

/** The quotas Jobbbox starts with; Administrators change them in the back office. */
export const STARTING_PLAN_QUOTAS: Record<Plan, PlanQuotas> = {
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
  await database.query(`
    CREATE TABLE IF NOT EXISTS plan_quota (
      plan text PRIMARY KEY CHECK (plan IN (${PLANS.map((plan) => `'${plan}'`).join(", ")})),
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
      stripe_event_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS quota_usage (
      candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
      quota text NOT NULL,
      month text NOT NULL,
      used integer NOT NULL,
      PRIMARY KEY (candidate_id, quota, month)
    );
  `);
  // A quota added after the table was created starts at its starting value on every Plan.
  const { rows: existing } = await database.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'plan_quota'",
  );
  for (const quota of LIMITED_QUOTAS) {
    const column = COLUMNS[quota];
    if (existing.some((row) => row.column_name === column)) continue;
    await database.query(`ALTER TABLE plan_quota ADD COLUMN IF NOT EXISTS ${column} integer CHECK (${column} >= 0)`);
    for (const plan of PLANS) {
      await database.query(`UPDATE plan_quota SET ${column} = $2 WHERE plan = $1`, [plan, STARTING_PLAN_QUOTAS[plan][quota]]);
    }
  }
  for (const plan of PLANS) {
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

function quotasFromRow(row: QuotaRow): PlanQuotas {
  const quotas = { jobDigest: row.job_digest } as PlanQuotas;
  for (const quota of LIMITED_QUOTAS) quotas[quota] = row[COLUMNS[quota]] as number | null;
  return quotas;
}

/**
 * The answer to "may this Candidate do one more?". When refused, it names the
 * cheapest Plan that would allow it (null when no Plan does), for the upgrade prompt.
 */
export type QuotaDecision =
  | { allowed: true; /** Left after this one; null when unlimited. */ remaining: number | null }
  | { allowed: false; quota: LimitedQuota; plan: Plan; limit: number; upgradeTo: Plan | null };

/** Why a billing request could not be served. `message` is for logs, not for Candidates. */
export class BillingError extends Error {
  constructor(
    readonly code: "stripe_not_configured" | "coaching_sessions_not_configured" | "no_checkout_for_free_plan" | "invalid_webhook_signature",
    message: string = code,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/** Subscription statuses that keep the paid Plan; Stripe retries failed payments while past_due. */
const PAYING_STATUSES = new Set(["active", "trialing", "past_due"]);

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
  function coachingSessionPrices(): { regular: string; premium: string } {
    const prices = stripe().config.coachingSessionPrices;
    if (!prices) throw new BillingError("coaching_sessions_not_configured");
    return prices;
  }

  /** Stripe Prices' amounts, kept a few minutes: Jobbbox sets them in Stripe and rarely changes them. */
  const priceCache = new Map<string, { at: number; amount: number; currency: string }>();
  async function amountOf(priceId: string): Promise<{ amount: number; currency: string }> {
    const cached = priceCache.get(priceId);
    if (cached && now().getTime() - cached.at < 10 * 60_000) return cached;
    const price = await stripe().client.prices.retrieve(priceId);
    if (price.unit_amount === null) throw new Error(`Stripe Price ${priceId} has no fixed amount`);
    const fetched = { at: now().getTime(), amount: price.unit_amount, currency: price.currency };
    priceCache.set(priceId, fetched);
    return fetched;
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
      "SELECT plan, stripe_customer_id, stripe_status FROM candidate_plan WHERE candidate_id = $1",
      [candidateId],
    );
    return rows[0] as { plan: Plan; stripe_customer_id: string | null; stripe_status: string | null } | undefined;
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

  /** Applies a customer.subscription.* event: the Plan follows the subscription's price and status. */
  async function applySubscription(event: Stripe.Event, subscription: Stripe.Subscription) {
    const { prices } = stripe().config;
    const price = subscription.items.data[0]?.price.id;
    const paidPlan: Plan | undefined = price === prices.standard ? "standard" : price === prices.premium ? "premium" : undefined;
    if (!paidPlan) return; // Not one of our Plans' prices.
    const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const ended = event.type === "customer.subscription.deleted" || !PAYING_STATUSES.has(subscription.status);
    await database.query(
      `UPDATE candidate_plan
       SET plan = $2, stripe_subscription_id = $3, stripe_status = $4, stripe_event_at = to_timestamp($5)
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
        ended ? "free" : paidPlan,
        subscription.id,
        subscription.status,
        event.created,
        ended,
        event.type === "customer.subscription.deleted" ? STATUS_STAGES.canceled : stageOf(subscription.status),
      ],
    );
  }

  async function planOf(candidateId: string): Promise<Plan> {
    const { rows } = await database.query("SELECT plan FROM candidate_plan WHERE candidate_id = $1", [candidateId]);
    return (rows[0]?.plan as Plan | undefined) ?? "free";
  }

  async function quotasOf(plan: Plan): Promise<PlanQuotas> {
    const { rows } = await database.query("SELECT * FROM plan_quota WHERE plan = $1", [plan]);
    return quotasFromRow(rows[0]);
  }

  /** The first Plan above `plan` that allows more than `limit` of `quota`. */
  async function upgradeFor(plan: Plan, quota: LimitedQuota, limit: number): Promise<Plan | null> {
    for (const higher of PLANS.slice(PLANS.indexOf(plan) + 1)) {
      const higherLimit = (await quotasOf(higher))[quota];
      if (higherLimit === null || higherLimit > limit) return higher;
    }
    return null;
  }

  async function refusal(plan: Plan, quota: LimitedQuota, limit: number): Promise<QuotaDecision> {
    return { allowed: false, quota, plan, limit, upgradeTo: await upgradeFor(plan, quota, limit) };
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
      if (plan === "free") throw new BillingError("no_checkout_for_free_plan");
      const { client, config: stripeConfig } = stripe();
      const customer = await stripeCustomerFor(candidate);
      const account = await stripeAccountOf(candidate.id);
      if (account && account.plan !== "free" && PAYING_STATUSES.has(account.stripe_status ?? "")) {
        return portalFor(customer, locale);
      }
      const session = await client.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: candidate.id,
        line_items: [{ price: stripeConfig.prices[plan], quantity: 1 }],
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
      const premium = (await planOf(candidateId)) === "premium";
      const regular = await amountOf(prices.regular);
      const charged = premium ? await amountOf(prices.premium) : regular;
      return { amount: charged.amount, currency: charged.currency, regularAmount: regular.amount };
    },

    /**
     * Where to send a Candidate who books a Coaching Session with a Human Coach: a one-off
     * Stripe Checkout at their Plan's Coaching Session Price (discounted on Premium). The
     * Coaching Session exists only once the signed webhook confirms the payment.
     * Throws a BillingError("coaching_sessions_not_configured") without the Prices.
     */
    async startCoachingSessionCheckout(candidate: { id: string; email: string }, coachId: string, locale: Locale = "fr"): Promise<string> {
      const prices = coachingSessionPrices();
      const customer = await stripeCustomerFor(candidate);
      const premium = (await planOf(candidate.id)) === "premium";
      const session = await stripe().client.checkout.sessions.create({
        mode: "payment",
        customer,
        client_reference_id: candidate.id,
        line_items: [{ price: premium ? prices.premium : prices.regular, quantity: 1 }],
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

    /** Every Plan's quotas, in Plan order. */
    async planQuotas(): Promise<Record<Plan, PlanQuotas>> {
      const { rows } = await database.query("SELECT * FROM plan_quota");
      return Object.fromEntries(
        PLANS.map((plan) => [plan, quotasFromRow(rows.find((row) => row.plan === plan))]),
      ) as Record<Plan, PlanQuotas>;
    },

    /** Replaces one Plan's quotas (back office). Applies at once to every Candidate on that Plan. */
    async setPlanQuotas(plan: Plan, quotas: PlanQuotas): Promise<void> {
      const keys = Object.keys(COLUMNS) as (keyof PlanQuotas)[];
      await database.query(
        `UPDATE plan_quota SET ${keys.map((key, index) => `${COLUMNS[key]} = $${index + 2}`).join(", ")}, updated_at = now()
         WHERE plan = $1`,
        [plan, ...keys.map((key) => quotas[key])],
      );
    },

    /** The Candidate's Plan and the Plan Quotas that apply to them. */
    async entitlements(candidateId: string) {
      const plan = await planOf(candidateId);
      const { rows } = await database.query("SELECT quota, used FROM quota_usage WHERE candidate_id = $1 AND month = $2", [
        candidateId,
        monthInFrance(now()),
      ]);
      const usedThisMonth = Object.fromEntries(
        MONTHLY_QUOTAS.map((quota) => [quota, (rows.find((row) => row.quota === quota)?.used as number | undefined) ?? 0]),
      ) as Record<MonthlyQuota, number>;
      return { plan, quotas: await quotasOf(plan), usedThisMonth };
    },
  };
}

export type Billing = ReturnType<typeof createBilling>;
