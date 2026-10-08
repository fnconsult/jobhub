import { expect, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../../apps/web/src/billing/fake-stripe";

/**
 * Puts the Candidate signed in on `page` (as `email`) on a paid Plan, the way
 * it happens for real: a Stripe Checkout from the subscription page, then
 * Stripe's signed webhook (the fake Stripe on E2E_STRIPE_URL). For tests whose
 * Candidate needs more than the Free Plan's quotas (Profiles, Match Scores).
 */
export async function subscribe(page: Page, email: string, plan: "standard" | "premium") {
  const origin = process.env.E2E_WEB_ORIGIN!;
  const checkout = await page.request.post("/api/billing/checkout", { form: { plan }, headers: { origin }, maxRedirects: 0 });
  expect(checkout.status()).toBe(303);
  expect(checkout.headers().location).toMatch(/^https:\/\/checkout\.stripe\.test\//);

  const event = subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES[plan], status: "active" });
  const { payload, signature } = signedEvent(event);
  const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
  expect(delivered.status()).toBe(200);
}
