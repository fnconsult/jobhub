/**
 * Orders (#512, CONTEXT.md): what a Candidate confirms on Jobbbox's own page before Stripe Checkout, for a Plan or a
 * Coaching Session (C. civ. 1127-1, 1127-2; C. conso. L221-5 9°, L221-25, L221-28 1°). Stripe Checkout keeps one
 * terms URL per account, with no version: the boxes are Jobbbox's (research #496 §5.1).
 *
 * One deep module. `createOrders(database, deps)` answers:
 *  - what does the Order page show?   `terms`: the summary (the Plan or the Human Coach, the price all taxes included,
 *    how often a Plan is charged) and the CGV version to accept, null while none is in effect.
 *  - « Passer au paiement »           `place`: the server checks the boxes, never the browser. The CGV box is required
 *    while a CGV version is in effect, and must name that version; the Immediate Performance Request is not: without
 *    it the Candidate pays and the service starts all the same, but a Withdrawal is refunded in full (L221-25). Only
 *    then is a Checkout Session created; the Order is kept with it, and the CGV Acceptance written with its Checkout
 *    Session and the Immediate Performance Request (the Acceptances, #510). A Candidate who already pays is sent to
 *    the customer portal instead (ADR-0014), with no Order.
 *  - what does Stripe's webhook do?   `paid`: the Order Confirmation is emailed (Brevo) once per Checkout Session, on a
 *    durable medium (L221-13): the summary, a permanent link to the CGV version accepted, the Immediate Performance
 *    Request, and where « Renoncer au contrat ici » is.
 *  - what does a Withdrawal refund?   `immediateExecutionRequested`, by the subscription or the Coaching Session.
 * and `ordersOf(database, candidateId)` for the Data export, `migrateOrders(database)` for its table.
 *
 * An Order is the Candidate's: deleted with their account (ON DELETE CASCADE, ADR-0010), in their Data export without
 * Stripe's identifiers. The proof that outlives the account is the Acceptance.
 */
