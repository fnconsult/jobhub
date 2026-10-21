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
  firstPaymentOnly: true,
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
      const created = await t.billing.createCoupon({ code: "bienvenue-5", amountOff: 500, duration: "once", plans: ["standard"], firstPaymentOnly: false });

      expect(created).toMatchObject({
        ok: true,
        coupon: { code: "BIENVENUE-5", discount: { amountOff: 500, currency: "eur" }, duration: "once", plans: ["standard"], expiresAt: null, maxRedemptions: null, firstPaymentOnly: false },
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

    it("refuses a fixed amount that would make a Plan free for good, but not for a while", async () => {
      // Standard costs 19 € a month.
      const forever = { code: "GRATUIT", amountOff: 1900, duration: "forever", plans: ["standard", "premium"], firstPaymentOnly: false };

      expect(await t.billing.createCoupon(forever)).toEqual({ ok: false, error: "amount_covers_price" });
      expect(await t.billing.createCoupon({ ...forever, amountOff: 1899 })).toMatchObject({ ok: true });
      expect(await t.billing.createCoupon({ ...forever, code: "TROISMOIS", duration: "repeating", durationInMonths: 3 })).toMatchObject({ ok: true });
    });

    it("refuses a fixed amount in euros on a Plan Stripe prices in another currency", async () => {
      t.stripe.setDefaultPrice(FAKE_STRIPE_PRODUCTS.premium, "price_premium_usd");

      expect(await t.billing.createCoupon({ code: "CINQ", amountOff: 500, duration: "once", plans: ["premium"], firstPaymentOnly: false })).toEqual({ ok: false, error: "currency_not_eur" });
      expect(await t.billing.createCoupon({ code: "MOITIE", percentOff: 50, duration: "once", plans: ["premium"], firstPaymentOnly: false })).toMatchObject({ ok: true });
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
      await t.billing.createCoupon({ code: "AMI", percentOff: 100, duration: "forever", plans: ["premium"], firstPaymentOnly: false });
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
          firstPaymentOnly: true,
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

      expect(deactivated).toMatchObject({ ok: true, changed: true, before: { code: "PRINTEMPS50", active: true }, after: { code: "PRINTEMPS50", active: false } });
      // Already inactive: nothing changes, and Stripe is not written to.
      const writes = t.stripe.callsTo(`/v1/promotion_codes/${spring.coupon.id}`).filter((call) => call.method === "POST").length;
      expect(await t.billing.deactivateCoupon(spring.coupon.id)).toMatchObject({ ok: true, changed: false });
      expect(t.stripe.callsTo(`/v1/promotion_codes/${spring.coupon.id}`).filter((call) => call.method === "POST")).toHaveLength(writes);
      expect(await t.billing.coupons()).toMatchObject([{ code: "PRINTEMPS50", active: false }]);
      expect(await t.billing.deactivateCoupon("promo_unknown")).toEqual({
        ok: false,
        error: "unknown_coupon",
        failure: { reason: "stripe_refused", technical: { class: "StripeInvalidRequestError", provider: "stripe", status: 404, message: "resource_missing: No such promotion code: 'promo_unknown'" } },
      });
    });

    it("reactivates a code whose deactivation could not be recorded", async () => {
      const spring = await t.billing.createCoupon(SPRING);
      if (!spring.ok) throw new Error("fixture refused");
      await t.billing.deactivateCoupon(spring.coupon.id);

      expect(await t.billing.reactivateCoupon(spring.coupon.id)).toEqual({ ok: true });
      expect(await t.billing.coupons()).toMatchObject([{ code: "PRINTEMPS50", active: true }]);
    });

    it("lists every code, page after page, and shows one Stripe cannot make sense of as unreadable rather than none", async () => {
      for (let i = 0; i < 105; i++) t.stripe.addPromotionCode(`LOT${i}`);
      t.stripe.addMalformedPromotionCode("CASSE");

      const listed = await t.billing.coupons();

      expect(listed).toHaveLength(106);
      expect(listed![0]).toEqual({ id: expect.stringMatching(/^promo_/), code: "CASSE", unreadable: true });
      expect(listed!.filter((coupon) => "unreadable" in coupon)).toHaveLength(1);
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

    it("refuses, rather than drops, a code that does not apply: another Plan's, deactivated, expired, unknown", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.createCoupon({ ...SPRING, plans: ["premium"] });
      const old = await t.billing.createCoupon({ ...SPRING, code: "ANCIEN" });
      if (!old.ok) throw new Error("fixture refused");
      await t.billing.deactivateCoupon(old.coupon.id);
      await t.billing.createCoupon({ ...SPRING, code: "OCTOBRE", expiresAt: "2026-10-20" });
      t.clock.now = new Date("2026-10-21T10:00:00+02:00");

      const refusals = { PRINTEMPS50: "not_for_plan", ANCIEN: "unavailable", OCTOBRE: "unavailable", INCONNU: "unavailable" };
      for (const [promotionCode, reason] of Object.entries(refusals)) {
        await expect(t.billing.startCheckout(marie, "standard", "fr", { promotionCode }), promotionCode).rejects.toMatchObject({ name: "PromotionCodeRefused", reason });
      }
      // Nothing sent to Checkout: the Candidate decides, back on the subscription page, whether to go on without it.
      expect(t.stripe.callsTo("/v1/checkout/sessions")).toHaveLength(0);
    });

    it("refuses a code Stripe will not apply for this Candidate: one who has paid before, for a first-payment-only code", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.createCoupon(SPRING);
      // A Coaching Session paid earlier counts: Stripe's rule is the customer's first payment, not their first subscription.
      t.stripe.markPaid(fakeCustomerId(marie.email));

      await expect(t.billing.startCheckout(marie, "standard", "fr", { promotionCode: "PRINTEMPS50" })).rejects.toMatchObject({ name: "PromotionCodeRefused", reason: "not_for_you" });
      expect(t.stripe.callsTo("/v1/checkout/sessions").filter((call) => call.params.get("mode") === "subscription")).toHaveLength(1);
    });

    it("refuses a code that could not be checked, rather than checking out at full price", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard"); // the customer exists
      t.stripe.stopAnswering();

      await expect(t.billing.startCheckout(marie, "standard", "fr", { promotionCode: "PRINTEMPS50" })).rejects.toMatchObject({ name: "PromotionCodeRefused", reason: "unchecked" });
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

      expect(await t.billing.checkPromotionCode(" printemps50 ", "marie")).toMatchObject({ status: "valid", coupon: { code: "PRINTEMPS50", discount: { percentOff: 50 }, plans: ["standard", "premium"] } });
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

      for (const code of ["INCONNU", "ANCIEN", "UNEFOIS", "OCTOBRE", "pas un code !"]) expect(await t.billing.checkPromotionCode(code, "marie"), code).toEqual({ status: "invalid" });
    });

    it("cannot tell without Stripe", async () => {
      expect(await createBilling({ ...t.config, stripe: undefined }).checkPromotionCode("PRINTEMPS50", "marie")).toBeNull();
    });

    it("asks Stripe once a minute per code, and stops one Candidate trying code after code", async () => {
      await t.billing.createCoupon(SPRING);
      const lookups = () => t.stripe.callsTo("/v1/promotion_codes").filter((call) => call.method === "GET").length;
      const before = lookups();

      for (let i = 0; i < 3; i++) await t.billing.checkPromotionCode("PRINTEMPS50", "marie");
      expect(lookups()).toBe(before + 1);

      for (let i = 0; i < 10; i++) await t.billing.checkPromotionCode(`ESSAI${i}`, "paul");
      expect(await t.billing.checkPromotionCode("ESSAI10", "paul")).toEqual({ status: "throttled" });
      // Another Candidate is not held back; a cached answer costs no try.
      expect(await t.billing.checkPromotionCode("PRINTEMPS50", "lea")).toMatchObject({ status: "valid" });
      t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
      expect(await t.billing.checkPromotionCode("ESSAI10", "paul")).toEqual({ status: "invalid" });
    });

    it("forgets a cached answer when the Back Office deactivates the code", async () => {
      const spring = await t.billing.createCoupon(SPRING);
      if (!spring.ok) throw new Error("fixture refused");
      expect(await t.billing.checkPromotionCode("PRINTEMPS50", "marie")).toMatchObject({ status: "valid" });

      await t.billing.deactivateCoupon(spring.coupon.id);

      expect(await t.billing.checkPromotionCode("PRINTEMPS50", "marie")).toEqual({ status: "invalid" });
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

    it("a 100 % code subscribes without a card; when the free period ends and the subscription goes past due with no card, the Candidate is on Free at once", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.createCoupon({ ...SPRING, code: "OFFERT", percentOff: 100, duration: "repeating", durationInMonths: 1 });
      const customer = fakeCustomerId(marie.email);

      await t.billing.startCheckout(marie, "premium", "fr", { promotionCode: "OFFERT" });
      expect(checkoutCall()).toMatchObject({ payment_method_collection: "if_required" });
      const subscription = { customer, price: FAKE_STRIPE_PRICES.premium, id: "sub_marie", defaultPaymentMethod: null };
      await deliver(subscriptionEvent("customer.subscription.created", { ...subscription, status: "active" }));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");

      // Not kept through Stripe's retries: there is no card to retry.
      await deliver(subscriptionEvent("customer.subscription.updated", { ...subscription, status: "past_due" }, new Date(Date.now() + 60_000)));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
      // Nor is the Payment Failed Notice shown, which says the Plan is kept.
      expect((await t.billing.entitlements(marie.id)).stripeStatus).not.toBe("past_due");

      // Should they add a card in the portal and pay, the Plan follows again.
      await deliver(subscriptionEvent("customer.subscription.updated", { ...subscription, defaultPaymentMethod: "pm_card", status: "active" }, new Date(Date.now() + 120_000)));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");
    });

    it("keeps the Plan of a past-due subscription that has a card, while Stripe retries it", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const customer = fakeCustomerId(marie.email);
      await t.billing.startCheckout(marie, "premium");

      await deliver(subscriptionEvent("customer.subscription.updated", { customer, price: FAKE_STRIPE_PRICES.premium, status: "past_due" }));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");
    });
  });

  const checkoutCall = () => Object.fromEntries(t.stripe.callsTo("/v1/checkout/sessions").at(-1)!.params);

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }
});
