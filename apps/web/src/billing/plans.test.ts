import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_STRIPE_COACHING_SESSION_PRICES, FAKE_STRIPE_PRICES, FAKE_STRIPE_PRODUCTS, fakeCustomerId, signedEvent, subscriptionEvent } from "./fake-stripe";
import { BillingError, createBilling, STARTING_PLAN_QUOTAS } from "./index";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

const ESSENTIAL = { key: "essentiel", name: { fr: "Essentiel", en: "Essential" }, stripeProductId: FAKE_STRIPE_PRODUCTS.essential, features: [] };

describe.skipIf(!connectionString)("Plans defined by Administrators (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  beforeEach(async () => {
    t = await startTestBilling();
  });
  afterEach(async () => {
    await t.stop();
  });

  describe("the Plans Jobbbox starts with", () => {
    it("are Free, Standard and Premium, offered in that order, the paid ones tied to the products of their env prices, the discount on Premium", async () => {
      expect(await t.billing.plans()).toEqual([
        { key: "free", name: { fr: "Gratuite", en: "Free" }, rank: 1, status: "offered", stripeProductId: null, features: [] },
        { key: "standard", name: { fr: "Standard", en: "Standard" }, rank: 2, status: "offered", stripeProductId: FAKE_STRIPE_PRODUCTS.standard, features: [] },
        {
          key: "premium",
          name: { fr: "Premium", en: "Premium" },
          rank: 3,
          status: "offered",
          stripeProductId: FAKE_STRIPE_PRODUCTS.premium,
          features: ["coachingSessionDiscount"],
        },
      ]);
    });

    it("keep every Candidate's Plan and quotas on a database from before Plans lived in the database", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard, status: "active" }));
      await t.billing.setPlanQuotas("standard", { ...STARTING_PLAN_QUOTAS.standard, profiles: 5 });
      await t.database.query(`
        ALTER TABLE plan_quota DROP CONSTRAINT plan_quota_plan_fkey;
        DROP TABLE plan;
        ALTER TABLE plan_quota ADD CONSTRAINT plan_quota_plan_check CHECK (plan IN ('free', 'standard', 'premium'));
      `);

      await t.migrateAgain();
      const deployed = createBilling(t.config);
      await deployed.linkPlansToEnvPrices();

      expect(await deployed.entitlements(marie.id)).toMatchObject({ plan: "standard", stripeStatus: "active", quotas: { profiles: 5 } });
      expect((await deployed.plans()).map((plan) => [plan.key, plan.rank, plan.status, plan.stripeProductId])).toEqual([
        ["free", 1, "offered", null],
        ["standard", 2, "offered", FAKE_STRIPE_PRODUCTS.standard],
        ["premium", 3, "offered", FAKE_STRIPE_PRODUCTS.premium],
      ]);
    });

    it("keep the product an Administrator gave them over the env price's, across deployments", async () => {
      await t.database.query("UPDATE plan SET stripe_product_id = NULL, status = 'hidden' WHERE key = 'standard'");
      expect(await t.billing.updatePlan("standard", { name: { fr: "Standard", en: "Standard" }, status: "offered", stripeProductId: FAKE_STRIPE_PRODUCTS.essential, features: [] })).toMatchObject({ ok: true });

      await t.migrateAgain();
      const deployed = createBilling(t.config);
      await deployed.linkPlansToEnvPrices();

      expect((await deployed.plans()).find((plan) => plan.key === "standard")?.stripeProductId).toBe(FAKE_STRIPE_PRODUCTS.essential);
    });

    it("are not tied to a product two env prices share: each price follows its own Plan, and the team is told", async () => {
      await t.database.query("UPDATE plan SET stripe_product_id = NULL WHERE key IN ('standard', 'premium')");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const shared = createBilling({ ...t.config, stripe: { ...t.config.stripe!, envPlanPrices: { standard: FAKE_STRIPE_PRICES.bundleStandard, premium: FAKE_STRIPE_PRICES.bundlePremium } } });
      const marie = await t.signUp("marie.dupont@example.fr");
      const jean = await t.signUp("jean.martin@example.fr");
      await t.database.query("INSERT INTO candidate_plan (candidate_id, plan, stripe_customer_id) VALUES ($1, 'free', $2), ($3, 'free', $4)", [
        marie.id,
        fakeCustomerId(marie.email),
        jean.id,
        fakeCustomerId(jean.email),
      ]);

      await shared.linkPlansToEnvPrices();
      for (const [candidate, price] of [[marie, FAKE_STRIPE_PRICES.bundlePremium], [jean, FAKE_STRIPE_PRICES.bundleStandard]] as const) {
        const { payload, signature } = signedEvent(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(candidate.email), price, status: "active" }));
        await shared.handleStripeWebhook(payload, signature);
      }

      expect((await shared.plans()).map((plan) => plan.stripeProductId)).toEqual([null, null, null]);
      expect((await shared.entitlements(marie.id)).plan).toBe("premium");
      expect((await shared.entitlements(jean.id)).plan).toBe("standard");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/STRIPE_PRICE_STANDARD and STRIPE_PRICE_PREMIUM.*same Stripe product/));
      warn.mockRestore();
    });

    it("are not tied to a product another Plan already has, and the team is told", async () => {
      await t.database.query("UPDATE plan SET stripe_product_id = NULL WHERE key = 'standard'");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const taken = createBilling({ ...t.config, stripe: { ...t.config.stripe!, envPlanPrices: { standard: FAKE_STRIPE_PRICES.premium } } });

      await taken.linkPlansToEnvPrices();

      expect((await taken.plans()).find((plan) => plan.key === "standard")?.stripeProductId).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/STRIPE_PRICE_STANDARD.*already the Premium Plan's/));
      warn.mockRestore();
    });

    it("start a quota added in a later release at the value of the Plan ranked just below, for Plans Administrators created", async () => {
      await t.billing.createPlan(ESSENTIAL);
      await t.billing.movePlan("essentiel", "down");
      await t.billing.setPlanQuotas("standard", { ...STARTING_PLAN_QUOTAS.standard, jobSearches: 12 });
      await t.database.query("ALTER TABLE plan_quota DROP COLUMN job_searches");

      await t.migrateAgain();

      // Standard is back at its starting value; Essentiel, just above it, takes Standard's: never NULL (unlimited) by accident.
      expect(await t.billing.planQuotas()).toMatchObject({ standard: { jobSearches: 7 }, essentiel: { jobSearches: 7 }, premium: { jobSearches: null } });
    });

    it("keep selling and following the Plans with a product when an env price cannot give its own", async () => {
      await t.database.query("UPDATE plan SET stripe_product_id = NULL WHERE key = 'premium'");
      const misconfigured = createBilling({ ...t.config, stripe: { ...t.config.stripe!, envPlanPrices: { premium: "price_unknown" } } });
      const marie = await t.signUp("marie.dupont@example.fr");
      await misconfigured.startCheckout(marie, "standard");

      const { payload, signature } = signedEvent(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard, status: "active" }));
      await misconfigured.handleStripeWebhook(payload, signature);

      expect((await misconfigured.entitlements(marie.id)).plan).toBe("standard");
      expect(Object.keys((await misconfigured.planPrices())!)).toEqual(["free", "standard"]);
      await expect(misconfigured.linkPlansToEnvPrices()).rejects.toThrow();
    });
  });

  describe("creating a Plan in the Back Office", () => {
    it("starts it hidden, ranked above the others, with the Plan Quotas of the Plan ranked just below", async () => {
      await t.billing.setPlanQuotas("premium", { ...STARTING_PLAN_QUOTAS.premium, enrichedContacts: 40 });

      const created = await t.billing.createPlan(ESSENTIAL);

      expect(created).toEqual({ ok: true, plan: { ...ESSENTIAL, rank: 4, status: "hidden" }, quotas: { ...STARTING_PLAN_QUOTAS.premium, enrichedContacts: 40 } });
      expect((await t.billing.plans()).map((plan) => plan.key)).toEqual(["free", "standard", "premium", "essentiel"]);
      expect((await t.billing.planQuotas()).essentiel).toEqual({ ...STARTING_PLAN_QUOTAS.premium, enrichedContacts: 40 });
    });

    it.each([
      ["a key that is not a slug", { key: "Essentiel Plus" }, "invalid_key"],
      ["a key already taken", { key: "premium" }, "key_taken"],
      ["an empty name", { name: { fr: " ", en: "Essential" } }, "invalid_name"],
      ["a price ID instead of a product ID", { stripeProductId: FAKE_STRIPE_PRICES.essential }, "not_a_product_id"],
      ["another Plan's product", { stripeProductId: FAKE_STRIPE_PRODUCTS.premium }, "product_taken"],
      ["a product Stripe does not have", { stripeProductId: "prod_unknown" }, "product_not_found"],
      ["an archived product", { stripeProductId: FAKE_STRIPE_PRODUCTS.archived }, "product_archived"],
      ["a product without a default price", { stripeProductId: FAKE_STRIPE_PRODUCTS.noPrice }, "no_recurring_default_price"],
      ["a product whose default price is one-off", { stripeProductId: FAKE_STRIPE_PRODUCTS.oneOff }, "no_recurring_default_price"],
      ["a product charged every 3 months", { stripeProductId: FAKE_STRIPE_PRODUCTS.quarterly }, "no_recurring_default_price"],
      ["a Plan Feature the code does not know", { features: ["freeLunch"] }, "invalid_feature"],
    ])("refuses %s, and creates nothing", async (_, change, error) => {
      expect(await t.billing.createPlan({ ...ESSENTIAL, ...change })).toEqual({ ok: false, error });
      expect(await t.billing.plans()).toHaveLength(3);
    });

    it("gives up on a Stripe that does not answer within a few seconds", async () => {
      t.stripe.stopAnswering();
      const started = Date.now();

      expect(await t.billing.createPlan(ESSENTIAL)).toEqual({ ok: false, error: "stripe_unavailable" });
      expect(Date.now() - started).toBeLessThan(5_000);
    }, 30_000);

    it("cannot check the product while Stripe is not configured", async () => {
      const withoutStripe = createBilling({ ...t.config, stripe: undefined });

      expect(await withoutStripe.createPlan(ESSENTIAL)).toEqual({ ok: false, error: "stripe_unavailable" });
    });
  });

  describe("an offered Plan", () => {
    it("is on the plan comparison in rank order, and its checkout is at its product's default price", async () => {
      await t.billing.createPlan(ESSENTIAL);
      await offer("essentiel");
      await t.billing.movePlan("essentiel", "down");
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(Object.keys((await t.billing.planPrices())!)).toEqual(["free", "standard", "essentiel", "premium"]);
      expect((await t.billing.planPrices())!.essentiel).toEqual({ amount: 2900, currency: "eur", interval: "month" });
      await t.billing.startCheckout(marie, "essentiel");
      expect(t.stripe.callsTo("/v1/checkout/sessions").at(-1)?.params.get("line_items[0][price]")).toBe(FAKE_STRIPE_PRICES.essential);
    });

    it("is checked out at the price Jobbbox makes its product's default in Stripe", async () => {
      t.stripe.setDefaultPrice(FAKE_STRIPE_PRODUCTS.standard, "price_standard_yearly");
      const marie = await t.signUp("marie.dupont@example.fr");

      await createBilling(t.config).startCheckout(marie, "standard");

      expect(t.stripe.callsTo("/v1/checkout/sessions").at(-1)?.params.get("line_items[0][price]")).toBe("price_standard_yearly");
    });

    it("is applied by a webhook on any price of its product; other products are ignored", async () => {
      await t.billing.createPlan(ESSENTIAL);
      const marie = await t.signUp("marie.dupont@example.fr");
      const jean = await t.signUp("jean.martin@example.fr");
      await t.billing.startCheckout(marie, "standard");
      await t.billing.startCheckout(jean, "standard");

      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(marie.email), price: "price_essential_yearly", product: FAKE_STRIPE_PRODUCTS.essential, status: "active" }));
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(jean.email), price: "price_other", product: "prod_other", status: "active" }));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("essentiel");
      expect((await t.billing.entitlements(jean.id)).plan).toBe("free");
    });
  });

  describe("a paid Plan's Stripe product", () => {
    it("is frozen once set: its subscribers stay on that product, so changing it is refused and the form may leave it out", async () => {
      const standard = { name: { fr: "Standard", en: "Standard" }, status: "offered", features: [] };

      expect(await t.billing.updatePlan("standard", { ...standard, stripeProductId: FAKE_STRIPE_PRODUCTS.essential })).toEqual({ ok: false, error: "product_frozen" });
      expect(await t.billing.updatePlan("standard", { ...standard, stripeProductId: null, name: { fr: "Standard+", en: "Standard+" } })).toMatchObject({
        ok: true,
        after: { stripeProductId: FAKE_STRIPE_PRODUCTS.standard, name: { fr: "Standard+" } },
      });
      expect(await t.billing.updatePlan("standard", { ...standard, stripeProductId: FAKE_STRIPE_PRODUCTS.standard })).toMatchObject({ ok: true });
    });
  });

  describe("hiding a Plan", () => {
    it("takes it off the comparison, checkout and Upgrade Prompts, and keeps its subscribers on it as Stripe reports them", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const jean = await t.signUp("jean.martin@example.fr");
      await t.billing.startCheckout(marie, "premium");
      const premium = { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.premium };
      await deliver(subscriptionEvent("customer.subscription.created", { ...premium, status: "active" }, new Date("2026-10-15T10:00:00Z")));

      await t.billing.updatePlan("premium", { name: { fr: "Premium", en: "Premium" }, status: "hidden", stripeProductId: FAKE_STRIPE_PRODUCTS.premium, features: ["coachingSessionDiscount"] });

      expect(Object.keys((await t.billing.planPrices())!)).toEqual(["free", "standard"]);
      await expect(t.billing.startCheckout(jean, "premium")).rejects.toMatchObject({ code: "plan_not_offered" });
      await expect(t.billing.startCheckout(jean, "premium")).rejects.toThrow(BillingError);
      expect(await t.billing.use(jean.id, "enrichedContacts")).toMatchObject({ allowed: false, upgradeTo: null, upgradeToName: null });
      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");
      await deliver(subscriptionEvent("customer.subscription.updated", { ...premium, status: "past_due" }, new Date("2026-10-15T11:00:00Z")));
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", stripeStatus: "past_due" });
    });

    it("needs a product before a paid Plan can be offered", async () => {
      await t.database.query("UPDATE plan SET stripe_product_id = NULL, status = 'hidden' WHERE key = 'standard'");

      expect(await t.billing.updatePlan("standard", { name: { fr: "Standard", en: "Standard" }, status: "offered", stripeProductId: "", features: [] })).toEqual({
        ok: false,
        error: "product_required",
      });
    });
  });

  describe("Upgrade Prompts", () => {
    it("name the lowest-ranked offered Plan above the Candidate's that allows what they asked", async () => {
      await t.billing.createPlan(ESSENTIAL);
      await t.billing.setPlanQuotas("essentiel", { ...STARTING_PLAN_QUOTAS.standard, enrichedContacts: 5 });
      await t.billing.movePlan("essentiel", "down");
      const marie = await t.signUp("marie.dupont@example.fr");

      // Still hidden: Premium is the first Plan above Free with Enriched Contacts.
      expect(await t.billing.use(marie.id, "enrichedContacts")).toMatchObject({ upgradeTo: "premium" });

      await offer("essentiel");

      expect(await t.billing.use(marie.id, "enrichedContacts")).toMatchObject({ upgradeTo: "essentiel", upgradeToName: ESSENTIAL.name });
      expect(await t.billing.use(marie.id, "matchScores")).toMatchObject({ allowed: true });
      expect((await t.billing.upgradeFor("free", (quotas) => quotas.jobDigest === "daily"))?.key).toBe("premium");
    });
  });

  describe("ranking Plans", () => {
    it("swaps a Plan with its neighbour, and the order follows", async () => {
      expect(await t.billing.movePlan("premium", "down")).toEqual({ ok: true, before: 3, after: 2 });

      expect((await t.billing.plans()).map((plan) => [plan.key, plan.rank])).toEqual([
        ["free", 1],
        ["premium", 2],
        ["standard", 3],
      ]);
      expect(await t.billing.movePlan("standard", "up")).toEqual({ ok: false, error: "cannot_move" });
      expect(await t.billing.movePlan("unknown", "up")).toEqual({ ok: false, error: "unknown_plan" });
    });
  });

  describe("the Free Plan", () => {
    const free = { name: { fr: "Découverte", en: "Discovery" }, status: "offered", stripeProductId: null, features: [] };

    it("keeps its name editable", async () => {
      expect(await t.billing.updatePlan("free", free)).toMatchObject({ ok: true, after: { key: "free", name: free.name } });
    });

    it("cannot be hidden, reranked or given a product, and nothing goes below it", async () => {
      expect(await t.billing.updatePlan("free", { ...free, status: "hidden" })).toEqual({ ok: false, error: "free_plan_built_in" });
      expect(await t.billing.updatePlan("free", { ...free, stripeProductId: FAKE_STRIPE_PRODUCTS.essential })).toEqual({ ok: false, error: "free_plan_built_in" });
      expect(await t.billing.movePlan("free", "up")).toEqual({ ok: false, error: "free_plan_built_in" });
      expect(await t.billing.movePlan("standard", "down")).toEqual({ ok: false, error: "cannot_move" });
      expect((await t.billing.plans())[0]).toMatchObject({ key: "free", rank: 1, status: "offered", stripeProductId: null });
    });
  });

  describe("the Coaching Session discount, a Plan Feature", () => {
    it("follows the Plan Feature, not the Premium Plan", async () => {
      const paul = await t.signUp("paul.martin@example.fr");
      const lea = await t.signUp("lea.moreau@example.fr");
      for (const [candidate, plan] of [[paul, "standard"], [lea, "premium"]] as const) {
        await t.billing.startCheckout(candidate, plan);
        await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(candidate.email), price: FAKE_STRIPE_PRICES[plan], status: "active" }));
      }

      await t.billing.updatePlan("premium", { name: { fr: "Premium", en: "Premium" }, status: "offered", stripeProductId: FAKE_STRIPE_PRODUCTS.premium, features: [] });
      await t.billing.updatePlan("standard", { name: { fr: "Standard", en: "Standard" }, status: "offered", stripeProductId: FAKE_STRIPE_PRODUCTS.standard, features: ["coachingSessionDiscount"] });

      expect(await t.billing.coachingSessionPrice(paul.id)).toEqual({ amount: 7200, currency: "eur", regularAmount: 9000, planName: { fr: "Standard", en: "Standard" } });
      expect(await t.billing.coachingSessionPrice(lea.id)).toEqual({ amount: 9000, currency: "eur", regularAmount: 9000, planName: { fr: "Premium", en: "Premium" } });
      await t.billing.startCoachingSessionCheckout(paul, "coach-1");
      expect(t.stripe.callsTo("/v1/checkout/sessions").at(-1)?.params.get("line_items[0][price]")).toBe(FAKE_STRIPE_COACHING_SESSION_PRICES.discounted);
    });
  });

  async function offer(key: string) {
    const plan = (await t.billing.plans()).find((candidate) => candidate.key === key)!;
    const offered = await t.billing.updatePlan(key, { ...plan, status: "offered" });
    expect(offered.ok).toBe(true);
  }

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }
});
