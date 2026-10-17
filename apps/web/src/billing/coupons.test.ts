import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_STRIPE_PRICES, FAKE_STRIPE_PRODUCTS, fakeCustomerId, signedEvent, subscriptionEvent } from "./fake-stripe";
import { createBilling } from "./index";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

/** Half off Standard and Premium for 3 months, the first subscription only, at most 100 times, until the end of March. */
const SPRING = {
  code: "PRINTEMPS50",
  percentOff: 50,
  duration: "repeating",
  durationInMonths: 3,
  plans: ["standard", "premium"],
  expiresAt: "2027-03-31",
  maxRedemptions: 100,
  firstSubscriptionOnly: true,
};

describe.skipIf(!connectionString)("Coupons (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  beforeEach(async () => {
    t = await startTestBilling();
  });
  afterEach(async () => {
    await t.stop();
  });

  describe("created from the Back Office", () => {
    it("creates a Stripe coupon with the chosen terms, on the eligible Plans' products, and its promotion code", async () => {
      const created = await t.billing.createCoupon(SPRING);

      expect(created).toMatchObject({ ok: true, coupon: { code: "PRINTEMPS50", active: true, timesRedeemed: 0 } });
      const [coupon] = t.stripe.callsTo("/v1/coupons");
      expect(Object.fromEntries(coupon!.params)).toEqual({
        name: "PRINTEMPS50",
        percent_off: "50",
        duration: "repeating",
        duration_in_months: "3",
        "applies_to[products][0]": FAKE_STRIPE_PRODUCTS.standard,
        "applies_to[products][1]": FAKE_STRIPE_PRODUCTS.premium,
      });
      const [promotionCode] = t.stripe.callsTo("/v1/promotion_codes").filter((call) => call.method === "POST");
      expect(Object.fromEntries(promotionCode!.params)).toMatchObject({
        code: "PRINTEMPS50",
        "promotion[type]": "coupon",
        // The end of 31 March in French time.
        expires_at: String(Date.parse("2027-03-31T23:59:59+02:00") / 1000),
        max_redemptions: "100",
        "restrictions[first_time_transaction]": "true",
      });
    });

    it("takes a fixed amount off in euros, once, on one Plan, with no expiry nor limit", async () => {
      const created = await t.billing.createCoupon({ code: "bienvenue-5", amountOff: 500, duration: "once", plans: ["standard"], firstSubscriptionOnly: false });

      expect(created).toMatchObject({
        ok: true,
        coupon: { code: "BIENVENUE-5", discount: { amountOff: 500, currency: "eur" }, duration: "once", plans: ["standard"], expiresAt: null, maxRedemptions: null, firstSubscriptionOnly: false },
      });
      expect(Object.fromEntries(t.stripe.callsTo("/v1/coupons")[0]!.params)).toMatchObject({ amount_off: "500", currency: "eur", duration: "once" });
    });

    it("refuses terms Stripe could not apply, before asking Stripe anything", async () => {
      const refusals: [Record<string, unknown>, string][] = [
        [{ code: "x" }, "invalid_code"],
        [{ code: "PRINTEMPS 50" }, "invalid_code"],
        [{ percentOff: 50, amountOff: 500 }, "invalid_discount"],
        [{ percentOff: null }, "invalid_discount"],
        [{ percentOff: 120 }, "invalid_discount"],
        [{ duration: "repeating", durationInMonths: 0 }, "invalid_duration"],
        [{ duration: "weekly" }, "invalid_duration"],
        [{ plans: [] }, "no_plan"],
        [{ plans: ["free"] }, "plan_not_sold"],
        [{ plans: ["unknown"] }, "plan_not_sold"],
        [{ expiresAt: "2026-10-14" }, "invalid_expiry"],
        [{ expiresAt: "2026-02-30" }, "invalid_expiry"],
        [{ maxRedemptions: 0 }, "invalid_max_redemptions"],
      ];

      for (const [change, error] of refusals) {
        expect(await t.billing.createCoupon({ ...SPRING, ...change }), JSON.stringify(change)).toEqual({ ok: false, error });
      }
      expect(t.stripe.calls).not.toContainEqual(expect.objectContaining({ path: "/v1/coupons" }));
    });

    it("refuses a code already active, and leaves nothing behind in Stripe", async () => {
      await t.billing.createCoupon(SPRING);

      expect(await t.billing.createCoupon({ ...SPRING, code: "printemps50" })).toEqual({ ok: false, error: "code_taken" });
      expect(t.stripe.callsTo("/v1/coupons")).toHaveLength(1);
    });

    it("says Stripe is unavailable without Stripe", async () => {
      const withoutStripe = createBilling({ ...t.config, stripe: undefined });

      expect(await withoutStripe.createCoupon(SPRING)).toEqual({ ok: false, error: "stripe_unavailable" });
    });
  });

  describe("listed and deactivated in the Back Office", () => {
    it("lists every code, newest first, with its terms, its Plans and how often Stripe saw it redeemed", async () => {
      const spring = await t.billing.createCoupon(SPRING);
      await t.billing.createCoupon({ code: "AMI", percentOff: 100, duration: "forever", plans: ["premium"], firstSubscriptionOnly: false });
      if (!spring.ok) throw new Error("fixture refused");
      t.stripe.redeem(spring.coupon.id);
      t.stripe.redeem(spring.coupon.id);

      expect(await t.billing.coupons()).toEqual([
        expect.objectContaining({ code: "AMI", discount: { percentOff: 100 }, duration: "forever", plans: ["premium"], timesRedeemed: 0, active: true }),
        {
          id: spring.coupon.id,
          code: "PRINTEMPS50",
          discount: { percentOff: 50 },
          duration: { months: 3 },
          plans: ["standard", "premium"],
          expiresAt: new Date("2027-03-31T23:59:59+02:00"),
          maxRedemptions: 100,
          firstSubscriptionOnly: true,
          timesRedeemed: 2,
          active: true,
        },
      ]);
    });

    it("shows an expired code as no longer active", async () => {
      await t.billing.createCoupon({ ...SPRING, expiresAt: "2026-10-20" });
      t.clock.now = new Date("2026-10-21T00:00:00+02:00");

      expect(await t.billing.coupons()).toMatchObject([{ code: "PRINTEMPS50", active: false }]);
    });

    it("deactivates a code, and says what it was before and after", async () => {
      const spring = await t.billing.createCoupon(SPRING);
      if (!spring.ok) throw new Error("fixture refused");

      const deactivated = await t.billing.deactivateCoupon(spring.coupon.id);

      expect(deactivated).toMatchObject({ ok: true, before: { code: "PRINTEMPS50", active: true }, after: { code: "PRINTEMPS50", active: false } });
      expect(await t.billing.coupons()).toMatchObject([{ code: "PRINTEMPS50", active: false }]);
      expect(await t.billing.deactivateCoupon("promo_unknown")).toEqual({ ok: false, error: "unknown_coupon" });
    });

    it("has no list while Stripe is not configured", async () => {
      expect(await createBilling({ ...t.config, stripe: undefined }).coupons()).toBeNull();
    });
  });

  describe("at Plan Checkout", () => {
    const checkoutParams = (index = -1) => Object.fromEntries(t.stripe.callsTo("/v1/checkout/sessions").at(index)!.params);

    it("lets the Candidate type a code at Checkout, and asks for a card only when something is due", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      await t.billing.startCheckout(marie, "standard");

      expect(checkoutParams()).toMatchObject({ allow_promotion_codes: "true", payment_method_collection: "if_required" });
      expect(checkoutParams()).not.toHaveProperty("discounts[0][promotion_code]");
    });

    it("applies a shared link's code to an eligible Plan, in place of the code field Stripe forbids alongside it", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const spring = await t.billing.createCoupon(SPRING);
      if (!spring.ok) throw new Error("fixture refused");

      await t.billing.startCheckout(marie, "standard", "fr", { promotionCode: "printemps50" });

      expect(checkoutParams()).toMatchObject({ "discounts[0][promotion_code]": spring.coupon.id, payment_method_collection: "if_required" });
      expect(checkoutParams()).not.toHaveProperty("allow_promotion_codes");
    });

    it("checks out without the discount a code that does not apply: another Plan's, deactivated, expired, unknown", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.createCoupon({ ...SPRING, plans: ["premium"] });
      const old = await t.billing.createCoupon({ ...SPRING, code: "ANCIEN" });
      if (!old.ok) throw new Error("fixture refused");
      await t.billing.deactivateCoupon(old.coupon.id);
      await t.billing.createCoupon({ ...SPRING, code: "OCTOBRE", expiresAt: "2026-10-20" });
      t.clock.now = new Date("2026-10-21T10:00:00+02:00");

      for (const promotionCode of ["PRINTEMPS50", "ANCIEN", "OCTOBRE", "INCONNU"]) {
        expect(await t.billing.startCheckout(marie, "standard", "fr", { promotionCode })).toMatch(/checkout\.stripe\.test/);
        expect(checkoutParams(), promotionCode).toMatchObject({ allow_promotion_codes: "true" });
        expect(checkoutParams(), promotionCode).not.toHaveProperty("discounts[0][promotion_code]");
      }
    });

    it("checks out without the discount when Stripe refuses the code for this Candidate (a first subscription only, say)", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.createCoupon(SPRING);
      t.stripe.refuseDiscounts();

      expect(await t.billing.startCheckout(marie, "standard", "fr", { promotionCode: "PRINTEMPS50" })).toMatch(/checkout\.stripe\.test/);
      expect(checkoutParams()).toMatchObject({ allow_promotion_codes: "true" });
    });

    it("never takes a code for a Coaching Session", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      await t.billing.startCoachingSessionCheckout(marie, "coach-1");

      expect(checkoutParams()).not.toHaveProperty("allow_promotion_codes");
      expect(checkoutParams()).not.toHaveProperty("discounts[0][promotion_code]");
      expect(checkoutParams()).not.toHaveProperty("payment_method_collection");
    });
  });

  describe("a shared link's code on the subscription page", () => {
    it("tells the terms of a code that works, and which Plans it is for", async () => {
      await t.billing.createCoupon(SPRING);

      expect(await t.billing.checkPromotionCode(" printemps50 ")).toMatchObject({ valid: true, coupon: { code: "PRINTEMPS50", discount: { percentOff: 50 }, plans: ["standard", "premium"] } });
    });

    it("tells that a code does not work: unknown, deactivated, expired or used up", async () => {
      const old = await t.billing.createCoupon({ ...SPRING, code: "ANCIEN" });
      if (!old.ok) throw new Error("fixture refused");
      await t.billing.deactivateCoupon(old.coupon.id);
      const once = await t.billing.createCoupon({ ...SPRING, code: "UNEFOIS", maxRedemptions: 1 });
      if (!once.ok) throw new Error("fixture refused");
      t.stripe.redeem(once.coupon.id);
      await t.billing.createCoupon({ ...SPRING, code: "OCTOBRE", expiresAt: "2026-10-20" });
      t.clock.now = new Date("2026-10-21T10:00:00+02:00");

      for (const code of ["INCONNU", "ANCIEN", "UNEFOIS", "OCTOBRE", "pas un code !"]) expect(await t.billing.checkPromotionCode(code), code).toEqual({ valid: false });
    });

    it("cannot tell without Stripe", async () => {
      expect(await createBilling({ ...t.config, stripe: undefined }).checkPromotionCode("PRINTEMPS50")).toBeNull();
    });
  });

  describe("on the Candidate's subscription", () => {
    it("tells the discount their subscription is getting, and until when", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const spring = await t.billing.createCoupon(SPRING);
      if (!spring.ok) throw new Error("fixture refused");
      await t.billing.startCheckout(marie, "standard", "fr", { promotionCode: "PRINTEMPS50" });
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard, status: "active", id: "sub_marie" }));
      t.stripe.discountSubscription("sub_marie", spring.coupon.id, new Date("2027-01-15T10:00:00Z"));

      expect(await t.billing.activeDiscount(marie.id)).toEqual({ discount: { percentOff: 50 }, duration: { months: 3 }, endsAt: new Date("2027-01-15T10:00:00Z") });
    });

    it("has none on Free, without a discount, or while Stripe cannot tell", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const paul = await t.signUp("paul.martin@example.fr");
      await t.billing.startCheckout(paul, "standard");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(paul.email), price: FAKE_STRIPE_PRICES.standard, status: "active", id: "sub_paul" }));

      expect(await t.billing.activeDiscount(marie.id)).toBeNull();
      expect(await t.billing.activeDiscount(paul.id)).toBeNull();
      t.stripe.stopAnswering();
      expect(await t.billing.activeDiscount(paul.id)).toBeNull();
    });

    it("a 100 % code subscribes without a card; when the free period ends unpaid and Stripe ends the subscription, the Candidate is back on Free", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.createCoupon({ ...SPRING, code: "OFFERT", percentOff: 100, duration: "repeating", durationInMonths: 1 });
      const customer = fakeCustomerId(marie.email);

      await t.billing.startCheckout(marie, "premium", "fr", { promotionCode: "OFFERT" });
      expect(checkoutCall()).toMatchObject({ payment_method_collection: "if_required" });
      await deliver(subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.premium, status: "active", id: "sub_marie" }));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");

      await deliver(subscriptionEvent("customer.subscription.deleted", { customer, price: FAKE_STRIPE_PRICES.premium, status: "canceled", id: "sub_marie" }, new Date(Date.now() + 60_000)));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });
  });

  const checkoutCall = () => Object.fromEntries(t.stripe.callsTo("/v1/checkout/sessions").at(-1)!.params);

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }
});
