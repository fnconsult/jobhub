import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { startFakeStripe, FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET, signedEvent } from "../billing/fake-stripe";
import { stripeConnect } from "./stripe";
import type { CheckoutRequest } from "./port";
let fake: Awaited<ReturnType<typeof startFakeStripe>>, port: ReturnType<typeof stripeConnect>, clock: Date;
beforeEach(async () => {
  fake = await startFakeStripe();
  clock = new Date();
  port = stripeConnect({ secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: fake.url, now: () => clock });
});
afterEach(async () => {
  await fake.stop();
});
async function account() {
  const value = await port.account({ id: "business-fixture", kind: "human_coach", name: "Coach fixture", email: "coach@example.test" }, "account-fixture");
  await fetch(`${fake.url}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: value.id }) });
  return value.id;
}
describe("stable Stripe Connect SDK over HTTP", () => {
  it("creates one Express controller with platform fee/loss liability, hosted KYC, manual payouts and no stored bank data", async () => {
    const first = await port.account({ id: "business-fixture", kind: "human_coach", name: "Coach fixture", email: "coach@example.test" }, "account-fixture");
    expect(first.active).toBe(false);
    expect(
      (await port.account({ id: "business-fixture", kind: "human_coach", name: "Coach fixture", email: "coach@example.test" }, "account-fixture")).id,
    ).toBe(first.id);
    const call = fake.calls.find((c) => c.method === "POST" && c.path === "/v1/accounts")!;
    expect(Object.fromEntries(call.params)).toMatchObject({
      country: "FR",
      "controller[fees][payer]": "application",
      "controller[losses][payments]": "application",
      "controller[requirement_collection]": "stripe",
      "controller[stripe_dashboard][type]": "express",
      "settings[payouts][schedule][interval]": "manual",
    });
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/accounts")).toHaveLength(1);
    await fetch(`${fake.url}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: first.id }) });
    expect(await port.status(first.id)).toMatchObject({ active: true, canReceivePayouts: true });
    expect(await port.onboarding(first.id, "http://localhost/return", "http://localhost/refresh")).toContain("connect.stripe.test");
  });
  it("uses the connected account, a frozen application fee and email rather than a platform Customer", async () => {
    const id = await account(),
      input: CheckoutRequest = {
        contextId: "private-context",
        accountId: id,
        amount: 9000,
        currency: "eur",
        commission: 1800,
        title: "Coaching",
        email: "buyer@example.test",
        locale: "fr",
        successUrl: "http://localhost/coachs",
        cancelUrl: "http://localhost/coachs",
      };
    const session = await port.checkout(input, "checkout-fixture");
    const call = fake.calls.find((c) => c.path === "/v1/checkout/sessions" && c.method === "POST")!;
    expect(call.account).toBe(id);
    expect(call.params.get("customer")).toBeNull();
    expect(call.params.get("customer_email")).toBe(input.email);
    expect(call.params.get("payment_intent_data[application_fee_amount]")).toBe("1800");
    expect(call.params.get("metadata[candidate_id]")).toBeNull();
    await expect(port.readCheckout(session.id, "acct_foreign")).rejects.toThrow();
    expect((await port.checkout(input, "checkout-fixture")).id).toBe(session.id);
    await fetch(`${fake.url}/__connect/pay`, { method: "POST", body: new URLSearchParams({ session: session.id }) });
    expect((await port.readCheckout(session.id, id)).paid).toBe(true);
    expect(await port.payment(session.paymentIntent!, id)).toMatchObject({ amount: 9000, refunded: 0, processingFees: 0, available: true });
  });
  it("recovers transfers, bank payouts and compensation reversals from metadata after the idempotency window", async () => {
    const id = await account(),
      createdAt = new Date(clock),
      input = { batchId: "batch-one", accountId: id, amount: 8000, currency: "eur", createdAt };
    const transfer = await port.transfer(input),
      payout = await port.payout(input);
    clock = new Date(clock.getTime() + 48 * 3600000);
    expect(await port.transfer(input)).toBe(transfer);
    expect(await port.payout(input)).toEqual(payout);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/transfers")).toHaveLength(1);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/payouts")).toHaveLength(1);
    const adjustment = { ...input, batchId: "refund-adjustment", createdAt: new Date(clock), amount: -3000 };
    const reversal = await port.transfer(adjustment);
    clock = new Date(clock.getTime() + 48 * 3600000);
    expect(await port.transfer(adjustment)).toBe(reversal);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/reversals"))).toHaveLength(1);
    await expect(port.payout({ ...input, batchId: "unknown-batch" })).rejects.toThrow("reconciliation");
  });
  it("accepts only a correctly signed Connect webhook", () => {
    const event = { id: "evt_test", object: "event", type: "account.updated", account: "acct_test", data: { object: { id: "acct_test" } } },
      signed = signedEvent(event);
    expect(port.verify(signed.payload, signed.signature).id).toBe("evt_test");
    expect(() => port.verify(signed.payload + " ", signed.signature)).toThrow();
  });
});
