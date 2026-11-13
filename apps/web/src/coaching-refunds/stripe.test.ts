import { beforeEach, afterEach, it, expect } from "vitest";
import { startFakeStripe, FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET } from "../billing/fake-stripe";
import { stripeConnect } from "../coaching-connect/stripe";
import { coachingRefundStripe } from "./stripe";
import { CoachingRefundContextMismatch, CoachingRefundNotCreated, type RefundPayment } from "./port";
let fake: Awaited<ReturnType<typeof startFakeStripe>>, port: ReturnType<typeof coachingRefundStripe>;
beforeEach(async () => {
  fake = await startFakeStripe();
  port = coachingRefundStripe({ secretKey: FAKE_STRIPE_SECRET_KEY, apiUrl: fake.url });
});
afterEach(async () => {
  await fake.stop();
});
it("retrieves and refunds the original platform payment, with recoverable opaque metadata", async () => {
  const pi = fake.payCheckoutSession("cs_refund_platform", 9000),
    payment: RefundPayment = { checkoutId: "cs_refund_platform", amount: 9000, currency: "eur", accountId: null, paymentIntent: pi };
  expect(await port.inspect(payment)).toEqual({ paymentIntent: pi, refunds: [] });
  const refund = await port.create({ ...payment, paymentIntent: pi, intentId: "private-intent", attempt: 1, refundAmount: 9000 });
  expect(refund).toMatchObject({ intentId: "private-intent", attempt: 1, amount: 9000, status: "succeeded" });
  expect((await port.inspect(payment)).refunds).toEqual([refund]);
  await expect(port.inspect({ ...payment, amount: 8000 })).rejects.toBeInstanceOf(CoachingRefundContextMismatch);
  const write = fake.calls.find((c) => c.method === "POST" && c.path === "/v1/refunds")!;
  expect(write.account).toBeUndefined();
  expect(write.params.get("metadata[jobhub_coaching_refund]")).toBe("private-intent");
});
it("keeps a connected payment on its frozen account and refunds its application fee", async () => {
  const connect = stripeConnect({ secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: fake.url });
  const account = await connect.account({ id: "refund-business", kind: "human_coach", name: "Coach", email: "coach@example.test" }, "refund-business");
  await fetch(`${fake.url}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: account.id }) });
  const checkout = await connect.checkout(
    {
      contextId: "refund-context",
      accountId: account.id,
      amount: 9000,
      currency: "eur",
      commission: 1800,
      title: "Coaching",
      email: "buyer@example.test",
      locale: "fr",
      successUrl: "https://jobbbox.test/ok",
      cancelUrl: "https://jobbbox.test/no",
    },
    "refund-checkout-fixture",
  );
  await fetch(`${fake.url}/__connect/pay`, { method: "POST", body: new URLSearchParams({ session: checkout.id }) });
  const inspected = await port.inspect({ checkoutId: checkout.id, accountId: account.id, amount: 9000, currency: "eur", paymentIntent: null });
  const payment = { checkoutId: checkout.id, accountId: account.id, amount: 9000, currency: "eur", paymentIntent: inspected.paymentIntent };
  const refund = await port.create({ ...payment, intentId: "connected-intent", attempt: 1, refundAmount: 9000 });
  expect((await port.inspect(payment)).refunds).toEqual([refund]);
  const write = fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/refunds").at(-1)!;
  expect(write.account).toBe(account.id);
  expect(write.params.get("refund_application_fee")).toBe("true");
  await expect(port.inspect({ ...payment, accountId: null })).rejects.toThrow();
});
it("distinguishes a conclusive Stripe rejection from an ambiguous transport failure", async () => {
  const pi = fake.payCheckoutSession("cs_refund_refused", 9000);
  fake.refuseRefunds("charge_disputed");
  await expect(
    port.create({
      checkoutId: "cs_refund_refused",
      accountId: null,
      paymentIntent: pi,
      amount: 9000,
      currency: "eur",
      intentId: "refused",
      attempt: 1,
      refundAmount: 9000,
    }),
  ).rejects.toBeInstanceOf(CoachingRefundNotCreated);
});
