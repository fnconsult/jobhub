import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_STRIPE_PRICES, fakeCustomerId, signedEvent, subscriptionEvent } from "./fake-stripe";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

describe.skipIf(!connectionString)("ending a subscription with a prorata refund (#514, needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  beforeEach(async () => {
    t = await startTestBilling();
  });
  afterEach(async () => {
    await t.stop();
  });

  async function subscriber(email: string, status = "active") {
    const candidate = await t.signUp(email);
    await t.billing.startCheckout(candidate, "standard");
    const customer = fakeCustomerId(email);
    const event = signedEvent(subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.standard, status }, new Date("2026-10-01T10:00:00+02:00")));
    await t.billing.handleStripeWebhook(event.payload, event.signature);
    return { ...candidate, subscription: `sub_fake_${customer}` };
  }

  it("lists the Candidates paying for a Plan, not those on another Plan or whose subscription stopped", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    const paul = await subscriber("paul.martin@example.fr", "past_due");
    await subscriber("lea.bernard@example.fr", "canceled");
    await t.signUp("jean.petit@example.fr");

    expect((await t.billing.subscribersOf("standard")).sort()).toEqual([marie.id, paul.id].sort());
    expect(await t.billing.subscribersOf("premium")).toEqual([]);
    expect(await t.billing.subscribersOf("free")).toEqual([]);
  });

  it("cancels the subscription now and refunds the part of the paid period not used yet", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    // Paid 9,99 € for 1 to 31 October; the clock says 15 October, 10:00 in Paris.
    t.stripe.payPeriod(marie.subscription, { amount: 999, start: new Date("2026-10-01T00:00:00+02:00"), end: new Date("2026-10-31T00:00:00+01:00") });

    const ended = await t.billing.endSubscriptionWithProrataRefund(marie.id, "quota-reduction-1");

    const unused = (new Date("2026-10-31T00:00:00+01:00").getTime() - t.clock.now.getTime()) / (new Date("2026-10-31T00:00:00+01:00").getTime() - new Date("2026-10-01T00:00:00+02:00").getTime());
    expect(ended).toEqual({ ok: true, refund: { id: expect.stringMatching(/^re_/), amount: Math.round(999 * unused), currency: "eur" } });
    expect(t.stripe.refunds()).toEqual([expect.objectContaining({ amount: Math.round(999 * unused), payment_intent: expect.stringMatching(/^pi_/) })]);
    expect(t.stripe.callsTo(`/v1/subscriptions/${marie.subscription}`).map((call) => call.method)).toContain("DELETE");
    expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
  });

  it("asked again (a second click, a retry), refunds once: Stripe answers the same refund to the same key", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    t.stripe.payPeriod(marie.subscription, { amount: 999, start: new Date("2026-10-01T00:00:00+02:00"), end: new Date("2026-10-31T00:00:00+01:00") });

    const first = await t.billing.endSubscriptionWithProrataRefund(marie.id, "quota-reduction-1");
    const again = await t.billing.retryProrataRefund(marie.subscription, "quota-reduction-1", t.clock.now);

    expect(again).toEqual(first);
    expect(t.stripe.refunds()).toHaveLength(1);
  });

  it("a subscription a 100 % code made free ends with nothing to refund", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    t.stripe.payPeriod(marie.subscription, { amount: 0, start: new Date("2026-10-01T00:00:00+02:00"), end: new Date("2026-10-31T00:00:00+01:00") });

    expect(await t.billing.endSubscriptionWithProrataRefund(marie.id, "quota-reduction-1")).toEqual({ ok: true, refund: null });
    expect(t.stripe.refunds()).toEqual([]);
    expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
  });

  it("a refund Stripe refuses still ends the subscription, and says why", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    t.stripe.payPeriod(marie.subscription, { amount: 999, start: new Date("2026-10-01T00:00:00+02:00"), end: new Date("2026-10-31T00:00:00+01:00") });
    t.stripe.refuseRefunds("charge_disputed");

    const unused = (new Date("2026-10-31T00:00:00+01:00").getTime() - t.clock.now.getTime()) / (new Date("2026-10-31T00:00:00+01:00").getTime() - new Date("2026-10-01T00:00:00+02:00").getTime());
    // What was to be refunded is kept with the refusal, for Support to refund in Stripe.
    expect(await t.billing.endSubscriptionWithProrataRefund(marie.id, "quota-reduction-1")).toEqual({
      ok: false,
      reason: "charge_disputed",
      subscription: marie.subscription,
      due: { amount: Math.round(999 * unused), currency: "eur" },
    });
    expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
  });

  it("nothing to end on Free", async () => {
    const jean = await t.signUp("jean.petit@example.fr");

    expect(await t.billing.endSubscriptionWithProrataRefund(jean.id, "quota-reduction-1")).toBeNull();
  });
});
