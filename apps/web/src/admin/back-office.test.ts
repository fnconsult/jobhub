import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createBilling, migrateBilling, STARTING_PLAN_QUOTAS, weekInFrance, type Billing } from "../billing";
import { FAKE_STRIPE_PRODUCTS, FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET, startFakeStripe } from "../billing/fake-stripe";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoaches } from "../human-coaches";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";

describe.skipIf(!connectionString)("the Back Office and its Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let billing: Billing;
  let humanCoaches: HumanCoaches;
  let backOffice: BackOffice;
  let claire: BackOfficeActor;

  async function signUp(email: string): Promise<BackOfficeActor> {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id, email: user.email };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateBilling(database);
    await migrateHumanCoaches(database);
    await migrateBackOfficeAudit(database);
    billing = createBilling({ database, baseURL: "http://localhost:3000" });
    const profiles = createProfiles(database);
    const applications = createApplications(database, { jobOffers: createJobOffers(database), profiles });
    humanCoaches = createHumanCoaches(database, {
      profiles,
      applications,
      tailoredDocuments: { get: async () => null },
      tailoredCvs: { get: async () => null },
    });
    backOffice = createBackOffice(database, { billing, humanCoaches });
    claire = await signUp("claire@jobbbox.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("editing a Plan Quota records one entry: who, before and after", async () => {
    const quotas = { ...STARTING_PLAN_QUOTAS.standard, matchScores: 40, jobDigest: "daily" as const };

    await backOffice.setPlanQuotas(claire, "standard", quotas);

    expect((await billing.planQuotas()).standard).toEqual(quotas);
    const journal = await backOffice.journal();
    expect(journal).toEqual([
      {
        id: expect.any(String),
        at: expect.any(Date),
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "plan_quotas",
        target: "standard",
        action: "updated",
        before: STARTING_PLAN_QUOTAS.standard,
        after: quotas,
        outcome: "succeeded",
        failure: null,
      },
    ]);
  });

  it("resetting this week's usage of every Candidate records one entry with its reason; none without a reason", async () => {
    await billing.use(claire.id, "matchScores");

    expect(await backOffice.resetWeeklyUsage(claire, "   ")).toEqual({ ok: false, error: "reason_required" });
    expect((await billing.entitlements(claire.id)).usedThisWeek.matchScores).toBe(1);
    expect(await backOffice.journal()).toEqual([]);

    expect(await backOffice.resetWeeklyUsage(claire, "  Recherches d'offres en panne mardi  ")).toEqual({ ok: true, candidates: 1 });

    expect((await billing.entitlements(claire.id)).usedThisWeek.matchScores).toBe(0);
    expect(await backOffice.journal()).toEqual([
      {
        id: expect.any(String),
        at: expect.any(Date),
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "plan_quotas",
        target: weekInFrance(new Date()),
        action: "reset",
        before: null,
        after: { reason: "Recherches d'offres en panne mardi", candidates: 1 },
        outcome: "succeeded",
        failure: null,
      },
    ]);
  });

  it("editing an unknown Plan's quotas records nothing", async () => {
    await backOffice.setPlanQuotas(claire, "unknown", STARTING_PLAN_QUOTAS.standard);

    expect(await backOffice.journal()).toEqual([]);
  });

  it("creating, changing and moving a Plan each record one entry; a refused one records nothing", async () => {
    const stripe = await startFakeStripe();
    try {
      const withStripe = createBilling({ database, baseURL: "http://localhost:3000", stripe: { secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: stripe.url } });
      const plansOffice = createBackOffice(database, { billing: withStripe, humanCoaches: { add: async () => ({ ok: false, error: "invalid" }) as never, retire: async () => null } });
      const essential = { key: "essentiel", name: { fr: "Essentiel", en: "Essential" }, stripeProductId: FAKE_STRIPE_PRODUCTS.essential, features: [] };

      expect(await plansOffice.createPlan(claire, essential)).toMatchObject({ ok: true });
      expect(await plansOffice.createPlan(claire, essential)).toEqual({ ok: false, error: "key_taken" });
      expect(await plansOffice.updatePlan(claire, "essentiel", { ...essential, status: "offered", features: ["coachingSessionDiscount"] })).toMatchObject({ ok: true });
      expect(await plansOffice.movePlan(claire, "essentiel", "down")).toEqual({ ok: true, before: 4, after: 3 });
      expect(await plansOffice.movePlan(claire, "free", "up")).toEqual({ ok: false, error: "free_plan_built_in" });
      expect(await plansOffice.createPlan(claire, { ...essential, key: "inconnu", stripeProductId: "prod_NotInStripe" })).toEqual({ ok: false, error: "product_not_found" });
      expect(await plansOffice.journal({ outcome: "failed" })).toMatchObject([
        {
          section: "plans",
          target: "inconnu",
          action: "refused",
          failure: { reason: "stripe_refused", tried: "added", field: "stripeProductId", technical: { provider: "stripe", status: 404, message: "resource_missing: No such product: 'prod_NotInStripe'" } },
        },
      ]);

      const recorded = { name: { fr: "Essentiel", en: "Essential" }, status: "hidden", stripeProductId: FAKE_STRIPE_PRODUCTS.essential, features: [] };
      expect((await plansOffice.journal({ outcome: "succeeded" })).map(({ section, target, action, before, after }) => ({ section, target, action, before, after }))).toEqual([
        { section: "plans", target: "essentiel", action: "updated", before: { rank: 4 }, after: { rank: 3 } },
        { section: "plans", target: "essentiel", action: "updated", before: recorded, after: { ...recorded, status: "offered", features: ["coachingSessionDiscount"] } },
        { section: "plans", target: "essentiel", action: "added", before: null, after: { ...recorded, rank: 4, quotas: { ...STARTING_PLAN_QUOTAS.premium } } },
      ]);
    } finally {
      await stripe.stop();
    }
  });

  it("creates Plans asked for at the same time one after the other, and answers a taken key with a PlanError", async () => {
    const stripe = await startFakeStripe();
    try {
      const withStripe = createBilling({ database, baseURL: "http://localhost:3000", stripe: { secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: stripe.url } });
      const plansOffice = createBackOffice(database, { billing: withStripe, humanCoaches: { add: async () => ({ ok: false, error: "invalid" }) as never, retire: async () => null } });
      const plan = (key: string, stripeProductId: string) => ({ key, name: { fr: key, en: key }, stripeProductId, features: [] });

      const [essentiel, other] = await Promise.all([
        plansOffice.createPlan(claire, plan("essentiel", FAKE_STRIPE_PRODUCTS.essential)),
        plansOffice.createPlan(claire, plan("essentiel-bis", FAKE_STRIPE_PRODUCTS.standard)),
      ]);
      const same = await Promise.all([1, 2].map(() => plansOffice.createPlan(claire, plan("annuel", FAKE_STRIPE_PRODUCTS.premium))));

      expect(essentiel).toMatchObject({ ok: true });
      expect(other).toMatchObject({ ok: true });
      expect((await withStripe.plans()).map((each) => each.rank)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(same.filter((result) => result.ok)).toHaveLength(1);
      expect(same.filter((result) => !result.ok)).toEqual([{ ok: false, error: "key_taken" }]);
    } finally {
      await stripe.stop();
    }
  });

  it("creating and deactivating a Coupon each record one entry, after Stripe; a refused one records nothing", async () => {
    const stripe = await startFakeStripe();
    try {
      const withStripe = createBilling({ database, baseURL: "http://localhost:3000", stripe: { secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: stripe.url } });
      await withStripe.updatePlan("standard", { name: { fr: "Standard", en: "Standard" }, status: "offered", stripeProductId: FAKE_STRIPE_PRODUCTS.standard, features: [] });
      const couponsOffice = createBackOffice(database, { billing: withStripe, humanCoaches: { add: async () => ({ ok: false, error: "invalid" }) as never, retire: async () => null } });
      const spring = { code: "PRINTEMPS50", percentOff: 50, duration: "repeating", durationInMonths: 3, plans: ["standard"], expiresAt: "2027-03-31", maxRedemptions: 100, firstPaymentOnly: true };

      const created = await couponsOffice.createCoupon(claire, spring);
      expect(created).toMatchObject({ ok: true, coupon: { code: "PRINTEMPS50" } });
      expect(await couponsOffice.createCoupon(claire, spring)).toEqual({ ok: false, error: "code_taken" });
      if (!created.ok) throw new Error("fixture refused");
      expect(await couponsOffice.deactivateCoupon(claire, created.coupon.id)).toMatchObject({ ok: true });
      // Already inactive: nothing changed, nothing recorded.
      expect(await couponsOffice.deactivateCoupon(claire, created.coupon.id)).toMatchObject({ ok: true });
      expect(await couponsOffice.deactivateCoupon(claire, "promo_unknown")).toEqual({ ok: false, error: "unknown_coupon" });

      // Refused by Stripe: in the Journal as failed, with Stripe's code and message (#263).
      expect(await couponsOffice.journal({ section: "coupons", outcome: "failed" })).toMatchObject([
        {
          target: "promo_unknown",
          action: "refused",
          failure: {
            reason: "stripe_refused",
            tried: "updated",
            field: null,
            technical: { class: "StripeInvalidRequestError", provider: "stripe", status: 404, message: "resource_missing: No such promotion code: 'promo_unknown'" },
          },
        },
      ]);

      const terms = {
        code: "PRINTEMPS50",
        discount: { percentOff: 50 },
        duration: { months: 3 },
        plans: ["standard"],
        expiresAt: "2027-03-31T21:59:59.000Z",
        maxRedemptions: 100,
        firstPaymentOnly: true,
      };
      expect((await couponsOffice.journal({ section: "coupons", outcome: "succeeded" })).map(({ section, target, action, before, after }) => ({ section, target, action, before, after }))).toEqual([
        { section: "coupons", target: "PRINTEMPS50", action: "updated", before: { active: true }, after: { active: false } },
        { section: "coupons", target: "PRINTEMPS50", action: "added", before: null, after: terms },
      ]);
    } finally {
      await stripe.stop();
    }
  });

  it("a Coupon change that cannot be recorded is undone in Stripe", async () => {
    const stripe = await startFakeStripe();
    try {
      const withStripe = createBilling({ database, baseURL: "http://localhost:3000", stripe: { secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: stripe.url } });
      await withStripe.updatePlan("standard", { name: { fr: "Standard", en: "Standard" }, status: "offered", stripeProductId: FAKE_STRIPE_PRODUCTS.standard, features: [] });
      const couponsOffice = createBackOffice(database, { billing: withStripe, humanCoaches: { add: async () => ({ ok: false, error: "invalid" }) as never, retire: async () => null } });
      const unknownAdministrator = { id: "no-such-candidate", email: "ghost@jobbbox.fr" };
      const spring = { code: "PRINTEMPS50", percentOff: 50, duration: "once", plans: ["standard"], firstPaymentOnly: false };

      await expect(couponsOffice.createCoupon(unknownAdministrator, spring)).rejects.toThrow();
      expect(await withStripe.coupons()).toMatchObject([{ code: "PRINTEMPS50", active: false }]);

      const created = await couponsOffice.createCoupon(claire, { ...spring, code: "AUTOMNE" });
      if (!created.ok) throw new Error("fixture refused");
      await expect(couponsOffice.deactivateCoupon(unknownAdministrator, created.coupon.id)).rejects.toThrow();
      expect((await withStripe.coupons())![0]).toMatchObject({ code: "AUTOMNE", active: true });
      expect((await couponsOffice.journal({ section: "coupons" })).map((entry) => entry.action)).toEqual(["added"]);
    } finally {
      await stripe.stop();
    }
  });

  it("adding and retiring a Human Coach each record one entry; a refused one records nothing", async () => {
    const sophie = { name: "Sophie Martin", email: "Sophie.Martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance", bio: "Ancienne DRH." };

    const added = await backOffice.addHumanCoach(claire, sophie);
    if (!added.ok) throw new Error("fixture refused");
    expect(await backOffice.addHumanCoach(claire, { ...sophie, bookingUrl: "https://calendly.com/sophie" })).toMatchObject({ ok: false });
    await backOffice.retireHumanCoach(claire, added.coach.id);
    await backOffice.retireHumanCoach(claire, added.coach.id);

    const coach = { id: added.coach.id, name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance", bio: "Ancienne DRH." };
    expect(await backOffice.journal()).toMatchObject([
      { section: "human_coaches", target: "sophie.martin@rh-conseil.fr", action: "retired", before: coach, after: null },
      { section: "human_coaches", target: "sophie.martin@rh-conseil.fr", action: "added", before: null, after: coach, actor: { candidateId: claire.id, email: "claire@jobbbox.fr" } },
    ]);
  });

  it("a write that fails records nothing", async () => {
    const refused = { ...STARTING_PLAN_QUOTAS.standard, profiles: -1 };

    await expect(backOffice.setPlanQuotas(claire, "standard", refused)).rejects.toThrow();

    expect(await backOffice.journal()).toEqual([]);
    expect((await billing.planQuotas()).standard).toEqual(STARTING_PLAN_QUOTAS.standard);
  });

  it("a change that cannot be recorded is not kept either", async () => {
    const unknownAdministrator = { id: "no-such-candidate", email: "ghost@jobbbox.fr" };

    await expect(backOffice.setPlanQuotas(unknownAdministrator, "standard", { ...STARTING_PLAN_QUOTAS.standard, profiles: 9 })).rejects.toThrow();

    expect((await billing.planQuotas()).standard).toEqual(STARTING_PLAN_QUOTAS.standard);
    expect(await backOffice.journal()).toEqual([]);
  });

  it("a replaced secret is recorded without its value", async () => {
    const secret = "sk-live-0123456789";

    await backOffice.record(
      claire,
      async () => secret,
      // As a careless caller could pass it: the value must still not be recorded.
      () => ({ section: "provider_secrets", target: "MISTRAL_API_KEY", action: "replaced", before: "sk-old", after: secret }) as never,
    );

    const [entry] = await backOffice.journal();
    expect(entry).toMatchObject({ section: "provider_secrets", target: "MISTRAL_API_KEY", action: "replaced", before: null, after: null });
    expect(JSON.stringify(entry)).not.toContain("sk-");
  });

  it("the Journal lists entries newest first, everything or one section", async () => {
    await backOffice.setPlanQuotas(claire, "free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 5 });
    const added = await backOffice.addHumanCoach(claire, { name: "Luc Bernard", email: "luc@rh-conseil.fr", bookingUrl: "https://cal.com/luc/seance" });
    if (!added.ok) throw new Error("fixture refused");
    await backOffice.setPlanQuotas(claire, "premium", { ...STARTING_PLAN_QUOTAS.premium, matchScores: 500 });

    expect((await backOffice.journal()).map((entry) => entry.target)).toEqual(["premium", "luc@rh-conseil.fr", "free"]);
    expect((await backOffice.journal({ section: "plan_quotas" })).map((entry) => entry.target)).toEqual(["premium", "free"]);
    expect((await backOffice.journal({ section: "human_coaches" })).map((entry) => entry.target)).toEqual(["luc@rh-conseil.fr"]);
    expect(await backOffice.journal({ section: "roles" })).toEqual([]);
  });

  it("a refused attempt is recorded as failed and its write undone: what was tried, on which target, the field at fault and its Failure Reason", async () => {
    const refused = await backOffice.record(
      claire,
      async (within) => {
        await billing.setPlanQuotas("standard", { ...STARTING_PLAN_QUOTAS.standard, matchScores: 1 }, within);
        return { refused: "last_super_admin" as const };
      },
      () => ({ section: "roles", target: "luc@rh-conseil.fr", tried: "updated", reason: "last_super_admin", field: "roles" }),
    );

    expect(refused).toEqual({ refused: "last_super_admin" });
    expect((await billing.planQuotas()).standard).toEqual(STARTING_PLAN_QUOTAS.standard);
    expect(await backOffice.journal()).toEqual([
      {
        id: expect.any(String),
        at: expect.any(Date),
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "roles",
        target: "luc@rh-conseil.fr",
        action: "refused",
        outcome: "failed",
        before: null,
        after: null,
        failure: { reason: "last_super_admin", tried: "updated", field: "roles", technical: null },
      },
    ]);
  });

  it("a failed test is recorded with its technical reason, scrubbed of keys and cut at 500 characters", async () => {
    const key = "sk-proj-0123456789abcdefghij";

    await backOffice.recordFailure(claire, {
      section: "provider_secrets",
      target: "MISTRAL_API_KEY",
      tried: "tested",
      reason: "test_failed",
      technical: { class: "ConnectionTest", provider: "mistral", status: 401, message: `HTTP 401 {"message":"Unauthorized: ${key}"} ${"invalid key, ".repeat(60)}` },
    });

    const [entry] = await backOffice.journal();
    expect(entry).toMatchObject({
      section: "provider_secrets",
      target: "MISTRAL_API_KEY",
      action: "tested",
      outcome: "failed",
      failure: { reason: "test_failed", tried: "tested", field: null, technical: { class: "ConnectionTest", provider: "mistral", status: 401 } },
    });
    expect(entry!.failure!.technical!.message).toHaveLength(500);
    expect(JSON.stringify(entry)).not.toContain(key);
  });

  it("the Journal lists the succeeded or the failed entries, with or without a section", async () => {
    await backOffice.setPlanQuotas(claire, "free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 5 });
    await backOffice.recordFailure(claire, { section: "roles", target: "luc@rh-conseil.fr", tried: "updated", reason: "unknown_account" });
    await backOffice.recordFailure(claire, { section: "plan_quotas", target: "free", tried: "updated", reason: "other" });

    expect((await backOffice.journal({ outcome: "failed" })).map((entry) => entry.target)).toEqual(["free", "luc@rh-conseil.fr"]);
    expect((await backOffice.journal({ outcome: "succeeded" })).map((entry) => [entry.target, entry.outcome, entry.failure])).toEqual([["free", "succeeded", null]]);
    expect((await backOffice.journal({ section: "roles", outcome: "failed" })).map((entry) => entry.target)).toEqual(["luc@rh-conseil.fr"]);
    expect(await backOffice.journal({ section: "roles", outcome: "succeeded" })).toEqual([]);
  });

  it("an Administrator opening a section outside their Back Office Roles leaves one denied entry per section and minute (#264)", async () => {
    let now = new Date("2026-10-21T10:00:05Z");
    const clocked = createBackOffice(database, { billing, humanCoaches, now: () => now });

    await clocked.recordDenied(claire, "aiMessages", "read");
    now = new Date("2026-10-21T10:00:50Z");
    await clocked.recordDenied(claire, "aiMessages", "read");

    expect(await clocked.journal()).toEqual([
      {
        id: expect.any(String),
        at: new Date("2026-10-21T10:00:05Z"),
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "ai_messages",
        target: "/admin/journaux-ia",
        action: "denied",
        outcome: "failed",
        before: null,
        after: null,
        failure: { reason: "role_missing", tried: "viewed", field: null, technical: null },
      },
    ]);

    await clocked.recordDenied(claire, "audit", "read");
    await clocked.recordDenied(claire, "plans", "write");
    now = new Date("2026-10-21T10:01:02Z");
    await clocked.recordDenied(claire, "aiMessages", "read");
    expect((await clocked.journal()).map((entry) => [entry.section, entry.action, entry.failure?.tried])).toEqual([
      ["ai_messages", "denied", "viewed"],
      ["plans", "denied", "updated"],
      ["journal", "denied", "viewed"],
      ["ai_messages", "denied", "viewed"],
    ]);
  });

  it("an Administrator denied the Platform Settings is recorded in their section, on Paramètres (#298)", async () => {
    await backOffice.recordDenied(claire, "platformSettings", "read");

    expect((await backOffice.journal()).map((entry) => [entry.section, entry.target, entry.action])).toEqual([["platform_settings", "/admin/parametres", "denied"]]);
  });

  it("two requests denied at the same moment leave one entry (#264)", async () => {
    const now = new Date("2026-10-21T10:00:05Z");
    const clocked = createBackOffice(database, { billing, humanCoaches, now: () => now });

    await Promise.all([clocked.recordDenied(claire, "aiMessages", "read"), clocked.recordDenied(claire, "aiMessages", "read")]);

    expect(await clocked.journal()).toHaveLength(1);
  });

  it("the Journal stays newest first past entry 9, 99... (entries are ordered as numbers)", async () => {
    await database.query("ALTER SEQUENCE back_office_audit_id_seq RESTART WITH 9");
    for (const target of ["ninth", "tenth", "eleventh"]) {
      await backOffice.record(claire, async () => null, () => ({ section: "roles", target, action: "added", before: null, after: { roles: ["support"] } }));
    }

    expect((await backOffice.journal()).map((entry) => entry.target)).toEqual(["eleventh", "tenth", "ninth"]);
  });
});