import { legalTextVersionInEffect, legalTextRegistry, parisDay, type LegalTextVersionRecord } from "@jobhub/help";
import { FREE_PLAN } from "@jobhub/shared";
import type { Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import type { Acceptances } from "../acceptances";
import type { Mailer } from "../auth";
import type { Billing, BillingInterval, PaidCheckout, PlanName } from "../billing";
import type { Queryable } from "../database/pool";
import { routes } from "../routes";
import { withdrawalDeadline } from "../withdrawals/deadline";
import { orderConfirmationEmail } from "./email";

/** What is ordered: a paid Plan (with a shared link's code, carried to Checkout), or a Coaching Session with a Human Coach. */
export type OrderItem = { kind: "plan"; plan: string; promotionCode?: string | undefined } | { kind: "coachingSession"; coachId: string };

/** What the Order page sums up. */
export interface OrderSummary {
  kind: OrderItem["kind"];
  /** The Plan's name, or the Human Coach's (the same in each language). */
  subject: PlanName;
  /** All taxes included, in the currency's smallest unit (cents), each `interval` for a Plan (null for a Coaching Session); null when Stripe cannot tell it. */
  price: { amount: number; currency: string; interval: BillingInterval | null } | null;
}

/** The Order page: its summary, and the CGV version the Candidate accepts on it (null while none is in effect). */
export interface OrderTerms {
  summary: OrderSummary;
  cgv: LegalTextVersionRecord | null;
}

/** The boxes as the form sent them, untrusted: `cgv` names the CGV version ticked, `immediateExecution` is "yes" when ticked. */
export interface OrderAnswers {
  cgv?: unknown;
  immediateExecution?: unknown;
}

/**
 * Where to send the Candidate (Stripe Checkout, or the customer portal), or why no Checkout Session was created: the
 * CGV box of the version in effect not ticked, or nothing to order under that name (see `terms`).
 */
export type PlaceOrderResult = { ok: true; url: string } | { ok: false; error: "cgv_required" | "not_orderable" };

/** The value of the Immediate Performance Request box, ticked. */
export const IMMEDIATE_EXECUTION_REQUESTED = "yes";

/** The Order page's boxes, by the names its form posts them under (`OrderAnswers`). */
export const ORDER_FIELDS = { cgv: "cgv", immediateExecution: "immediateExecution" } as const;

export interface OrdersDeps {
  billing: Pick<Billing, "plans" | "planPrices" | "coachingSessionPrice" | "startCheckout" | "startCoachingSessionCheckout">;
  /** The Human Coaches a Coaching Session can be booked with. */
  coaches: { list(): Promise<{ id: string; name: string }[]> };
  acceptances: Pick<Acceptances, "acceptAtCheckout">;
  mailer: Pick<Mailer, "send">;
  /** The app's public origin: the email's links. */
  baseURL: string;
  /** The Legal Text Versions (#546); defaults to the ones this build carries. */
  registry?: () => readonly LegalTextVersionRecord[];
  now?: () => Date;
}

export interface Orders {
  /** What the Order page shows for `item`; null when it cannot be ordered (Free, a Plan not offered, an unknown Human Coach, Coaching Sessions not payable yet). */
  terms(candidateId: string, item: OrderItem): Promise<OrderTerms | null>;
  /**
   * « Passer au paiement »: checks the boxes, then creates the Checkout Session and records the Order and its
   * Acceptance; « cgv_required » (and no Checkout Session) when the CGV box of the version in effect is not ticked.
   * Throws what billing throws (a Plan not offered, a code refused, Stripe unavailable).
   */
  place(candidate: { id: string; email: string }, item: OrderItem, answers: OrderAnswers, language: Locale): Promise<PlaceOrderResult>;
  /** A Checkout Stripe's signed webhook confirmed: emails its Order Confirmation once. Throws when the mailer fails, so Stripe delivers it again. */
  paid(checkout: PaidCheckout): Promise<void>;
  /**
   * Whether the Candidate made the Immediate Performance Request when ordering the contract (the subscription a Plan's
   * Order started, or a Coaching Session, by its Checkout Session); false for one not ordered on the page.
   */
  immediateExecutionRequested(contract: { subscriptionId: string } | { coachingSessionId: string }): Promise<boolean>;
}

interface OrderRow {
  checkout_session_id: string;
  candidate_id: string;
  kind: "plan" | "coaching_session";
  subject: PlanName;
  price_amount: number | null;
  price_currency: string | null;
  price_interval: BillingInterval | null;
  cgv_version: string | null;
  cgv_url: string | null;
  immediate_execution_requested: boolean;
  language: Locale;
}

export function createOrders(database: Pool, deps: OrdersDeps): Orders {
  const now = deps.now ?? (() => new Date());
  const registry = deps.registry ?? legalTextRegistry;
  const cgvInEffect = () => legalTextVersionInEffect("cgv", parisDay(now()), registry());
  const absolute = (path: string) => new URL(path, deps.baseURL).toString();

  async function summaryOf(candidateId: string, item: OrderItem): Promise<OrderSummary | null> {
    if (item.kind === "plan") {
      if (item.plan === FREE_PLAN) return null;
      const plan = (await deps.billing.plans()).find((each) => each.key === item.plan && each.status === "offered" && each.stripeProductId !== null);
      if (!plan) return null;
      const price = (await deps.billing.planPrices())?.[plan.key];
      return { kind: "plan", subject: plan.name, price: price ? { amount: price.amount, currency: price.currency, interval: price.interval } : null };
    }
    const coach = (await deps.coaches.list()).find((each) => each.id === item.coachId);
    if (!coach) return null;
    const price = await deps.billing.coachingSessionPrice(candidateId);
    if (!price) return null;
    return { kind: "coachingSession", subject: { fr: coach.name, en: coach.name }, price: { amount: price.amount, currency: price.currency, interval: null } };
  }

  return {
    async terms(candidateId, item) {
      const summary = await summaryOf(candidateId, item);
      return summary ? { summary, cgv: cgvInEffect() } : null;
    },

    async place(candidate, item, answers, language) {
      const cgv = cgvInEffect();
      if (cgv && answers.cgv !== cgv.version) return { ok: false, error: "cgv_required" };
      const immediateExecutionRequested = answers.immediateExecution === IMMEDIATE_EXECUTION_REQUESTED;
      // Read before Checkout: what the Order Confirmation sums up is what the page showed.
      const summary = await summaryOf(candidate.id, item);
      if (!summary) return { ok: false, error: "not_orderable" };
      const started =
        item.kind === "plan"
          ? await deps.billing.startCheckout(candidate, item.plan, language, { promotionCode: item.promotionCode })
          : await deps.billing.startCoachingSessionCheckout(candidate, item.coachId, language);
      // The customer portal, for a Candidate who already pays: no Checkout, no Order.
      if (!started.checkoutSessionId) return { ok: true, url: started.url };
      await database.query(
        `INSERT INTO checkout_order (checkout_session_id, candidate_id, kind, subject, price_amount, price_currency, price_interval, cgv_version, cgv_url,
                                     immediate_execution_requested, language, ordered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          started.checkoutSessionId,
          candidate.id,
          item.kind === "plan" ? "plan" : "coaching_session",
          JSON.stringify(summary.subject),
          summary.price?.amount ?? null,
          summary.price?.currency ?? null,
          summary.price?.interval ?? null,
          cgv?.version ?? null,
          cgv?.url ?? null,
          immediateExecutionRequested,
          language,
          now(),
        ],
      );
      if (cgv) {
        await deps.acceptances.acceptAtCheckout(candidate.id, {
          channel: item.kind === "plan" ? "paiement_plan" : "paiement_coaching",
          checkoutSessionId: started.checkoutSessionId,
          immediateExecutionRequested,
        });
      }
      return { ok: true, url: started.url };
    },

    async paid(checkout) {
      // Taken first, so two deliveries at once send one email; given back if the mailer fails.
      const { rows } = await database.query<OrderRow & { email: string }>(
        `UPDATE checkout_order o SET confirmation_sent_at = $3, subscription_id = COALESCE(o.subscription_id, $2)
           FROM candidate c
          WHERE o.checkout_session_id = $1 AND o.confirmation_sent_at IS NULL AND c.id = o.candidate_id
          RETURNING o.*, c.email`,
        [checkout.checkoutSessionId, checkout.subscriptionId, now()],
      );
      const order = rows[0];
      if (!order) {
        if (checkout.subscriptionId) {
          await database.query("UPDATE checkout_order SET subscription_id = COALESCE(subscription_id, $2) WHERE checkout_session_id = $1", [checkout.checkoutSessionId, checkout.subscriptionId]);
        }
        return;
      }
      const concludedAt = now();
      const email = orderConfirmationEmail(
        {
          kind: order.kind === "plan" ? "plan" : "coachingSession",
          subject: order.subject[order.language],
          paidAt: concludedAt,
          paid: { amount: checkout.amount, currency: checkout.currency },
          price: order.price_amount === null || !order.price_currency ? null : { amount: order.price_amount, currency: order.price_currency, interval: order.price_interval },
          cgv: order.cgv_version && order.cgv_url ? { version: order.cgv_version, url: absolute(order.cgv_url) } : null,
          immediateExecutionRequested: order.immediate_execution_requested,
          withdrawal: { url: absolute(order.kind === "plan" ? routes.withdrawal("plan") : routes.agenda()), until: withdrawalDeadline(concludedAt) },
        },
        order.language,
      );
      try {
        await deps.mailer.send({ to: order.email, ...email });
      } catch (error) {
        await database.query("UPDATE checkout_order SET confirmation_sent_at = NULL WHERE checkout_session_id = $1", [order.checkout_session_id]);
        throw error;
      }
    },

    async immediateExecutionRequested(contract) {
      const { rows } = await database.query<{ requested: boolean }>(
        "subscriptionId" in contract
          ? "SELECT immediate_execution_requested AS requested FROM checkout_order WHERE subscription_id = $1"
          : `SELECT o.immediate_execution_requested AS requested
               FROM checkout_order o JOIN coaching_session s ON s.stripe_checkout_session_id = o.checkout_session_id
              WHERE s.id = $1::uuid`,
        ["subscriptionId" in contract ? contract.subscriptionId : contract.coachingSessionId],
      );
      return rows.some((row) => row.requested);
    },
  };
}

/** An Order as the Data export holds it: no Stripe identifiers. */
export interface ExportedOrder {
  kind: "plan" | "coachingSession";
  subject: PlanName;
  /** The CGV version accepted with it; null when none was in effect. */
  cgvVersion: string | null;
  immediateExecutionRequested: boolean;
  orderedAt: Date;
  /** When its Order Confirmation was emailed; null until Stripe confirmed the payment. */
  confirmationSentAt: Date | null;
}

/** The Candidate's Orders, oldest first, for their Data export. */
export async function ordersOf(database: Queryable, candidateId: string): Promise<ExportedOrder[]> {
  const { rows } = await database.query<{
    kind: "plan" | "coaching_session";
    subject: PlanName;
    cgv_version: string | null;
    immediate_execution_requested: boolean;
    ordered_at: Date;
    confirmation_sent_at: Date | null;
  }>(
    `SELECT kind, subject, cgv_version, immediate_execution_requested, ordered_at, confirmation_sent_at
       FROM checkout_order WHERE candidate_id = $1 ORDER BY ordered_at, checkout_session_id`,
    [candidateId],
  );
  return rows.map((row) => ({
    kind: row.kind === "plan" ? "plan" : "coachingSession",
    subject: row.subject,
    cgvVersion: row.cgv_version,
    immediateExecutionRequested: row.immediate_execution_requested,
    orderedAt: row.ordered_at,
    confirmationSentAt: row.confirmation_sent_at,
  }));
}

/** Creates or upgrades the Orders table. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateOrders(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS checkout_order (
      -- One Order per Checkout Session: the Order Confirmation is sent once for it.
      checkout_session_id text PRIMARY KEY,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('plan', 'coaching_session')),
      -- The Plan's name, or the Human Coach's, in each Interface Language, as the page showed it.
      subject jsonb NOT NULL,
      price_amount integer,
      price_currency text,
      price_interval text,
      cgv_version text,
      cgv_url text,
      immediate_execution_requested boolean NOT NULL,
      language text NOT NULL,
      ordered_at timestamptz NOT NULL,
      -- The subscription a Plan's Order started, from Stripe's webhook.
      subscription_id text,
      confirmation_sent_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS checkout_order_candidate_id_idx ON checkout_order (candidate_id);
    CREATE INDEX IF NOT EXISTS checkout_order_subscription_id_idx ON checkout_order (subscription_id) WHERE subscription_id IS NOT NULL;
  `);
}
