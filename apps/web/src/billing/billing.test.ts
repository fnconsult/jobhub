import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_STRIPE_PRICES, fakeCustomerId, signedEvent, subscriptionEvent } from "./fake-stripe";
import { BillingError, STARTING_PLAN_QUOTAS } from "./index";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

describe.skipIf(!connectionString)("Plans and Plan Quotas (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  beforeEach(async () => {
    t = await startTestBilling();
  });
  afterEach(async () => {
    await t.stop();
  });

  it("puts a new Candidate on the Free Plan with its starting quotas", async () => {
    const marie = await t.signUp("marie.dupont@example.fr");

    const entitlements = await t.billing.entitlements(marie.id);

    expect(entitlements.plan).toBe("free");
    expect(entitlements.quotas).toEqual({
      profiles: 1,
      matchScores: 3,
      atsScores: 1,
      enrichedContacts: 0,
      jobDigest: "none",
    });
  });

  describe("Plan Quotas in the back office", () => {
    it("lists every Plan's quotas, starting with the ones Jobbbox launches with", async () => {
      expect(await t.billing.planQuotas()).toEqual({
        free: { profiles: 1, matchScores: 3, atsScores: 1, enrichedContacts: 0, jobDigest: "none" },
        standard: { profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobDigest: "weekly" },
        premium: { profiles: null, matchScores: null, atsScores: null, enrichedContacts: 20, jobDigest: "daily" },
      });
    });

    it("applies an edited quota at once to the Candidates on that Plan, and keeps it across migrations", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.use(marie.id, "matchScores");

      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 1, jobDigest: "weekly" });
      await t.migrateAgain();

      expect((await t.billing.entitlements(marie.id)).quotas).toMatchObject({ matchScores: 1, jobDigest: "weekly" });
      expect(await t.billing.use(marie.id, "matchScores")).toMatchObject({ allowed: false, limit: 1 });
    });
  });

  describe("monthly quotas, enforced server-side", () => {
    it("lets a Free Candidate compute 3 Match Scores a month, then asks them to upgrade to Standard", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      const allowed = [];
      for (let i = 0; i < 3; i++) allowed.push(await t.billing.use(marie.id, "matchScores"));
      const refused = await t.billing.use(marie.id, "matchScores");

      expect(allowed.map((decision) => decision.allowed)).toEqual([true, true, true]);
      expect(allowed.map((decision) => decision.allowed && decision.remaining)).toEqual([2, 1, 0]);
      expect(refused).toEqual({ allowed: false, quota: "matchScores", plan: "free", limit: 3, upgradeTo: "standard" });
    });

    it("starts counting again on the first day of the month, in French time", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      t.clock.now = new Date("2026-10-31T22:30:00Z"); // 23:30 in Paris, still October
      await t.billing.use(marie.id, "atsScores");
      expect((await t.billing.use(marie.id, "atsScores")).allowed).toBe(false);

      t.clock.now = new Date("2026-10-31T23:30:00Z"); // 00:30 on 1 November in Paris

      expect(await t.billing.use(marie.id, "atsScores")).toEqual({ allowed: true, remaining: 0 });
    });

    it("never refuses a quota the Plan leaves unlimited", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: null });

      for (let i = 0; i < 10; i++) {
        expect(await t.billing.use(marie.id, "matchScores")).toEqual({ allowed: true, remaining: null });
      }
    });

    it("counts each Candidate's use separately, even when requests arrive together", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const jean = await t.signUp("jean.martin@example.fr");

      const decisions = await Promise.all(Array.from({ length: 8 }, () => t.billing.use(marie.id, "matchScores")));

      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
      expect(await t.billing.use(jean.id, "matchScores")).toEqual({ allowed: true, remaining: 2 });
    });

    it("points a Free Candidate wanting Enriched Contacts to Premium, the first Plan that has any", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.use(marie.id, "enrichedContacts")).toEqual({
        allowed: false,
        quota: "enrichedContacts",
        plan: "free",
        limit: 0,
        upgradeTo: "premium",
      });
    });
  });

  describe("Profiles", () => {
    it("lets a Free Candidate hold 1 Profile and asks them to upgrade to Standard for a second", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.allowsAnother(marie.id, "profiles", 0)).toEqual({ allowed: true, remaining: 0 });
      expect(await t.billing.allowsAnother(marie.id, "profiles", 1)).toEqual({
        allowed: false,
        quota: "profiles",
        plan: "free",
        limit: 1,
        upgradeTo: "standard",
      });
    });
  });

  it("tells a Candidate how much of each monthly quota they have used this month", async () => {
    const marie = await t.signUp("marie.dupont@example.fr");
    await t.billing.use(marie.id, "matchScores");
    await t.billing.use(marie.id, "matchScores");
    t.clock.now = new Date("2026-11-02T10:00:00+01:00");
    await t.billing.use(marie.id, "atsScores");

    expect((await t.billing.entitlements(marie.id)).usedThisMonth).toEqual({ matchScores: 0, atsScores: 1, enrichedContacts: 0 });
  });

  describe("Stripe checkout", () => {
    it("sends a Free Candidate to a Stripe Checkout for the Standard subscription, in their language", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      const url = await t.billing.startCheckout(marie, "standard");

      expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      const [customer] = t.stripe.callsTo("/v1/customers");
      expect(customer?.params.get("email")).toBe("marie.dupont@example.fr");
      expect(customer?.params.get("metadata[candidate_id]")).toBe(marie.id);
      const [checkout] = t.stripe.callsTo("/v1/checkout/sessions");
      expect(Object.fromEntries(checkout!.params)).toMatchObject({
        mode: "subscription",
        customer: fakeCustomerId(marie.email),
        client_reference_id: marie.id,
        "line_items[0][price]": FAKE_STRIPE_PRICES.standard,
        "line_items[0][quantity]": "1",
        locale: "fr",
        success_url: "http://localhost:3000/abonnement?checkout=success",
        cancel_url: "http://localhost:3000/abonnement",
      });
    });

    it("reuses the Candidate's Stripe customer on a later checkout", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      await t.billing.startCheckout(marie, "standard");
      await t.billing.startCheckout(marie, "premium", "en");

      expect(t.stripe.callsTo("/v1/customers")).toHaveLength(1);
      const [, second] = t.stripe.callsTo("/v1/checkout/sessions");
      expect(second?.params.get("customer")).toBe(fakeCustomerId(marie.email));
      expect(second?.params.get("line_items[0][price]")).toBe(FAKE_STRIPE_PRICES.premium);
      expect(second?.params.get("locale")).toBe("en");
    });

    it("sends a Candidate who already pays to the customer portal rather than into a second subscription", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      const url = await t.billing.startCheckout(marie, "premium");

      expect(url).toMatch(/^https:\/\/billing\.stripe\.test\//);
      expect(t.stripe.callsTo("/v1/checkout/sessions")).toHaveLength(1);
    });

    it("has no checkout for the Free Plan", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      await expect(t.billing.startCheckout(marie, "free")).rejects.toThrow(BillingError);
    });
  });

  describe("Stripe customer portal", () => {
    it("opens the portal for a Candidate who has subscribed, returning to the subscription page", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");

      const url = await t.billing.openCustomerPortal(marie.id, "fr");

      expect(url).toMatch(/^https:\/\/billing\.stripe\.test\//);
      const [portal] = t.stripe.callsTo("/v1/billing_portal/sessions");
      expect(Object.fromEntries(portal!.params)).toMatchObject({
        customer: fakeCustomerId(marie.email),
        return_url: "http://localhost:3000/abonnement",
        locale: "fr",
      });
    });

    it("has nothing to open for a Candidate who never subscribed", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.openCustomerPortal(marie.id, "fr")).toBeNull();
    });
  });

  describe("Stripe webhooks", () => {
    async function subscribed(email: string, plan: "standard" | "premium" = "standard") {
      const candidate = await t.signUp(email);
      await t.billing.startCheckout(candidate, plan);
      return { ...candidate, customer: fakeCustomerId(email) };
    }

    it("moves a Candidate onto the Plan they subscribed to", async () => {
      const marie = await subscribed("marie.dupont@example.fr");

      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      const entitlements = await t.billing.entitlements(marie.id);
      expect(entitlements.plan).toBe("standard");
      expect(entitlements.quotas).toEqual({ profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobDigest: "weekly" });
    });

    it("follows a change of Plan made in the customer portal", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }));

      const entitlements = await t.billing.entitlements(marie.id);
      expect(entitlements.plan).toBe("premium");
      expect(entitlements.quotas).toEqual({ profiles: null, matchScores: null, atsScores: null, enrichedContacts: 20, jobDigest: "daily" });
    });

    it("keeps the Plan while Stripe retries a failed payment, and drops to Free once the subscription ends", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "past_due" }));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("standard");

      await deliver(subscriptionEvent("customer.subscription.deleted", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "canceled" }));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("does not grant a Plan for a checkout whose first payment never went through", async () => {
      const marie = await subscribed("marie.dupont@example.fr");

      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "incomplete" }));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("ignores an event older than the last one applied, as Stripe may deliver them out of order", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      const subscription = { customer: marie.customer, status: "active" };
      const premiumAt = new Date("2026-10-15T10:05:00Z");
      await deliver(subscriptionEvent("customer.subscription.updated", { ...subscription, price: FAKE_STRIPE_PRICES.premium }, premiumAt));

      await deliver(subscriptionEvent("customer.subscription.created", { ...subscription, price: FAKE_STRIPE_PRICES.standard }, new Date("2026-10-15T10:00:00Z")));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");
    });

    it.each([
      ["created (incomplete) after updated (active)", ["updated", "active"], ["created", "incomplete"], "premium"],
      ["updated (active) after created (incomplete)", ["created", "incomplete"], ["updated", "active"], "premium"],
      ["updated (active) after deleted (canceled)", ["deleted", "canceled"], ["updated", "active"], "free"],
    ] as const)(
      "keeps the later state of a subscription when two of its events share the same second: %s",
      async (_, [firstType, firstStatus], [secondType, secondStatus], plan) => {
        const marie = await subscribed("marie.dupont@example.fr");
        const subscription = { id: "sub_A", customer: marie.customer, price: FAKE_STRIPE_PRICES.premium };
        const sameSecond = new Date("2026-10-06T19:40:00Z");

        await deliver(subscriptionEvent(`customer.subscription.${firstType}`, { ...subscription, status: firstStatus }, sameSecond));
        await deliver(subscriptionEvent(`customer.subscription.${secondType}`, { ...subscription, status: secondStatus }, sameSecond));

        expect((await t.billing.entitlements(marie.id)).plan).toBe(plan);
      },
    );

    it("does not end the current subscription when an older one of the same Candidate ends", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      const old = { id: "sub_old", customer: marie.customer, price: FAKE_STRIPE_PRICES.standard };
      await deliver(subscriptionEvent("customer.subscription.created", { ...old, status: "active" }));
      await deliver(subscriptionEvent("customer.subscription.created", { id: "sub_new", customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }));

      await deliver(subscriptionEvent("customer.subscription.deleted", { ...old, status: "canceled" }));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");
    });

    it("refuses a delivery whose signature is not Stripe's, and changes nothing", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      const forged = signedEvent(
        subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }),
        "whsec_someone_else",
      );

      await expect(t.billing.handleStripeWebhook(forged.payload, forged.signature)).rejects.toThrow(BillingError);
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("accepts and ignores events about customers or prices it does not know", async () => {
      const marie = await subscribed("marie.dupont@example.fr");

      await deliver(subscriptionEvent("customer.subscription.created", { customer: "cus_unknown", price: FAKE_STRIPE_PRICES.premium, status: "active" }));
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: "price_unknown", status: "active" }));
      await deliver({ id: "evt_other", object: "event", type: "invoice.paid", created: 1, data: { object: { id: "in_1", object: "invoice" } } });

      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("lets a Premium Candidate who used their 20 Enriched Contacts know no Plan offers more", async () => {
      const marie = await subscribed("marie.dupont@example.fr", "premium");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }));

      for (let i = 0; i < 20; i++) await t.billing.use(marie.id, "enrichedContacts");

      expect(await t.billing.use(marie.id, "enrichedContacts")).toEqual({
        allowed: false,
        quota: "enrichedContacts",
        plan: "premium",
        limit: 20,
        upgradeTo: null,
      });
    });
  });

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }
});
