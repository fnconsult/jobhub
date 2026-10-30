import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeCustomerId, FAKE_STRIPE_PRICES, refundEvent, signedEvent, subscriptionEvent } from "./fake-stripe";
import type { RefundChange } from "./index";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

/**
 * What a Withdrawal (#511) asks of billing: since when the Candidate's subscription runs, ending it at once with what
 * was paid on it, what a Coaching Session was paid with, full refunds, and Stripe telling a refund's fate.
 */
describe.skipIf(!connectionString)("Billing for Withdrawals (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  const refundChanges: RefundChange[] = [];
  beforeEach(async () => {
    refundChanges.length = 0;
    t = await startTestBilling({ onRefundChanged: async (change) => void refundChanges.push(change) });
  });
  afterEach(async () => {
    await t.stop();
  });

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }

  /** Marie, subscribed to `plan` on `startedAt` (Stripe's start date), as Stripe reports it at `reportedAt`. */
  async function subscribed(plan: "standard" | "premium", startedAt: Date, reportedAt = startedAt) {
    const marie = await t.signUp("marie.dupont@example.fr");
    await t.billing.startCheckout(marie, plan);
    const customer = fakeCustomerId(marie.email);
    await deliver(subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES[plan], status: "active", startDate: startedAt }, reportedAt));
    return { ...marie, customer, subscriptionId: `sub_fake_${customer}` };
  }

  describe("the Candidate's subscription", () => {
    it("is their paid Plan with the day Stripe started it", async () => {
      const startedAt = new Date("2026-10-12T09:30:00Z");
      const marie = await subscribed("standard", startedAt);

      expect(await t.billing.subscription(marie.id)).toEqual({ id: marie.subscriptionId, plan: "standard", planName: { fr: "Standard", en: "Standard" }, startedAt });
    });

    it("keeps its start when the Plan is changed in the customer portal: no new contract", async () => {
      const startedAt = new Date("2026-10-12T09:30:00Z");
      const marie = await subscribed("standard", startedAt);

      await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active", startDate: startedAt }, new Date("2026-10-13T09:00:00Z")));

      expect(await t.billing.subscription(marie.id)).toMatchObject({ plan: "premium", startedAt });
    });

    it("is none on Free", async () => {
      const paul = await t.signUp("paul.martin@example.fr");

      expect(await t.billing.subscription(paul.id)).toBeNull();
    });

    it("asks Stripe once when it started, for a subscription reported before its start was kept", async () => {
      const startedAt = new Date("2026-10-12T09:30:00Z");
      const marie = await subscribed("standard", startedAt);
      await t.database.query("UPDATE candidate_plan SET subscription_started_at = NULL");
      t.stripe.setSubscriptionStart(marie.subscriptionId, startedAt);

      expect(await t.billing.subscription(marie.id)).toMatchObject({ startedAt });
      expect(await t.billing.subscription(marie.id)).toMatchObject({ startedAt });
      expect(t.stripe.callsTo(`/v1/subscriptions/${marie.subscriptionId}`)).toHaveLength(1);
    });
  });

  describe("ending a subscription at once", () => {
    it("cancels it in Stripe now (no Scheduled Cancellation), puts the Candidate on Free and gives each payment made on it", async () => {
      const marie = await subscribed("standard", new Date("2026-10-12T09:30:00Z"));
      const paymentIntent = t.stripe.payInvoice(marie.subscriptionId, 1900);

      const payments = await t.billing.endSubscriptionNow(marie.id);

      expect(payments).toEqual([{ id: paymentIntent, amount: 1900, currency: "eur" }]);
      expect(t.stripe.callsTo(`/v1/subscriptions/${marie.subscriptionId}`)).toEqual([expect.objectContaining({ method: "DELETE" })]);
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "free", endsAt: null });
      expect(await t.billing.subscription(marie.id)).toBeNull();
    });

    it("stays on Free when an older report of the subscription arrives late", async () => {
      const marie = await subscribed("standard", new Date("2026-10-12T09:30:00Z"));
      await t.billing.endSubscriptionNow(marie.id);

      await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }, new Date("2026-10-14T09:00:00Z")));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("gives nothing to refund for a subscription a 100 % code made free", async () => {
      const marie = await subscribed("standard", new Date("2026-10-12T09:30:00Z"));
      t.stripe.payInvoice(marie.subscriptionId, 0);

      expect(await t.billing.endSubscriptionNow(marie.id)).toEqual([]);
    });

    it("is null on Free: there is nothing to end", async () => {
      const paul = await t.signUp("paul.martin@example.fr");

      expect(await t.billing.endSubscriptionNow(paul.id)).toBeNull();
    });
  });

  describe("refunds", () => {
    it("refund a payment in full, as the customer asked, once per key however often it is asked", async () => {
      const marie = await subscribed("standard", new Date("2026-10-12T09:30:00Z"));
      const paymentIntent = t.stripe.payInvoice(marie.subscriptionId, 1900);
      const payment = { id: paymentIntent, amount: 1900, currency: "eur" };

      const first = await t.billing.refund(payment, "withdrawal-1-refund-1", { withdrawal_id: "1" });
      const again = await t.billing.refund(payment, "withdrawal-1-refund-1", { withdrawal_id: "1" });

      expect(first).toEqual({ ok: true, id: expect.stringMatching(/^re_/), status: "succeeded" });
      expect(again).toEqual(first);
      expect(t.stripe.refunds()).toEqual([expect.objectContaining({ payment_intent: paymentIntent, amount: 1900, status: "succeeded" })]);
      expect(t.stripe.callsTo("/v1/refunds")[0]!.params.get("reason")).toBe("requested_by_customer");
      expect(t.stripe.callsTo("/v1/refunds")[0]!.params.get("metadata[withdrawal_id]")).toBe("1");
      expect(t.stripe.callsTo("/v1/refunds")[0]!.params.has("amount")).toBe(false);
    });

    it("say why Stripe refused one", async () => {
      const marie = await subscribed("standard", new Date("2026-10-12T09:30:00Z"));
      const paymentIntent = t.stripe.payInvoice(marie.subscriptionId, 1900);
      t.stripe.refuseRefunds("insufficient_funds");

      expect(await t.billing.refund({ id: paymentIntent, amount: 1900, currency: "eur" }, "k", {})).toEqual({ ok: false, reason: "insufficient_funds" });
    });

    it("find what a Coaching Session was paid with, from its Checkout Session", async () => {
      const paymentIntent = t.stripe.payCheckoutSession("cs_session_1", 9000);

      expect(await t.billing.coachingSessionPayment("cs_session_1")).toEqual({ id: paymentIntent, amount: 9000, currency: "eur" });
    });

    it("tell when Stripe reports a refund failed later, from its signed webhook", async () => {
      await deliver(refundEvent("refund.failed", { id: "re_1", paymentIntent: "pi_1", amount: 1900, status: "failed", failureReason: "expired_or_canceled_card" }));
      await deliver(refundEvent("refund.updated", { id: "re_2", paymentIntent: "pi_2", amount: 1900, status: "succeeded" }));

      expect(refundChanges).toEqual([
        { id: "re_1", status: "failed", failureReason: "expired_or_canceled_card" },
        { id: "re_2", status: "succeeded", failureReason: null },
      ]);
    });
  });
});
