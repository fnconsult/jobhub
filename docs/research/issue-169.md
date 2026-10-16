# Research for issue #169: Billing success page refresh and scheduled cancellation date

Scope: only the Stripe facts needed to implement issue #169. Sources are Stripe first-party docs, fetched 2026-10-16.

## 1. Detecting a cancellation scheduled for period end

Source: https://docs.stripe.com/billing/subscriptions/cancel

- Cancelling at period end sets `cancel_at_period_end = true` on the Subscription. The subscription stays active (`status` unchanged) until the period ends, then `customer.subscription.deleted` is sent.
- `customer.subscription.updated` is sent for any update, including when `cancel_at_period_end` becomes `true`. Un-cancelling sets it back to `false` (same event).
- A cancellation can also be expressed as a custom `cancel_at` timestamp (Dashboard "at a date of your choice", subscription schedules with `end_behavior: cancel`). In that case `cancel_at_period_end` may be `false` while `cancel_at` is set. Implication (inference): derive "ends on" from `cancel_at` when present, else from the item period end when `cancel_at_period_end` is true; do not rely on the boolean alone.
- Today `apps/web/src/billing/index.ts` (~line 350-375) stores only plan, subscription id, status and event time; the end date is not persisted, so a schedule-only change leaves nothing to display. The same handler must treat `customer.subscription.updated` carrying only a cancellation change as a state change to store.

## 2. Where the end date lives (API version trap)

Source: https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end

- From API version `2025-03-31.basil`, `current_period_start` / `current_period_end` are removed from Subscription and exist on each SubscriptionItem: `items.data[].current_period_end`.
- Reading `subscription.current_period_end` returns undefined on those versions. Use `cancel_at` (top-level, unchanged) or `items.data[0].current_period_end`.
- Plans here are a single-item subscription, so item 0 is enough (inference).
- The version a webhook payload uses is the webhook endpoint's configured version, not the SDK's. `new Stripe(...)` in `index.ts` pins no `apiVersion`, so the SDK (`stripe ^23`) uses its bundled version; the endpoint version must be checked in the Dashboard / test fixtures. Be tolerant: read `cancel_at` first, then item period end. The fake Stripe (`fake-stripe.ts`) must emit the same shape as real Stripe.
- Source for webhook versioning: https://docs.stripe.com/webhooks/versioning (not fetched in detail; verify when touching endpoint config).

## 3. Success page versus webhook timing

Source: https://docs.stripe.com/checkout/fulfillment

- Webhooks are the reliable path; the redirect page cannot be relied on for fulfillment, and webhooks "can sometimes be delayed".
- With a `success_url` and a webhook endpoint listening to `checkout.session.completed`, hosted Checkout waits up to 10 seconds for the endpoint to respond before redirecting (not for organization-level endpoints; with Stripe CLI listen it redirects immediately).
- Recommended: also run fulfillment idempotently from the landing page using the `{CHECKOUT_SESSION_ID}` placeholder in `success_url`, retrieving the Checkout Session and checking `payment_status`.
- Implication: the issue's symptom (stays on Gratuite until reload despite 200 in 3 s) is a race between the redirect render and the DB write, or a page that never re-reads. Two valid fixes: (a) on `?checkout=success`, poll/refresh the plan until it changes (bounded), or (b) fulfil from the success page by retrieving the session/subscription from Stripe (needs `session_id` in `success_url`). Both are consistent with Stripe's guidance; (b) must be idempotent against the webhook, and the existing `stripe_event_at` ordering guard should not be bypassed.

## 4. Event ordering and retries

Source: https://docs.stripe.com/checkout/fulfillment (retries section links to https://docs.stripe.com/webhooks#automatic-retries)

- Stripe retries failed webhook deliveries automatically; handlers must be idempotent. The existing guard on `stripe_event_at` / stage is the repo's answer; storing the new cancellation fields must go through the same guarded UPDATE.

## Open points for the implementer

- Confirm the webhook endpoint API version in the Stripe test account (decides whether `current_period_end` is on the subscription or the item).
- Customer portal "prend fin le ..." date shown to the user equals the end of the paid period, i.e. `cancel_at` for portal cancellations (inference from section 1; verify against a test-mode event payload).
