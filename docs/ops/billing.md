# Billing: Stripe account settings

Decision: ADR-0014 (and its addenda). The app follows Stripe: a Candidate's Plan is whatever their subscription says, through the signed webhook. A few behaviours depend on settings in the Stripe Dashboard that the API does not expose, so the app cannot check them at start-up. Check them here when a Stripe account is set up (test mode and live mode each have their own), and after any change to its billing settings.

## Checklist

1. **Failed payments end the subscription.** Dashboard → Settings → Billing → Subscriptions and emails → *Manage failed payments for subscriptions*: after the last retry, **cancel the subscription**. Not "leave it past due" or "mark it unpaid".
   - Why: a subscription keeps its paid Plan while `past_due` (Stripe is retrying a card). Only its end (`customer.subscription.deleted`) brings the Candidate back to Free.
   - A subscription with **no card** (one started with a 100 % Coupon, #207) is dropped to Free by the webhook as soon as it goes `past_due`, whatever this setting. The subscription still lingers in Stripe until this setting cancels it.
2. **The webhook endpoint** (`/api/billing/webhook`) sends `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `refund.updated` and `refund.failed`. Its signing secret is `STRIPE_WEBHOOK_SECRET` (or the Provider Secret of the same name).
   - The list is `STRIPE_WEBHOOK_EVENTS` (`apps/web/src/billing/webhook-events.ts`); a test fails when this line misses one of them.
   - Why the `refund.*` events: a Withdrawal's refund usually fails days later, at the bank (#511, ADR-0071). Without them, Stripe never reports the failure, and the Withdrawal never shows as « Échoué » in the Back Office's « Rétractations », where it can be retried. An endpoint set up before #511 needs them added (Workbench → Webhooks → the destination → Edit).
3. **Plans' products are priced in euros.** Fixed-amount Coupons are in euros, and the Back Office refuses them on a Plan priced in another currency.
4. **The customer portal** lets Candidates update their payment method and switch or cancel their Plan (Dashboard → Settings → Billing → Customer portal).

## Coupons

Coupons are created and deactivated in the Back Office (Codes promo), never edited: Stripe keeps a coupon's terms. A code made or deactivated in the Dashboard shows up in the Back Office list too, but not in the Journal. "First payment only" is Stripe's first-time-transaction rule: it is refused to anyone who has already paid anything, a Coaching Session included.

## Human Coach Connect (#878)

Connect is closed until the current human-authored CGV, privacy policy and private B2B contract explicitly declare `coaching_capabilities: [stripe-connect, marketplace]`. This metadata belongs in each approved immutable Legal Text file, equal in FR/EN. New coverage requires a substantial version and the ordinary legal notice checks. No coverage is inferred from an old text or a Platform Setting; #889/#890/#518 remain human gates. Automated E2E coverage is an explicit external preload, ignored in production/staging, never a shipped approval.

Use stable v1 Express-equivalent controller properties in France: requirements collected by Stripe, Express dashboard, fees and negative-payment-balance losses borne by the application. Do not change this to the unsupported preview combination from the earlier #848 research. Stripe handles KYC; the app stores no raw identity documents or bank account.

Create a separate **connected-account** snapshot-event destination at `/api/coaching/connect/webhook`, with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `refund.updated` and `refund.failed`; store its distinct signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET` (Provider Secrets or env). The existing `/api/billing/webhook` remains scoped to your platform account. Events arriving from a connected account there are ignored. Account eligibility is always retrieved fresh from Stripe, not set by the browser or an out-of-order status event.

The coaching Back Office defines the Commission for a third-party Seller. For Jobbbox retail sales it must explicitly set the professional compensation recipient and coach share (10000 basis points = 100%). No default remuneration is inferred. These changes share a transaction with their Back Office Audit; existing payment contexts preserve their original beneficiary and amounts.

The ten-minute worker checks monthly eligibility and recovers in-flight operations; one unique batch per Seller/month/currency prevents another monthly allocation. Each payment waits for the French withdrawal deadline and settled funds. Direct charges remain on the connected account with an application fee. Jobbbox compensation uses separate transfers; later refunds can reverse prior platform transfers and offset new earnings. Unresolved disputes are withheld. An unknown operation older than Stripe’s idempotency window requires reconciliation; the worker finds a matching transfer/payout by durable batch metadata before retrying, and never guesses that money was not sent.

A failed bank payout keeps its allocation and Stripe reference for Support reconciliation. Repair the bank information in Stripe and reconcile the original operation before any replacement; do not delete the batch or alter allocations to force payment. Financial retention and tax information remain proposed under human #890/#889 review. No production deployment or activation is implied by this implementation.
