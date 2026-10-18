# Billing: Stripe account settings

Decision: ADR-0014 (and its addenda). The app follows Stripe: a Candidate's Plan is whatever their subscription says, through the signed webhook. A few behaviours depend on settings in the Stripe Dashboard that the API does not expose, so the app cannot check them at start-up. Check them here when a Stripe account is set up (test mode and live mode each have their own), and after any change to its billing settings.

## Checklist

1. **Failed payments end the subscription.** Dashboard → Settings → Billing → Subscriptions and emails → *Manage failed payments for subscriptions*: after the last retry, **cancel the subscription**. Not "leave it past due" or "mark it unpaid".
   - Why: a subscription keeps its paid Plan while `past_due` (Stripe is retrying a card). Only its end (`customer.subscription.deleted`) brings the Candidate back to Free.
   - A subscription with **no card** (one started with a 100 % Coupon, #207) is dropped to Free by the webhook as soon as it goes `past_due`, whatever this setting. The subscription still lingers in Stripe until this setting cancels it.
2. **The webhook endpoint** (`/api/billing/webhook`) sends `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Its signing secret is `STRIPE_WEBHOOK_SECRET` (or the Provider Secret of the same name).
3. **Plans' products are priced in euros.** Fixed-amount Coupons are in euros, and the Back Office refuses them on a Plan priced in another currency.
4. **The customer portal** lets Candidates update their payment method and switch or cancel their Plan (Dashboard → Settings → Billing → Customer portal).

## Coupons

Coupons are created and deactivated in the Back Office (Codes promo), never edited: Stripe keeps a coupon's terms. A code made or deactivated in the Dashboard shows up in the Back Office list too, but not in the Journal. "First payment only" is Stripe's first-time-transaction rule: it is refused to anyone who has already paid anything, a Coaching Session included.
