/**
 * The Stripe events Jobbbox acts on, from its signed webhook (`/api/billing/webhook`). The one list: the webhook's
 * handlers are keyed by it (billing/index.ts), and the setup instructions read it (the Back Office Assistant's Stripe
 * webhook guide, docs/ops/billing.md), so a destination set up from them is subscribed to every event a handler waits
 * for. An event missing from the destination is never sent: Stripe does not tell that nobody asked for it.
 */
import type Stripe from "stripe";

export const STRIPE_WEBHOOK_EVENTS = [
  // A Plan: started, changed, ended (ADR-0014).
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // A Coaching Session paid (ADR-0016).
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  // A Withdrawal's refund, which can fail days later (#511).
  "refund.updated",
  "refund.failed",
] as const satisfies readonly Stripe.Event.Type[];

export type StripeWebhookEvent = (typeof STRIPE_WEBHOOK_EVENTS)[number];
