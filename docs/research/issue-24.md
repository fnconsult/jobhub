# Research for issue #24: Human Coach sessions and Coach Access

Scope: only the external facts needed to implement Coaching Session payment (Stripe) and coach booking (Cal.com). Coach Access is internal (no external dependency). Fetched 2026-10-09.

## Stripe Checkout (one-time Coaching Session Price)
Source: https://docs.stripe.com/payments/checkout
- Checkout Sessions API; full-page hosted UI is the recommended option and supports discounts and promotion codes.

Source: https://docs.stripe.com/checkout/fulfillment (hosted variant)
- Webhooks are mandatory for fulfillment; never rely on the success page alone.
- Handle `checkout.session.completed` and `checkout.session.async_payment_succeeded`; optionally `checkout.session.async_payment_failed`.
- Fulfillment must be idempotent (may run several times, even concurrently, per Checkout Session ID): store fulfillment state per session ID.
- Retrieve the session and check `payment_status` (fulfill unless `unpaid`) before granting the booking.
- Verify the webhook signature with the endpoint secret (`whsec_...`) against the raw body.
- Set `success_url` with the `{CHECKOUT_SESSION_ID}` placeholder; Checkout waits up to 10 s for the webhook response before redirecting, so respond fast.
- Local testing: `stripe listen --forward-to ...`; test card 4242 4242 4242 4242.

Source: https://docs.stripe.com/payments/checkout/promotions.md (index; details on /discounts.md not fetched)
- Premium discount: either use a second Price or apply a coupon/discount on the Session. Exact `discounts` parameter shape NOT verified here; read https://docs.stripe.com/payments/checkout/discounts before implementing. Simplest to verify: two Prices (standard, Premium) chosen server-side from the Candidate's plan (ADR-0014).
- Coach payout: out of scope (coaches are paid outside the platform), so no Stripe Connect needed.

## Cal.com (coach booking link)
Source: https://cal.com/docs/api-reference/v2/introduction
- API v2 auth: `Authorization: Bearer <key>` (`cal_live_` for live); default 120 req/min. Platform/OAuth-client plan is deprecated, closed to new customers: do not build on it.

Source: https://cal.com/docs/developing/guides/automation/webhooks
- Triggers include `BOOKING_CREATED`, cancelled, rescheduled, `Booking Paid`.
- Verify HMAC-SHA256 of the raw body with the webhook secret against header `x-cal-signature-256`.
- Payload: `{triggerEvent, createdAt, payload}`; `payload` has `uid`, `bookingId`, `organizer`, `attendees[]` (email, name), `metadata`.

## NOT verified (decide before implementing)
- Whether a plain booking-link URL can prefill attendee name/email or carry metadata via query params (docs fetched did not state it; the Booker atom has `defaultFormValues`/`metadata` props but is a Platform feature).
- Cal.com embed snippet instructions and any embed licensing/pricing terms (page URL tried returned 404).
- Cal.com free-tier limits for individual coach accounts.
- Safest design: admin stores only the coach's public Cal.com link; link the Candidate to it after Stripe payment is confirmed. Matching a Cal.com booking to a paid session via webhook would depend on the unverified prefill/metadata point (fallback: match on attendee email).

## Implications
- Create the Checkout Session server-side with the plan-dependent price; record the Coaching Session as paid only from a verified, idempotent webhook.
- Reveal the booking link only after payment is confirmed.
- Coach Access and Tailored Document review are internal authorization (read-only); no external facts needed.
