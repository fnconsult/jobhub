import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice } from "../admin/back-office";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { FAKE_STRIPE_PRICES, fakeCustomerId, signedEvent, subscriptionEvent } from "../billing/fake-stripe";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createQuotaReductions, migrateQuotaReductions } from "./index";

const standard = STARTING_PLAN_QUOTAS.standard;
const notice = { reason: "Les recherches coûtent plus cher à nos fournisseurs.", effectiveOn: "2026-11-14" };

describe.skipIf(!connectionString)("Quota Reductions in the Back Office and its Back Office Audit (#514, needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let backOffice: BackOffice;
  let claire: { id: string; email: string };

  beforeEach(async () => {
    t = await startTestBilling();
    await migrateBackOfficeAudit(t.database);
    await migrateQuotaReductions(t.database);
    const quotaReductions = createQuotaReductions(t.database, { billing: t.billing, mailer: { send: async () => {} }, baseURL: "https://app.jobbbox.fr", now: () => t.clock.now });
    backOffice = createBackOffice(t.database, { billing: t.billing, humanCoaches: { add: async () => ({ ok: false, error: "invalid" }) as never, retire: async () => null }, quotaReductions });
    claire = await t.signUp("claire@jobbbox.fr");
    // A subscriber on each paid Plan.
    for (const [email, price] of [["marie.dupont@example.fr", FAKE_STRIPE_PRICES.standard], ["lea.bernard@example.fr", FAKE_STRIPE_PRICES.premium]] as const) {
      const candidate = await t.signUp(email);
      await t.billing.startCheckout(candidate, price === FAKE_STRIPE_PRICES.standard ? "standard" : "premium");
      const event = signedEvent(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(email), price, status: "active" }));
      await t.billing.handleStripeWebhook(event.payload, event.signature);
    }
  });
  afterEach(async () => {
    await t.stop();
  });

  const journal = async () => (await backOffice.journal()).map(({ section, target, action, before, after }) => ({ section, target, action, before, after })).reverse();

  it("lowering a Plan Quota of a Plan with subscribers records what applied now and the reduction scheduled", async () => {
    expect(await backOffice.setPlanQuotas(claire, "standard", { ...standard, profiles: 5, jobSearches: 3 }, notice)).toMatchObject({ ok: true, scheduled: { effectiveOn: "2026-11-14", subscribers: 1 } });

    expect(await journal()).toEqual([
      { section: "plan_quotas", target: "standard", action: "updated", before: standard, after: { ...standard, profiles: 5 } },
      {
        section: "plan_quotas",
        target: "standard",
        action: "scheduled",
        before: null,
        after: { quotas: { jobSearches: { before: 7, after: 3 } }, removedFeatures: [], reason: notice.reason, effectiveOn: "2026-11-14", subscribers: 1, reduction: expect.any(String) },
      },
    ]);
  });

  it("refused without its notice, it changes and records nothing", async () => {
    expect(await backOffice.setPlanQuotas(claire, "standard", { ...standard, profiles: 5, jobSearches: 3 })).toEqual({ ok: false, error: "notice_required" });

    expect((await t.billing.planQuotas()).standard).toEqual(standard);
    expect(await journal()).toEqual([]);
  });

  it("an increase is recorded as before, applied at once", async () => {
    expect(await backOffice.setPlanQuotas(claire, "standard", { ...standard, jobSearches: 10 })).toEqual({ ok: true, scheduled: null });

    expect(await journal()).toEqual([{ section: "plan_quotas", target: "standard", action: "updated", before: standard, after: { ...standard, jobSearches: 10 } }]);
  });

  it("taking a Plan Feature off a Plan with subscribers keeps it until the reduction's date", async () => {
    const premium = (await t.billing.plans()).find((plan) => plan.key === "premium")!;
    const input = { name: premium.name, status: premium.status, stripeProductId: premium.stripeProductId, features: [] };

    expect(await backOffice.updatePlan(claire, "premium", input)).toEqual({ ok: false, error: "notice_required" });
    expect(await backOffice.updatePlan(claire, "premium", { ...input, name: { fr: "Premium+", en: "Premium+" } }, notice)).toMatchObject({ ok: true, scheduled: { removedFeatures: ["coachingSessionDiscount"] } });

    expect((await t.billing.plans()).find((plan) => plan.key === "premium")).toMatchObject({ name: { fr: "Premium+" }, features: ["coachingSessionDiscount"] });
    expect((await journal()).map(({ section, action }) => ({ section, action }))).toEqual([
      { section: "plans", action: "updated" },
      { section: "plans", action: "scheduled" },
    ]);
  });

  it("cancelling a scheduled reduction records it; cancelling it again records nothing", async () => {
    const scheduled = await backOffice.setPlanQuotas(claire, "standard", { ...standard, jobSearches: 3 }, notice);
    const id = (scheduled as { scheduled: { id: string } }).scheduled.id;

    expect(await backOffice.cancelQuotaReduction(claire, id)).toBe(true);
    expect(await backOffice.cancelQuotaReduction(claire, id)).toBe(false);
    expect(await backOffice.cancelQuotaReduction(claire, "not-an-id")).toBe(false);

    expect((await journal()).map(({ action }) => action)).toEqual(["scheduled", "cancelled"]);
    expect((await journal())[1]).toMatchObject({ section: "plan_quotas", target: "standard", before: { reason: notice.reason, effectiveOn: "2026-11-14", reduction: id }, after: null });
  });
});
