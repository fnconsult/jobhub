import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { startTestBilling, connectionString } from "./test-support";
import { stripeConnect } from "../coaching-connect/stripe";
import { FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET, signedEvent } from "./fake-stripe";
describe.skipIf(!connectionString)("billing routing for Connect direct charges", () => {
  let test: Awaited<ReturnType<typeof startTestBilling>>, accountId: string, sessionId: string;
  beforeEach(async () => {
    test = await startTestBilling({ connectedCoachingPayment: async (id) => (id === sessionId ? { accountId, paymentIntent: null } : null) });
    const port = stripeConnect({ secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: test.stripe.url });
    accountId = (await port.account({ id: "connect-business", kind: "human_coach", name: "Coach", email: "coach@example.test" }, "connect-owner")).id;
    await fetch(`${test.stripe.url}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: accountId }) });
    sessionId = (
      await port.checkout(
        {
          contextId: "private-payment-context",
          accountId,
          amount: 9000,
          currency: "eur",
          commission: 1800,
          title: "Coaching",
          email: "buyer@example.test",
          locale: "fr",
          successUrl: "http://localhost/coachs",
          cancelUrl: "http://localhost/coachs",
        },
        "paid-checkout",
      )
    ).id;
  }, 60000);
  afterEach(async () => {
    await test.stop();
  }, 60000);
  it("refunds the original account and returns its application fee, keeping platform subscriptions separate", async () => {
    const payment = await test.billing.coachingSessionPayment(sessionId);
    expect(payment).toMatchObject({ amount: 9000, stripeAccount: accountId });
    expect(await test.billing.refund(payment!, "withdrawal-connect", { withdrawal_id: "test-fixture" })).toMatchObject({ ok: true, status: "succeeded" });
    const call = test.stripe.calls.find((c) => c.path === "/v1/refunds" && c.method === "POST")!;
    expect(call.account).toBe(accountId);
    expect(call.params.get("refund_application_fee")).toBe("true");
    const port = stripeConnect({ secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: test.stripe.url });
    expect(await port.payment(payment!.id, accountId)).toMatchObject({ refunded: 9000, refundedCommission: 1800 });
    expect(await test.billing.refund(payment!, "withdrawal-connect", { withdrawal_id: "test-fixture" })).toMatchObject({ ok: true });
  });
  it("ignores connected-account events on the platform webhook rather than trusting their Candidate metadata", async () => {
    const paid = vi.fn();
    test.config.onConnectedCoachingPaid = paid;
    const event = {
      id: "evt_connect_wrong_destination",
      object: "event",
      type: "checkout.session.completed",
      account: accountId,
      data: {
        object: {
          id: sessionId,
          mode: "payment",
          payment_status: "paid",
          amount_total: 9000,
          currency: "eur",
          metadata: { purpose: "coaching_session", coach_id: "00000000-0000-4000-8000-000000000000", candidate_id: "spoofed" },
        },
      },
    };
    const signed = signedEvent(event);
    await test.billing.handleStripeWebhook(signed.payload, signed.signature);
    expect(test.coachingSessionsPaid).toEqual([]);
    expect(paid).not.toHaveBeenCalled();
  });
});
