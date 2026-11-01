import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateBackOfficeAudit } from "../admin/back-office";
import type { MailMessage } from "../auth";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { FAKE_STRIPE_PRICES, fakeCustomerId, signedEvent, subscriptionEvent } from "../billing/fake-stripe";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createQuotaReductions, migrateQuotaReductions, type QuotaReductions } from "./index";

const claire = { id: "", email: "claire@jobbbox.fr" };
const standard = STARTING_PLAN_QUOTAS.standard;
// The test clock says 15 October 2026, 10:00 in Paris: 30 days later is 14 November.
const IN_30_DAYS = "2026-11-14";

describe.skipIf(!connectionString)("Quota Reductions (#514, needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let reductions: QuotaReductions;
  let outbox: MailMessage[];

  beforeEach(async () => {
    t = await startTestBilling();
    await migrateBackOfficeAudit(t.database);
    await migrateQuotaReductions(t.database);
    outbox = [];
    reductions = createQuotaReductions(t.database, { billing: t.billing, mailer: { send: async (message) => void outbox.push(message) }, baseURL: "https://app.jobbbox.fr", now: () => t.clock.now });
    claire.id = (await t.signUp("claire@jobbbox.fr")).id;
  });
  afterEach(async () => {
    await t.stop();
  });

  async function subscriber(email: string, price: string = FAKE_STRIPE_PRICES.standard) {
    const candidate = await t.signUp(email);
    await t.billing.startCheckout(candidate, price === FAKE_STRIPE_PRICES.standard ? "standard" : "premium");
    const customer = fakeCustomerId(email);
    const event = signedEvent(subscriptionEvent("customer.subscription.created", { customer, price, status: "active" }, new Date("2026-10-01T10:00:00+02:00")));
    await t.billing.handleStripeWebhook(event.payload, event.signature);
    const subscription = `sub_fake_${customer}`;
    t.stripe.payPeriod(subscription, { amount: 999, start: new Date("2026-10-01T00:00:00+02:00"), end: new Date("2026-10-31T00:00:00+01:00") });
    return { ...candidate, subscription };
  }

  const lower = { ...standard, jobSearches: 3 };
  const notice = { reason: "Les recherches coûtent plus cher à nos fournisseurs.", effectiveOn: IN_30_DAYS };

  it("a reduction on Standard with subscribers needs a reason and a date 30 days ahead at least", async () => {
    await subscriber("marie.dupont@example.fr");

    expect(await reductions.changeQuotas("standard", lower, null, t.database, claire)).toEqual({ ok: false, error: "notice_required" });
    expect(await reductions.changeQuotas("standard", lower, { ...notice, reason: "  " }, t.database, claire)).toEqual({ ok: false, error: "notice_required" });
    expect(await reductions.changeQuotas("standard", lower, { ...notice, effectiveOn: "2026-11-13" }, t.database, claire)).toEqual({ ok: false, error: "too_soon" });
    expect(await reductions.changeQuotas("standard", lower, { ...notice, effectiveOn: "le 14" }, t.database, claire)).toEqual({ ok: false, error: "invalid_effective_date" });
    expect((await t.billing.planQuotas()).standard).toEqual(standard);
  });

  it("is scheduled at J+30: the quotas change only on that date, recorded in the Back Office Audit", async () => {
    const marie = await subscriber("marie.dupont@example.fr");

    const changed = await reductions.changeQuotas("standard", lower, notice, t.database, claire);

    expect(changed).toMatchObject({ ok: true, before: standard, applied: standard, scheduled: { plan: "standard", quotas: { jobSearches: { before: 7, after: 3 } }, effectiveOn: IN_30_DAYS, subscribers: 1 } });
    expect(await reductions.pending()).toMatchObject([{ plan: "standard", effectiveOn: IN_30_DAYS, reason: notice.reason, subscribers: 1, scheduledBy: "claire@jobbbox.fr" }]);
    expect(await reductions.changeQuotas("standard", { ...standard, profiles: 1 }, notice, t.database, claire)).toEqual({ ok: false, error: "reduction_pending" });

    t.clock.now = new Date("2026-11-13T23:59:00+01:00");
    expect(await reductions.run()).toMatchObject({ applied: 0 });
    expect((await t.billing.entitlements(marie.id)).quotas.jobSearches).toBe(7);

    t.clock.now = new Date("2026-11-14T00:00:00+01:00");
    expect(await reductions.run()).toMatchObject({ applied: 1 });
    expect((await t.billing.entitlements(marie.id)).quotas.jobSearches).toBe(3);
    expect(await reductions.pending()).toEqual([]);
    const { rows } = await t.database.query("SELECT actor_email, section, target, action, before, after FROM back_office_audit");
    expect(rows).toEqual([
      { actor_email: "claire@jobbbox.fr", section: "plan_quotas", target: "standard", action: "applied", before: standard, after: { ...lower, reduction: expect.any(String) } },
    ]);
  });

  it("an increase made with it applies at once; the quotas it lowers wait", async () => {
    await subscriber("marie.dupont@example.fr");

    const changed = await reductions.changeQuotas("standard", { ...standard, profiles: 5, jobSearches: 3 }, notice, t.database, claire);

    expect(changed).toMatchObject({ ok: true, applied: { ...standard, profiles: 5 }, scheduled: { quotas: { jobSearches: { before: 7, after: 3 } } } });
    expect((await t.billing.planQuotas()).standard).toEqual({ ...standard, profiles: 5 });
  });

  it("each paying subscriber gets one e-mail with the reason, the date and their right to cancel", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    await subscriber("paul.martin@example.fr");
    await subscriber("lea.bernard@example.fr", FAKE_STRIPE_PRICES.premium);
    await t.database.query(`UPDATE candidate SET "interfaceLanguage" = 'en' WHERE id = $1`, [marie.id]);
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);

    expect(await reductions.run()).toMatchObject({ sent: 2, failed: 0 });
    expect(await reductions.run()).toMatchObject({ sent: 0 });

    expect(outbox.map((message) => message.to).sort()).toEqual(["marie.dupont@example.fr", "paul.martin@example.fr"]);
    const paul = outbox.find((message) => message.to === "paul.martin@example.fr")!;
    expect(paul.subject).toBe("Votre offre Standard change le 14 novembre 2026");
    expect(paul.text).toContain("Recherches d'offres");
    expect(paul.text).toContain("Aujourd'hui : 7 par semaine");
    expect(paul.text).toContain("À partir du 14 novembre 2026 : 3 par semaine");
    expect(paul.text).toContain(`Pourquoi : ${notice.reason}`);
    expect(paul.text).toContain("jusqu'au 14 décembre 2026 inclus");
    expect(paul.text).toContain("https://app.jobbbox.fr/abonnement/baisse");
    expect(outbox.find((message) => message.to === "marie.dupont@example.fr")!.subject).toBe("Your Standard plan changes on November 14, 2026");
  });

  it("a notice that could not be sent is sent on the next run", async () => {
    await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    let down = true;
    const flaky = createQuotaReductions(t.database, {
      billing: t.billing,
      mailer: { send: async (message) => (down ? Promise.reject(new Error("Brevo is down")) : void outbox.push(message)) },
      baseURL: "https://app.jobbbox.fr",
      now: () => t.clock.now,
    });

    expect(await flaky.run()).toMatchObject({ sent: 0, failed: 1 });
    down = false;
    expect(await flaky.run()).toMatchObject({ sent: 1, failed: 0 });
    expect(outbox).toHaveLength(1);
  });

  it("a subscriber who cancels within the window is refunded prorata and leaves the Plan; then it is closed to them", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    const jean = await t.signUp("jean.petit@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);

    expect(await reductions.openFor(jean.id)).toBeNull();
    expect(await reductions.openFor(marie.id)).toMatchObject({ plan: "standard", planName: { fr: "Standard" }, effectiveOn: IN_30_DAYS, resolvableUntil: "2026-12-14", reason: notice.reason });

    const resolved = await reductions.resolve(marie.id);

    expect(resolved).toEqual({ ok: true, refund: { amount: expect.any(Number), currency: "eur" }, refundPending: false });
    expect(t.stripe.refunds()).toEqual([expect.objectContaining({ amount: (resolved as { refund: { amount: number } }).refund.amount })]);
    expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
    expect(await reductions.openFor(marie.id)).toBeNull();
    expect(await reductions.resolve(marie.id)).toEqual({ ok: false, error: "not_open" });
    expect(await reductions.pending()).toMatchObject([{ resolved: 1, refundsPending: 0 }]);
    expect(await reductions.lastResolution(marie.id)).toEqual({ refund: { amount: (resolved as { refund: { amount: number } }).refund.amount, currency: "eur" }, refundPending: false, settled: false });
    expect(await reductions.lastResolution(jean.id)).toBeNull();
  });

  it("the right to cancel lasts until 30 days after the effective date", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);

    t.clock.now = new Date("2026-12-14T23:00:00+01:00");
    await reductions.run();
    expect(await reductions.openFor(marie.id)).toMatchObject({ effectiveOn: IN_30_DAYS });

    t.clock.now = new Date("2026-12-15T00:00:00+01:00");
    expect(await reductions.openFor(marie.id)).toBeNull();
  });

  it("a refund Stripe did not answer about is asked again by the worker, once made; one it refused is left to Support", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    t.stripe.refuseRefunds("rate_limit");

    expect(await reductions.resolve(marie.id)).toEqual({ ok: true, refund: null, refundPending: true });
    expect(await reductions.pending()).toMatchObject([{ resolved: 1, refundsPending: 1 }]);

    t.stripe.refuseRefunds(null);
    expect(await reductions.run()).toMatchObject({ refunds: 1 });
    expect(await reductions.run()).toMatchObject({ refunds: 0 });
    expect(t.stripe.refunds()).toHaveLength(1);
    expect(await reductions.pending()).toMatchObject([{ refundsPending: 0 }]);

    const paul = await subscriber("paul.martin@example.fr");
    await t.database.query("INSERT INTO plan_quota_reduction_notice (reduction_id, candidate_id) SELECT id, $1 FROM plan_quota_reduction", [paul.id]);
    t.stripe.refuseRefunds("charge_disputed");
    expect(await reductions.resolve(paul.id)).toEqual({ ok: true, refund: null, refundPending: true });
    t.stripe.refuseRefunds(null);
    expect(await reductions.run()).toMatchObject({ refunds: 0 });
    expect(await reductions.pending()).toMatchObject([{ resolved: 2, refundsPending: 1 }]);
  });

  it("a refund Stripe refused stays on Support's list after the reduction applies, naming the Stripe subscription; settled in Stripe, it leaves", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    // After the effective date, still inside the window, in a paid period that runs on.
    t.clock.now = new Date("2026-11-20T10:00:00+01:00");
    await reductions.run();
    t.stripe.payPeriod(marie.subscription, { amount: 999, start: new Date("2026-11-01T00:00:00+01:00"), end: new Date("2026-12-01T00:00:00+01:00") });
    t.stripe.refuseRefunds("charge_disputed");

    expect(await reductions.resolve(marie.id)).toEqual({ ok: true, refund: null, refundPending: true });
    t.stripe.refuseRefunds(null);
    await reductions.run();

    expect(await reductions.pending()).toEqual([]);
    expect(await reductions.refundsToSettle()).toEqual([
      // 11 of the 30 days of November paid for still to run: 999 × 11 / 30, rounded (the clock says 20 November, 10:00).
      {
        reductionId: expect.any(String),
        plan: "standard",
        subscriptionId: marie.subscription,
        failure: "charge_disputed",
        retried: false,
        resolvedAt: t.clock.now,
        due: { amount: Math.round((999 * (new Date("2026-12-01T00:00:00+01:00").getTime() - t.clock.now.getTime())) / (30 * 86_400_000)), currency: "eur" },
      },
    ]);
    expect(await reductions.lastResolution(marie.id)).toEqual({ refund: null, refundPending: true, settled: false });

    const [toSettle] = await reductions.refundsToSettle();
    expect(await reductions.settleRefund(toSettle!.reductionId, "sub_unknown", t.database)).toBeNull();
    expect(await reductions.settleRefund(toSettle!.reductionId, marie.subscription, t.database)).toMatchObject({ plan: "standard", failure: "charge_disputed" });
    expect(await reductions.settleRefund(toSettle!.reductionId, marie.subscription, t.database)).toBeNull();
    expect(await reductions.refundsToSettle()).toEqual([]);
    expect(await reductions.lastResolution(marie.id)).toEqual({ refund: null, refundPending: false, settled: true });
  });

  it("a refund Stripe did not answer about is listed as asked again, and cannot be settled by hand", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    t.stripe.refuseRefunds("rate_limit");
    await reductions.resolve(marie.id);

    const [retrying] = await reductions.refundsToSettle();
    expect(retrying).toMatchObject({ failure: "stripe_unavailable", retried: true });
    expect(await reductions.settleRefund(retrying!.reductionId, marie.subscription, t.database)).toBeNull();
  });

  it("a notice claimed by a worker that stopped before sending it is sent once its claim has lapsed", async () => {
    await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    // A worker claimed it and died.
    await t.database.query("UPDATE plan_quota_reduction_notice SET claimed_at = $1", [t.clock.now]);

    expect(await reductions.run()).toMatchObject({ sent: 0 });
    t.clock.now = new Date(t.clock.now.getTime() + 16 * 60_000);
    expect(await reductions.run()).toMatchObject({ sent: 1 });
    expect(await reductions.run()).toMatchObject({ sent: 0 });
    expect(outbox).toHaveLength(1);
  });

  it("sends every notice of a large Plan, a batch at a time", async () => {
    await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    // 119 more subscribers told, beside Marie.
    const others = Array.from({ length: 119 }, (_, index) => `abonne-${index}`);
    await t.database.query(
      `INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt")
       SELECT id, id, id || '@example.fr', true, 'fr', now(), now() FROM unnest($1::text[]) AS id`,
      [others],
    );
    await t.database.query("INSERT INTO plan_quota_reduction_notice (reduction_id, candidate_id) SELECT r.id, unnest($1::text[]) FROM plan_quota_reduction r", [others]);

    expect(await reductions.run()).toMatchObject({ sent: 120, failed: 0 });
    expect(new Set(outbox.map((message) => message.to)).size).toBe(120);
  });

  it("a quota a waiting reduction lowers cannot be changed until it is cancelled; the others can", async () => {
    await subscriber("marie.dupont@example.fr");
    await reductions.changeQuotas("standard", lower, notice, t.database, claire);

    expect(await reductions.changeQuotas("standard", { ...standard, jobSearches: 20 }, null, t.database, claire)).toEqual({ ok: false, error: "reduction_pending" });
    expect(await reductions.changeQuotas("standard", { ...standard, profiles: 5 }, null, t.database, claire)).toMatchObject({ ok: true, scheduled: null, applied: { profiles: 5, jobSearches: 7 } });
  });

  it("refuses a reason longer than 500 characters", async () => {
    await subscriber("marie.dupont@example.fr");

    expect(await reductions.changeQuotas("standard", lower, { ...notice, reason: "x".repeat(501) }, t.database, claire)).toEqual({ ok: false, error: "reason_too_long" });
    expect(await reductions.changeQuotas("standard", lower, { ...notice, reason: "x".repeat(500) }, t.database, claire)).toMatchObject({ ok: true });
  });

  it("an increase, and a reduction on Free, apply at once, as before", async () => {
    await subscriber("marie.dupont@example.fr");

    expect(await reductions.changeQuotas("standard", { ...standard, jobSearches: 10 }, null, t.database, claire)).toMatchObject({ ok: true, scheduled: null });
    expect(await reductions.changeQuotas("free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 0 }, null, t.database, claire)).toMatchObject({ ok: true, scheduled: null });

    expect(await t.billing.planQuotas()).toMatchObject({ standard: { jobSearches: 10 }, free: { matchScores: 0 } });
    expect(await reductions.pending()).toEqual([]);
  });

  it("a reduction on a paid Plan nobody pays for applies at once", async () => {
    expect(await reductions.changeQuotas("standard", lower, null, t.database, claire)).toMatchObject({ ok: true, scheduled: null });
    expect((await t.billing.planQuotas()).standard).toEqual(lower);
  });

  it("taking a Plan Feature off a Plan with subscribers waits for its date too", async () => {
    await subscriber("lea.bernard@example.fr", FAKE_STRIPE_PRICES.premium);

    expect(await reductions.removeFeatures("premium", ["coachingSessionDiscount"], null, t.database, claire)).toEqual({ ok: false, error: "notice_required" });
    expect(await reductions.removeFeatures("premium", ["coachingSessionDiscount"], notice, t.database, claire)).toMatchObject({ ok: true, scheduled: { removedFeatures: ["coachingSessionDiscount"] } });
    expect(await reductions.removeFeatures("standard", ["coachingSessionDiscount"], null, t.database, claire)).toEqual({ ok: true, scheduled: null });

    await reductions.run();
    expect(outbox[0]!.text).toContain("Séances de coaching à prix réduit");
    t.clock.now = new Date("2026-11-14T00:00:00+01:00");
    await reductions.run();
    expect((await t.billing.plans()).find((plan) => plan.key === "premium")!.features).toEqual([]);
  });

  it("cancelled before its date, it never applies, and notices not sent yet never are", async () => {
    const marie = await subscriber("marie.dupont@example.fr");
    const changed = await reductions.changeQuotas("standard", lower, notice, t.database, claire);
    const id = (changed as { scheduled: { id: string } }).scheduled.id;

    expect(await reductions.cancel(id, t.database)).toMatchObject({ id, plan: "standard", subscribers: 1 });
    expect(await reductions.cancel(id, t.database)).toBeNull();

    t.clock.now = new Date("2026-11-14T00:00:00+01:00");
    expect(await reductions.run()).toMatchObject({ applied: 0, sent: 0 });
    expect((await t.billing.planQuotas()).standard).toEqual(standard);
    expect(await reductions.openFor(marie.id)).toBeNull();
  });
});
