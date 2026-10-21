import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutSessionEvent, FAKE_STRIPE_COACHING_SESSION_PRICES, FAKE_STRIPE_PRICES, FAKE_STRIPE_PRODUCTS, fakeCustomerId, signedEvent, subscriptionEvent } from "./fake-stripe";
import { BillingError, createBilling, STARTING_PLAN_QUOTAS } from "./index";
import { connectionString, startTestBilling, type TestBilling } from "./test-support";

const FREE = { fr: "Gratuite", en: "Free" };
const STANDARD = { fr: "Standard", en: "Standard" };
const PREMIUM = { fr: "Premium", en: "Premium" };

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
      matchScores: 1,
      atsScores: 1,
      enrichedContacts: 0,
      jobSearches: 1,
      jobDigest: "none",
    });
  });

  describe("Plan Quotas in the back office", () => {
    it("lists every Plan's quotas, starting with the ones Jobbbox launches with", async () => {
      expect(await t.billing.planQuotas()).toEqual({
        free: { profiles: 1, matchScores: 1, atsScores: 1, enrichedContacts: 0, jobSearches: 1, jobDigest: "none" },
        standard: { profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobSearches: 7, jobDigest: "weekly" },
        premium: { profiles: null, matchScores: null, atsScores: null, enrichedContacts: 5, jobSearches: null, jobDigest: "daily" },
      });
    });

    it("applies an edited quota at once to the Candidates on that Plan, and keeps it across migrations", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.use(marie.id, "matchScores");

      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 2, jobDigest: "weekly" });
      await t.migrateAgain();

      expect((await t.billing.entitlements(marie.id)).quotas).toMatchObject({ matchScores: 2, jobDigest: "weekly" });
      expect(await t.billing.use(marie.id, "matchScores")).toEqual({ allowed: true, remaining: 0 });
      expect(await t.billing.use(marie.id, "matchScores")).toMatchObject({ allowed: false, limit: 2 });
    });

    it("gives a database migrated before Job Searches had a quota their starting quotas", async () => {
      await t.database.query("ALTER TABLE plan_quota DROP COLUMN job_searches");

      await t.migrateAgain();

      expect(await t.billing.planQuotas()).toMatchObject({ free: { jobSearches: 1 }, standard: { jobSearches: 7 }, premium: { jobSearches: null } });
    });

    it("turns a database counting by the month into one counting by the week, once (ADR-0032)", async () => {
      // As before weekly counting: a `month` column, the monthly starting amounts, one amount an Administrator edited.
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.database.query("ALTER TABLE quota_usage RENAME COLUMN week TO month");
      await t.database.query("INSERT INTO quota_usage (candidate_id, quota, month, used) VALUES ($1, 'matchScores', '2026-10', 3)", [marie.id]);
      await t.database.query("UPDATE plan_quota SET match_scores = 3, ats_scores = 2, job_searches = 3 WHERE plan = 'free'");
      await t.database.query("UPDATE plan_quota SET job_searches = 30 WHERE plan = 'standard'");
      await t.database.query("UPDATE plan_quota SET enriched_contacts = 20 WHERE plan = 'premium'");

      await t.migrateAgain();

      // Each amount still at its monthly starting value is divided by about 4.3 weeks, rounded up;
      // one an Administrator edited, 0 and unlimited stay as they are.
      expect(await t.billing.planQuotas()).toMatchObject({
        free: { matchScores: 1, atsScores: 2, enrichedContacts: 0, jobSearches: 1 },
        standard: { matchScores: null, jobSearches: 7 },
        premium: { enrichedContacts: 5, jobSearches: null },
      });
      // The month's uses are history: the week starts at nothing.
      expect((await t.billing.entitlements(marie.id)).usedThisWeek.matchScores).toBe(0);
      const { rows } = await t.database.query("SELECT week, used FROM quota_usage WHERE candidate_id = $1", [marie.id]);
      expect(rows).toEqual([{ week: "2026-10", used: 3 }]);

      // Later migrations leave the weekly amounts alone.
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 4 });
      await t.migrateAgain();
      expect((await t.billing.planQuotas()).free?.matchScores).toBe(4);
    });
  });

  describe("weekly quotas, enforced server-side", () => {
    it("lets a Free Candidate compute 3 Match Scores a week when their Plan grants 3, then asks them to upgrade to Standard", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 3 });

      const allowed = [];
      for (let i = 0; i < 3; i++) allowed.push(await t.billing.use(marie.id, "matchScores"));
      const refused = await t.billing.use(marie.id, "matchScores");

      expect(allowed.map((decision) => decision.allowed)).toEqual([true, true, true]);
      expect(allowed.map((decision) => decision.allowed && decision.remaining)).toEqual([2, 1, 0]);
      expect(refused).toEqual({ allowed: false, quota: "matchScores", plan: "free", planName: FREE, limit: 3, upgradeTo: "standard", upgradeToName: STANDARD });
    });

    it("starts counting again each Monday at midnight, in French time", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      t.clock.now = new Date("2026-10-18T21:30:00Z"); // 23:30 on Sunday 18 October in Paris
      await t.billing.use(marie.id, "atsScores");
      expect((await t.billing.use(marie.id, "atsScores")).allowed).toBe(false);

      t.clock.now = new Date("2026-10-18T22:30:00Z"); // 00:30 on Monday 19 October in Paris

      expect(await t.billing.use(marie.id, "atsScores")).toEqual({ allowed: true, remaining: 0 });
    });

    it("counts a week across the change to winter time and the turn of the month", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      t.clock.now = new Date("2026-10-26T08:00:00Z"); // Monday 26 October, after the clocks went back
      await t.billing.use(marie.id, "atsScores");

      t.clock.now = new Date("2026-11-01T22:59:00Z"); // 23:59 on Sunday 1 November in Paris: the same week
      expect((await t.billing.use(marie.id, "atsScores")).allowed).toBe(false);

      t.clock.now = new Date("2026-11-01T23:00:00Z"); // midnight on Monday 2 November in Paris
      expect((await t.billing.use(marie.id, "atsScores")).allowed).toBe(true);
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

      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 3 });

      const decisions = await Promise.all(Array.from({ length: 8 }, () => t.billing.use(marie.id, "matchScores")));

      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
      expect(await t.billing.use(jean.id, "matchScores")).toEqual({ allowed: true, remaining: 2 });
    });

    it("lets a Free Candidate start 1 Job Search a week, then asks them to upgrade to Standard", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect((await t.billing.use(marie.id, "jobSearches")).allowed).toBe(true);

      expect(await t.billing.use(marie.id, "jobSearches")).toEqual({ allowed: false, quota: "jobSearches", plan: "free", planName: FREE, limit: 1, upgradeTo: "standard", upgradeToName: STANDARD });
    });

    it("points a Free Candidate wanting Enriched Contacts to Premium, the first Plan that has any", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.use(marie.id, "enrichedContacts")).toEqual({
        allowed: false,
        quota: "enrichedContacts",
        plan: "free",
        planName: FREE,
        limit: 0,
        upgradeTo: "premium", upgradeToName: PREMIUM,
      });
    });
    it("says whether one more would be allowed without counting it", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await t.billing.allows(marie.id, "enrichedContacts")).toEqual({ allowed: false, quota: "enrichedContacts", plan: "free", planName: FREE, limit: 0, upgradeTo: "premium", upgradeToName: PREMIUM });
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, enrichedContacts: 1 });
      expect(await t.billing.allows(marie.id, "enrichedContacts")).toEqual({ allowed: true, remaining: 0 });
      expect(await t.billing.allows(marie.id, "enrichedContacts")).toEqual({ allowed: true, remaining: 0 });
      expect((await t.billing.entitlements(marie.id)).usedThisWeek.enrichedContacts).toBe(0);
    });

    it("gives back a use whose work could not be done", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, enrichedContacts: 1 });
      await t.billing.use(marie.id, "enrichedContacts");

      await t.billing.release(marie.id, "enrichedContacts");
      await t.billing.release(marie.id, "enrichedContacts");

      expect((await t.billing.entitlements(marie.id)).usedThisWeek.enrichedContacts).toBe(0);
      expect((await t.billing.use(marie.id, "enrichedContacts")).allowed).toBe(true);
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
        planName: FREE,
        limit: 1,
        upgradeTo: "standard", upgradeToName: STANDARD,
      });
    });
  });

  it("tells a Candidate how much of each weekly quota they have used this week", async () => {
    const marie = await t.signUp("marie.dupont@example.fr");
    await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 3 });
    await t.billing.use(marie.id, "matchScores");
    await t.billing.use(marie.id, "matchScores");
    expect((await t.billing.entitlements(marie.id)).usedThisWeek).toEqual({ matchScores: 2, atsScores: 0, enrichedContacts: 0, jobSearches: 0 });
    t.clock.now = new Date("2026-10-19T10:00:00+02:00"); // the next Monday
    await t.billing.use(marie.id, "atsScores");

    expect((await t.billing.entitlements(marie.id)).usedThisWeek).toEqual({ matchScores: 0, atsScores: 1, enrichedContacts: 0, jobSearches: 0 });
  });

  it("resets this week's usage of every Candidate, and only this week's", async () => {
    const marie = await t.signUp("marie.dupont@example.fr");
    const jean = await t.signUp("jean.martin@example.fr");
    t.clock.now = new Date("2026-10-08T10:00:00+02:00"); // the week before
    await t.billing.use(marie.id, "matchScores");
    t.clock.now = new Date("2026-10-15T10:00:00+02:00");
    await t.billing.use(marie.id, "matchScores");
    await t.billing.use(jean.id, "jobSearches");

    expect(await t.billing.resetWeeklyUsage()).toEqual({ week: "2026-10-12", candidates: 2 });

    expect((await t.billing.entitlements(marie.id)).usedThisWeek.matchScores).toBe(0);
    expect((await t.billing.entitlements(jean.id)).usedThisWeek.jobSearches).toBe(0);
    expect((await t.billing.use(marie.id, "matchScores")).allowed).toBe(true);
    const { rows } = await t.database.query("SELECT week FROM quota_usage WHERE candidate_id = $1 ORDER BY week", [marie.id]);
    expect(rows.map((row) => row.week)).toEqual(["2026-10-05", "2026-10-12"]);
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

  describe("invoices in the Stripe customer portal", () => {
    it("has them for a Candidate who pays for a Plan", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      expect(await t.billing.hasInvoices(marie.id)).toBe(true);
    });

    it("has none for a Free Candidate who was never charged, even one who left a checkout unpaid", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const jean = await t.signUp("jean.martin@example.fr");
      await t.billing.startCheckout(jean, "premium");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(jean.email), price: FAKE_STRIPE_PRICES.premium, status: "incomplete" }));
      await deliver(subscriptionEvent("customer.subscription.updated", { customer: fakeCustomerId(jean.email), price: FAKE_STRIPE_PRICES.premium, status: "incomplete_expired" }));

      expect(await t.billing.hasInvoices(marie.id)).toBe(false);
      expect(await t.billing.hasInvoices(jean.id)).toBe(false);
    });

    it("keeps them for a Candidate who paid, then went back to Free", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");
      const subscription = { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard };
      await deliver(subscriptionEvent("customer.subscription.created", { ...subscription, status: "active" }, new Date("2026-10-15T10:00:00Z")));
      await deliver(subscriptionEvent("customer.subscription.deleted", { ...subscription, status: "canceled" }, new Date("2026-10-15T11:00:00Z")));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
      expect(await t.billing.hasInvoices(marie.id)).toBe(true);
    });

    it("knows a payment happened even when Stripe reports it after the cancellation", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");
      const subscription = { customer: fakeCustomerId(marie.email), price: FAKE_STRIPE_PRICES.standard };
      await deliver(subscriptionEvent("customer.subscription.deleted", { ...subscription, status: "canceled" }, new Date("2026-10-15T11:00:00Z")));
      await deliver(subscriptionEvent("customer.subscription.updated", { ...subscription, status: "active" }, new Date("2026-10-15T10:00:00Z")));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
      expect(await t.billing.hasInvoices(marie.id)).toBe(true);
    });

    it("finds them for Candidates who paid before the app kept track, on a database migrated earlier", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const jean = await t.signUp("jean.martin@example.fr");
      for (const [candidate, status] of [[marie, "canceled"], [jean, "incomplete_expired"]] as const) {
        await t.billing.startCheckout(candidate, "standard");
        const event = "customer.subscription.deleted";
        await deliver(subscriptionEvent(event, { customer: fakeCustomerId(candidate.email), price: FAKE_STRIPE_PRICES.standard, status }));
      }
      await t.database.query("ALTER TABLE candidate_plan DROP COLUMN charged");

      await t.migrateAgain();

      expect(await t.billing.hasInvoices(marie.id)).toBe(true);
      expect(await t.billing.hasInvoices(jean.id)).toBe(false);
    });
  });

  describe("closing a Candidate's billing when they delete their account", () => {
    it("deletes their Stripe customer, which ends any subscription at once, so they are never charged again", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");

      await t.billing.closeAccount(marie.id);

      expect(t.stripe.callsTo(`/v1/customers/${fakeCustomerId(marie.email)}`)).toEqual([expect.objectContaining({ method: "DELETE" })]);
    });

    it("has nothing to close for a Candidate who never went to Stripe, even without Stripe configured", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const withoutStripe = await startTestBilling({ stripe: undefined });
      try {
        await t.billing.closeAccount(marie.id);
        await withoutStripe.billing.closeAccount((await withoutStripe.signUp("paul.martin@example.fr")).id);
      } finally {
        await withoutStripe.stop();
      }

      expect(t.stripe.calls.filter((call) => call.method === "DELETE")).toEqual([]);
    });

    it("counts a customer Stripe already deleted as closed", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await t.billing.startCheckout(marie, "standard");
      t.stripe.forgetCustomer(fakeCustomerId(marie.email));

      await expect(t.billing.closeAccount(marie.id)).resolves.toBeUndefined();
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
      expect(entitlements.quotas).toEqual({ profiles: 3, matchScores: null, atsScores: null, enrichedContacts: 0, jobSearches: 7, jobDigest: "weekly" });
    });

    it("follows a change of Plan made in the customer portal", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }));

      const entitlements = await t.billing.entitlements(marie.id);
      expect(entitlements.plan).toBe("premium");
      expect(entitlements.quotas).toEqual({ profiles: null, matchScores: null, atsScores: null, enrichedContacts: 5, jobSearches: null, jobDigest: "daily" });
    });

    it("keeps the Plan while Stripe retries a failed payment, and drops to Free once the subscription ends", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }));

      await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "past_due" }));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("standard");

      await deliver(subscriptionEvent("customer.subscription.deleted", { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard, status: "canceled" }));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("tells whether the last payment failed, from the subscription's status, until it is paid again", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      const standard = { customer: marie.customer, price: FAKE_STRIPE_PRICES.standard };
      expect((await t.billing.entitlements(marie.id)).stripeStatus).toBeNull();
      await deliver(subscriptionEvent("customer.subscription.created", { ...standard, status: "active" }, new Date("2026-10-01T10:00:00Z")));
      expect((await t.billing.entitlements(marie.id)).stripeStatus).toBe("active");

      await deliver(subscriptionEvent("customer.subscription.updated", { ...standard, status: "past_due" }, new Date("2026-10-02T10:00:00Z")));
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "standard", stripeStatus: "past_due" });

      await deliver(subscriptionEvent("customer.subscription.updated", { ...standard, status: "active" }, new Date("2026-10-03T10:00:00Z")));
      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "standard", stripeStatus: "active" });
    });

    it("has no subscription status for a Candidate who never went to Stripe", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect((await t.billing.entitlements(marie.id)).stripeStatus).toBeNull();
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

    describe("a cancellation scheduled in the customer portal", () => {
      const periodEnd = new Date("2026-11-15T09:00:00Z");

      it("keeps the paid Plan and tells when it ends, at the end of the paid period", async () => {
        const marie = await subscribed("marie.dupont@example.fr", "premium");
        const premium = { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active", currentPeriodEnd: periodEnd };
        await deliver(subscriptionEvent("customer.subscription.created", premium, new Date("2026-10-15T09:00:00Z")));
        expect((await t.billing.entitlements(marie.id)).endsAt).toBeNull();

        await deliver(subscriptionEvent("customer.subscription.updated", { ...premium, cancelAtPeriodEnd: true }, new Date("2026-10-16T09:00:00Z")));

        expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: periodEnd });
      });

      it("takes the end date Stripe sets as cancel_at, even when it is not the end of the period", async () => {
        const marie = await subscribed("marie.dupont@example.fr", "premium");
        const cancelAt = new Date("2026-11-02T12:00:00Z");

        await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active", currentPeriodEnd: periodEnd, cancelAt }));

        expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: cancelAt });
      });

      it("forgets the end date once the Candidate renews, even if Stripe delivers the cancellation late", async () => {
        const marie = await subscribed("marie.dupont@example.fr", "premium");
        const premium = { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active", currentPeriodEnd: periodEnd };
        await deliver(subscriptionEvent("customer.subscription.updated", { ...premium, cancelAtPeriodEnd: true }, new Date("2026-10-16T09:00:00Z")));

        await deliver(subscriptionEvent("customer.subscription.updated", premium, new Date("2026-10-17T09:00:00Z")));
        await deliver(subscriptionEvent("customer.subscription.updated", { ...premium, cancelAtPeriodEnd: true }, new Date("2026-10-16T09:00:00Z")));

        expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: null });
      });

      it("has no end date once the subscription has ended and the Candidate is back on Free", async () => {
        const marie = await subscribed("marie.dupont@example.fr", "premium");
        const premium = { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true };
        await deliver(subscriptionEvent("customer.subscription.updated", { ...premium, status: "active" }, new Date("2026-10-16T09:00:00Z")));

        await deliver(subscriptionEvent("customer.subscription.deleted", { ...premium, status: "canceled" }, new Date("2026-11-15T09:00:01Z")));

        expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "free", endsAt: null });
      });

      it("works on a database migrated before end dates were kept", async () => {
        const marie = await subscribed("marie.dupont@example.fr", "premium");
        await t.database.query("ALTER TABLE candidate_plan DROP COLUMN ends_at");
        await t.migrateAgain();

        await deliver(subscriptionEvent("customer.subscription.updated", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true }));

        expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", endsAt: periodEnd });
      });
    });

    it("does not end the current subscription when an older one of the same Candidate ends", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      const old = { id: "sub_old", customer: marie.customer, price: FAKE_STRIPE_PRICES.standard };
      await deliver(subscriptionEvent("customer.subscription.created", { ...old, status: "active" }));
      await deliver(subscriptionEvent("customer.subscription.created", { id: "sub_new", customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }));

      await deliver(subscriptionEvent("customer.subscription.deleted", { ...old, status: "canceled" }));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("premium");
    });

    it("brings back to Free a Candidate who cancels while on an older Price of their Plan", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      const archived = { customer: marie.customer, price: "price_standard_monthly_2025", product: FAKE_STRIPE_PRODUCTS.standard };
      await deliver(subscriptionEvent("customer.subscription.created", { ...archived, status: "active" }, new Date("2026-10-15T10:00:00Z")));
      expect((await t.billing.entitlements(marie.id)).plan).toBe("standard");

      await deliver(subscriptionEvent("customer.subscription.deleted", { ...archived, status: "canceled" }, new Date("2026-10-15T11:00:00Z")));

      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    });

    it("follows a Candidate who switches to another interval of their Plan in the customer portal", async () => {
      const marie = await subscribed("marie.dupont@example.fr");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }, new Date("2026-10-15T10:00:00Z")));
      const yearly = { customer: marie.customer, price: "price_premium_yearly", product: FAKE_STRIPE_PRODUCTS.premium };

      await deliver(subscriptionEvent("customer.subscription.updated", { ...yearly, status: "past_due" }, new Date("2026-10-15T11:00:00Z")));

      expect(await t.billing.entitlements(marie.id)).toMatchObject({ plan: "premium", stripeStatus: "past_due" });
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

    it("lets a Premium Candidate who used their 5 Enriched Contacts know no Plan offers more", async () => {
      const marie = await subscribed("marie.dupont@example.fr", "premium");
      await deliver(subscriptionEvent("customer.subscription.created", { customer: marie.customer, price: FAKE_STRIPE_PRICES.premium, status: "active" }));

      for (let i = 0; i < 5; i++) await t.billing.use(marie.id, "enrichedContacts");

      expect(await t.billing.use(marie.id, "enrichedContacts")).toEqual({
        allowed: false,
        quota: "enrichedContacts",
        plan: "premium",
        planName: PREMIUM,
        limit: 5,
        upgradeTo: null, upgradeToName: null,
      });
    });
  });

  describe("Plan prices", () => {
    it("prices the paid Plans from their Stripe Prices, and the Free Plan at 0", async () => {
      expect(await t.billing.planPrices()).toEqual({
        free: { amount: 0, currency: "eur", interval: "month" },
        standard: { amount: 1900, currency: "eur", interval: "month" },
        premium: { amount: 3900, currency: "eur", interval: "month" },
      });
    });

    it("asks Stripe once per paid Plan, for its product with the default price, and again only after a few minutes", async () => {
      const billing = createBilling(t.config);
      const before = t.stripe.callsTo(`/v1/prices/${FAKE_STRIPE_PRICES.standard}`).length;

      await billing.planPrices();
      await billing.planPrices();
      expect(t.stripe.callsTo(`/v1/products/${FAKE_STRIPE_PRODUCTS.standard}`)).toHaveLength(1);
      // One call per Plan: a Stripe that never answers holds the page for one short timeout, not two in a row.
      expect(t.stripe.callsTo(`/v1/prices/${FAKE_STRIPE_PRICES.standard}`)).toHaveLength(before);

      t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
      await billing.planPrices();
      expect(t.stripe.callsTo(`/v1/products/${FAKE_STRIPE_PRODUCTS.standard}`)).toHaveLength(2);
    });

    it("has no prices without Stripe", async () => {
      const withoutStripe = createBilling({ ...t.config, stripe: undefined });

      expect(await withoutStripe.planPrices()).toBeNull();
    });

    it("has no prices while Stripe cannot give them", async () => {
      const unreachable = createBilling({ ...t.config, stripe: { ...t.config.stripe!, apiUrl: "http://127.0.0.1:9" } });
      expect(await unreachable.planPrices()).toBeNull();
    });

    it("leaves out only the price of a Plan whose product Stripe cannot price", async () => {
      const standard = { amount: 1900, currency: "eur", interval: "month" };
      t.stripe.setDefaultPrice(FAKE_STRIPE_PRODUCTS.premium, FAKE_STRIPE_COACHING_SESSION_PRICES.regular);
      expect(await createBilling(t.config).planPrices()).toEqual({ free: { ...standard, amount: 0 }, standard }); // not a subscription Price

      t.stripe.setDefaultPrice(FAKE_STRIPE_PRODUCTS.premium, "price_unknown");
      expect(await createBilling(t.config).planPrices()).toEqual({ free: { ...standard, amount: 0 }, standard });
    });

    it("gives up on a Stripe that never answers within a few seconds, and does not wait on it again at once", async () => {
      t.stripe.stopAnswering();

      const started = Date.now();
      expect(await t.billing.planPrices()).toBeNull();
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(t.stripe.callsTo(`/v1/products/${FAKE_STRIPE_PRODUCTS.standard}`)).toHaveLength(1); // no retry

      const again = Date.now();
      expect(await t.billing.planPrices()).toBeNull();
      expect(Date.now() - again).toBeLessThan(100);
      expect(t.stripe.callsTo(`/v1/products/${FAKE_STRIPE_PRODUCTS.standard}`)).toHaveLength(1);

      t.clock.now = new Date(t.clock.now.getTime() + 2 * 60_000);
      await t.billing.planPrices();
      expect(t.stripe.callsTo(`/v1/products/${FAKE_STRIPE_PRODUCTS.standard}`)).toHaveLength(2);
    }, 30_000);
  });

  describe("Coaching Sessions", () => {
    async function onPlan(email: string, plan: "standard" | "premium") {
      const candidate = await t.signUp(email);
      await t.billing.startCheckout(candidate, plan);
      await deliver(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES[plan], status: "active" }));
      return candidate;
    }

    it("has a single Coaching Session Price, discounted on the Premium Plan", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const paul = await onPlan("paul.martin@example.fr", "standard");
      const lea = await onPlan("lea.moreau@example.fr", "premium");

      expect(await t.billing.coachingSessionPrice(marie.id)).toEqual({ amount: 9000, currency: "eur", regularAmount: 9000, planName: FREE });
      expect(await t.billing.coachingSessionPrice(paul.id)).toEqual({ amount: 9000, currency: "eur", regularAmount: 9000, planName: STANDARD });
      expect(await t.billing.coachingSessionPrice(lea.id)).toEqual({ amount: 7200, currency: "eur", regularAmount: 9000, planName: PREMIUM });
    });

    it("sends the Candidate to a one-off Stripe Checkout at their Plan's Coaching Session Price", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const lea = await onPlan("lea.moreau@example.fr", "premium");

      const url = await t.billing.startCoachingSessionCheckout(marie, "coach-1", "en");
      await t.billing.startCoachingSessionCheckout(lea, "coach-1");

      expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      const [regular, premium] = t.stripe.callsTo("/v1/checkout/sessions").filter((call) => call.params.get("mode") === "payment");
      expect(Object.fromEntries(regular!.params)).toMatchObject({
        mode: "payment",
        customer: fakeCustomerId(marie.email),
        client_reference_id: marie.id,
        "line_items[0][price]": FAKE_STRIPE_COACHING_SESSION_PRICES.regular,
        "line_items[0][quantity]": "1",
        "metadata[purpose]": "coaching_session",
        "metadata[coach_id]": "coach-1",
        "metadata[candidate_id]": marie.id,
        locale: "en",
        success_url: "http://localhost:3000/coachs?session=paid",
        cancel_url: "http://localhost:3000/coachs",
      });
      expect(premium?.params.get("line_items[0][price]")).toBe(FAKE_STRIPE_COACHING_SESSION_PRICES.discounted);
    });

    it("reports a Coaching Session as paid only from Stripe's signed webhook, once paid", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const session = { id: "cs_coaching_1", candidateId: marie.id, coachId: "coach-1", amount: 9000, currency: "eur" };

      await deliver(checkoutSessionEvent("checkout.session.completed", { ...session, paymentStatus: "unpaid" }));
      expect(t.coachingSessionsPaid).toEqual([]);

      await deliver(checkoutSessionEvent("checkout.session.async_payment_succeeded", { ...session, paymentStatus: "paid" }));
      await deliver(checkoutSessionEvent("checkout.session.completed", { ...session, paymentStatus: "paid" }));

      const reported = { checkoutSessionId: "cs_coaching_1", candidateId: marie.id, coachId: "coach-1", amount: 9000, currency: "eur" };
      expect(t.coachingSessionsPaid).toEqual([reported, reported]); // The Human Coaches module records it once.
    });

    it("ignores a completed checkout that is not for a Coaching Session", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      await deliver(checkoutSessionEvent("checkout.session.completed", { id: "cs_sub", candidateId: marie.id, amount: 1900, currency: "eur", paymentStatus: "paid", mode: "subscription" }));

      expect(t.coachingSessionsPaid).toEqual([]);
    });

    it("cannot take payment for Coaching Sessions until their Prices are configured", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const withoutPrices = createBilling({ ...t.config, stripe: { ...t.config.stripe!, coachingSessionPrices: undefined } });

      expect(await withoutPrices.coachingSessionPrice(marie.id)).toBeNull();
      await expect(withoutPrices.startCoachingSessionCheckout(marie, "coach-1")).rejects.toMatchObject({ code: "coaching_sessions_not_configured" });
      expect(await withoutPrices.startCheckout(marie, "standard")).toMatch(/checkout\.stripe\.test/); // Plans still work.
    });
  });

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }
});
