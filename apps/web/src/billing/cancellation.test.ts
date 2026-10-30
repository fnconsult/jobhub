import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailMessage } from "../auth/index";
import { FAKE_STRIPE_PRICES, fakeCustomerId, signedEvent, subscriptionEvent } from "./fake-stripe";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

/**
 * « Résilier votre contrat » (#513, C. conso. L215-1-1, D215-2): the Candidate cancels from Jobbbox's own page, the
 * cancellation is scheduled in Stripe at the end of the paid period, and an acknowledgement is emailed, once.
 */
describe.skipIf(!connectionString)("Cancelling a paid Plan from Jobbbox (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let mails: MailMessage[];
  const periodEnd = new Date("2026-11-15T09:00:00Z");

  beforeEach(async () => {
    mails = [];
    t = await startTestBilling({ mailer: { send: async (message) => void mails.push(message) } });
  });
  afterEach(async () => {
    await t.stop();
  });

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }

  /** A Candidate on Premium, whose paid period ends at `periodEnd`. */
  async function premiumSubscriber(email = "marie.dupont@example.fr") {
    const candidate = await t.signUp(email);
    await t.billing.startCheckout(candidate, "premium");
    const customer = fakeCustomerId(email);
    const subscription = { customer, price: FAKE_STRIPE_PRICES.premium, status: "active", currentPeriodEnd: periodEnd };
    await deliver(subscriptionEvent("customer.subscription.created", subscription, new Date("2026-10-15T07:00:00Z")));
    t.stripe.setSubscriptionPeriodEnd(`sub_fake_${customer}`, periodEnd);
    return { ...candidate, customer, subscription };
  }

  describe("what the confirmation page shows", () => {
    it("gives the Plan and the end of the paid period, as Stripe has it", async () => {
      const marie = await premiumSubscriber();

      expect(await t.billing.cancellationTerms(marie.id)).toEqual({ plan: "premium", planName: { fr: "Premium", en: "Premium" }, endsAt: periodEnd });
    });

    it("has nothing to cancel on Free", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.cancellationTerms(marie.id)).toBeNull();
    });

    it("has nothing to cancel once a cancellation is scheduled, in the customer portal or here", async () => {
      const marie = await premiumSubscriber();
      await deliver(subscriptionEvent("customer.subscription.updated", { ...marie.subscription, cancelAtPeriodEnd: true }, new Date("2026-10-15T08:00:00Z")));

      expect(await t.billing.cancellationTerms(marie.id)).toBeNull();
    });
  });

  describe("confirming the cancellation", () => {
    it("schedules it in Stripe at the end of the paid period: the Plan is kept until then, with its end date", async () => {
      const marie = await premiumSubscriber();

      const result = await t.billing.scheduleCancellation(marie, "fr");

      expect(result).toEqual({ ok: true, plan: "premium", requestedAt: t.clock.now, endsAt: periodEnd, acknowledged: true });
      const updates = t.stripe.callsTo(`/v1/subscriptions/sub_fake_${marie.customer}`).filter((call) => call.method === "POST");
      expect(updates.map((call) => Object.fromEntries(call.params))).toEqual([{ cancel_at_period_end: "true" }]);
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: periodEnd });
      expect(await t.billing.cancellationTerms(marie.id)).toBeNull();
    });

    it("emails an acknowledgement with the date of the request and the end of the contract", async () => {
      const marie = await premiumSubscriber();

      await t.billing.scheduleCancellation(marie, "fr");

      expect(mails).toHaveLength(1);
      const [mail] = mails;
      expect(mail!.to).toBe("marie.dupont@example.fr");
      expect(mail!.subject).toBe("Accusé de réception de votre résiliation");
      for (const part of [mail!.text, mail!.html!.replaceAll("&#39;", "'")]) {
        expect(part).toContain("15 octobre 2026 à 10:00");
        expect(part).toContain("Fin du contrat : 15 novembre 2026");
        expect(part).toContain("Vous gardez l'offre Premium jusqu'au 15 novembre 2026");
        expect(part).toContain("http://localhost:3000/abonnement");
      }
    });

    it("writes the acknowledgement in English to a Candidate who chose English", async () => {
      const marie = await premiumSubscriber();

      await t.billing.scheduleCancellation(marie, "en");

      expect(mails[0]!.subject).toBe("Acknowledgement of your cancellation");
      expect(mails[0]!.text).toContain("October 15, 2026");
      expect(mails[0]!.text).toContain("End of the contract: November 15, 2026");
    });

    it("acknowledges a cancellation once, even confirmed twice at the same time", async () => {
      const marie = await premiumSubscriber();

      const results = await Promise.all([t.billing.scheduleCancellation(marie, "fr"), t.billing.scheduleCancellation(marie, "fr")]);
      const again = await t.billing.scheduleCancellation(marie, "fr");

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(again).toEqual({ ok: false, error: "not_cancellable" });
      expect(mails).toHaveLength(1);
      expect(t.stripe.callsTo(`/v1/subscriptions/sub_fake_${marie.customer}`).filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it("has nothing to cancel on Free", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.scheduleCancellation(marie, "fr")).toEqual({ ok: false, error: "not_cancellable" });
      expect(mails).toEqual([]);
    });

    it("keeps the cancellation when the acknowledgement could not be sent, and says so", async () => {
      await t.stop();
      t = await startTestBilling({ mailer: { send: async () => Promise.reject(new Error("Brevo is down")) } });
      const marie = await premiumSubscriber();

      expect(await t.billing.scheduleCancellation(marie, "fr")).toMatchObject({ ok: true, acknowledged: false });
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: periodEnd });
    });

    it("leaves the Candidate on their Plan until the end date, then on Free once Stripe ends the subscription", async () => {
      const marie = await premiumSubscriber();
      await t.billing.scheduleCancellation(marie, "fr");
      // Stripe's own report of the change, then the end of the period.
      await deliver(subscriptionEvent("customer.subscription.updated", { ...marie.subscription, cancelAtPeriodEnd: true }, new Date("2026-10-15T08:00:01Z")));
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: periodEnd });

      await deliver(subscriptionEvent("customer.subscription.deleted", { ...marie.subscription, status: "canceled", cancelAtPeriodEnd: true }, new Date("2026-11-15T09:00:01Z")));

      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "free", endsAt: null });
      expect(mails).toHaveLength(1);
    });
  });
});
