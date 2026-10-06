/**
 * Plans, Stripe billing and Plan Quotas (CONTEXT.md, ADR-0012).
 *
 * One deep module. Callers get `createBilling(config)`, whose methods answer:
 *  - what may this Candidate do?  `entitlements`, `use`, `allowsAnother`
 *  - how do they change Plan?     `startCheckout`, `openCustomerPortal`, `handleStripeWebhook`
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
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe Price ids of the paid Plans' subscriptions. */
  prices: { standard: string; premium: string };
  /** Another Stripe API origin (a fake one in tests and e2e). */
  apiUrl?: string | undefined;
}

/** The quotas Jobbbox starts with; Administrators change them in the back office. */
export const STARTING_PLAN_QUOTAS: Record<Plan, PlanQuotas> = {
  free: { profiles: 1, matchScores: 3, atsScores: 1, enrichedContacts: 0, jobDigest: "none" },
  standard: { profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobDigest: "weekly" },
  premium: { profiles: null, matchScores: null, atsScores: null, enrichedContacts: 20, jobDigest: "daily" },
};

const COLUMNS = {
  profiles: "profiles",
  matchScores: "match_scores",
  atsScores: "ats_scores",
  enrichedContacts: "enriched_contacts",
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
    readonly code: "stripe_not_configured" | "no_checkout_for_free_plan" | "invalid_webhook_signature",
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
