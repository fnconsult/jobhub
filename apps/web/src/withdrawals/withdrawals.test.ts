import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import type { MailMessage } from "../auth";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../billing/fake-stripe";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoaches } from "../human-coaches";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { createAcceptances, migrateAcceptances } from "../acceptances";
import { createOrders, migrateOrders, type Orders } from "../orders";
import { createWithdrawals, migrateWithdrawals, withdrawalsOf, type Withdrawals } from "./index";

/** An instant in French time, written without an offset: summer time until 25 October 2026, winter time after. */
const paris = (wallClock: string) => new Date(`${wallClock}:00${wallClock < "2026-10-25T03:00" ? "+02:00" : "+01:00"}`);

/**
 * Withdrawals (#511, C. conso. L221-18 and following): « Renoncer au contrat ici » for 14 days after a Plan's
 * subscription or a Coaching Session's payment; « Confirmer la rétractation » ends the contract, refunds it in full
 * through Stripe (the fake one) and acknowledges it by email; the Back Office follows refunds that fail.
 */
describe.skipIf(!connectionString)("Withdrawals (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let coaches: HumanCoaches;
  let withdrawals: Withdrawals;
  let orders: Orders;
  let sent: MailMessage[];

  beforeEach(async () => {
    sent = [];
    // The webhook tells Withdrawals of refunds, as the app wires it.
    t = await startTestBilling({ onRefundChanged: (change) => withdrawals.refundChanged(change) });
    t.clock.now = paris("2026-10-15T10:00");
    await migrateProfiles(t.database);
    await migrateJobOffers(t.database);
    await migrateApplications(t.database);
    await migrateHumanCoaches(t.database);
    await migrateWithdrawals(t.database);
    await migrateAcceptances(t.database);
    await migrateOrders(t.database);
    const profiles = createProfiles(t.database);
    const applications = createApplications(t.database, { jobOffers: createJobOffers(t.database), profiles });
    const now = () => t.clock.now;
    coaches = createHumanCoaches(t.database, { profiles, applications, tailoredDocuments: { get: async () => null }, tailoredCvs: { get: async () => null }, now });
    // The page before Checkout (#512), with no CGV version in effect: only the Immediate Performance Request is asked.
    orders = createOrders(t.database, {
      billing: t.billing,
      coaches,
      acceptances: createAcceptances(t.database, { registry: () => [], secret: "test-secret-test-secret-test-secret-0123", now }),
      mailer: { send: async () => {} },
      baseURL: "https://app.jobbbox.fr",
      registry: () => [],
      now,
    });
    withdrawals = createWithdrawals(t.database, {
      billing: t.billing,
      humanCoaches: coaches,
      orders,
      mailer: { send: async (message) => void sent.push(message) },
      baseURL: "https://app.jobbbox.fr",
      now,
    });
  }, 60_000);
  afterEach(async () => {
    await t.stop();
  }, 60_000);

  async function deliver(event: unknown) {
    const { payload, signature } = signedEvent(event);
    await t.billing.handleStripeWebhook(payload, signature);
  }

  /** Marie, on Standard since `startedAt`, having paid 19 € for it (`amount`: 0 for a 100 % code). */
  async function subscribedMarie(startedAt: Date, amount = 1900) {
    const marie = await t.signUp("marie.dupont@example.fr");
    await t.billing.startCheckout(marie, "standard");
    const customer = fakeCustomerId(marie.email);
    await deliver(subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.standard, status: "active", startDate: startedAt }, startedAt));
    const paymentIntent = t.stripe.payInvoice(`sub_fake_${customer}`, amount);
    return { ...marie, customer, paymentIntent };
  }

  /**
   * Marie, on Standard since `startedAt` through the Order page (#512), with the Immediate Performance Request or not,
   * having paid 19 € for the month from `startedAt`.
   */
  async function orderedMarie(startedAt: Date, immediateExecution: boolean) {
    const marie = await t.signUp("marie.dupont@example.fr");
    const placed = await orders.place(marie, { kind: "plan", plan: "standard" }, immediateExecution ? { immediateExecution: "yes" } : {}, "fr");
    if (!placed.ok) throw new Error("fixture refused");
    const customer = fakeCustomerId(marie.email);
    const subscriptionId = `sub_fake_${customer}`;
    const { rows } = await t.database.query<{ checkout_session_id: string }>("SELECT checkout_session_id FROM checkout_order WHERE candidate_id = $1", [marie.id]);
    await deliver(subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.standard, status: "active", startDate: startedAt }, startedAt));
    await orders.paid({ checkoutSessionId: rows[0]!.checkout_session_id, candidateId: marie.id, mode: "subscription", subscriptionId, amount: 1900, currency: "eur" });
    const end = new Date(startedAt);
    end.setMonth(end.getMonth() + 1);
    const paymentIntent = t.stripe.payInvoice(subscriptionId, 1900, { start: startedAt, end });
    return { ...marie, customer, paymentIntent };
  }

  const confirm = { contract: "plan", name: "Marie Dupont", receipt: "account" };

  describe("from a Plan", () => {
    it("is offered to a Candidate subscribed 3 days ago, and no more on the 15th day", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));

      expect(await withdrawals.contracts(marie.id)).toEqual([
        { ref: "plan", kind: "plan", subject: { fr: "Standard", en: "Standard" }, concludedAt: paris("2026-10-12T10:00"), deadline: paris("2026-10-27T00:00"), paid: null },
      ]);

      t.clock.now = paris("2026-10-27T00:00");
      expect(await withdrawals.contracts(marie.id)).toEqual([]);
    });

    it("is not offered on Free", async () => {
      const paul = await t.signUp("paul.martin@example.fr");

      expect(await withdrawals.contracts(paul.id)).toEqual([]);
    });

    it("names the contract with what was paid for it, on the form", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));

      expect(await withdrawals.contract(marie.id, "plan")).toMatchObject({ ref: "plan", subject: { fr: "Standard" }, paid: { amount: 1900, currency: "eur" } });
      expect(await withdrawals.contract(marie.id, "coaching-session:nope")).toBeNull();
    });

    it("« Confirmer la rétractation » ends the subscription at once, refunds it in full, puts the Candidate on Free and sends the acknowledgement with the date and time", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));

      const result = await withdrawals.withdraw(marie, confirm, "fr");

      expect(result).toMatchObject({
        ok: true,
        withdrawal: {
          contract: "plan",
          subject: { fr: "Standard" },
          name: "Marie Dupont",
          receiptEmail: marie.email,
          withdrawnAt: paris("2026-10-15T10:00"),
          refunds: [{ amount: 1900, currency: "eur", status: "succeeded", failureReason: null }],
        },
      });
      expect(t.stripe.callsTo(`/v1/subscriptions/sub_fake_${marie.customer}`)).toEqual([expect.objectContaining({ method: "DELETE" })]);
      expect(t.stripe.refunds()).toEqual([expect.objectContaining({ payment_intent: marie.paymentIntent, amount: 1900, status: "succeeded" })]);
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: marie.email, subject: "Accusé de réception de votre rétractation" });
      expect(sent[0]!.text).toContain("15 octobre 2026 à 10:00");
      expect(sent[0]!.text).toContain("Standard");
      expect(sent[0]!.text).toContain("Marie Dupont");
      expect(sent[0]!.text).toMatch(/Montant remboursé : 19,00\s€/);
      expect(sent[0]!.html).toContain("15 octobre 2026 à 10:00");
      expect(await withdrawals.contracts(marie.id)).toEqual([]);
    });

    it("refunds a Plan ordered with the Immediate Performance Request the amount paid less the share of the days elapsed since the start of its period (#512)", async () => {
      // 12 October to 12 November: 31 days, 3 of them elapsed on the 15th.
      const marie = await orderedMarie(paris("2026-10-12T10:00"), true);

      expect(await withdrawals.contract(marie.id, "plan")).toMatchObject({ paid: { amount: 1900 }, refund: { amount: 1716, currency: "eur" }, immediateExecutionRequested: true });
      const result = await withdrawals.withdraw(marie, confirm, "fr");

      expect(result).toMatchObject({ ok: true, withdrawal: { refunds: [{ amount: 1716, kept: 184, status: "succeeded" }] } });
      expect(t.stripe.refunds()).toEqual([expect.objectContaining({ payment_intent: marie.paymentIntent, amount: 1716 })]);
      expect(sent[0]!.text).toMatch(/Montant remboursé : 17,16\s€/);
      expect(sent[0]!.text).toMatch(/service déjà fourni.*1,84\s€/);
    });

    it("refunds a Plan ordered without the Immediate Performance Request in full (#512)", async () => {
      const marie = await orderedMarie(paris("2026-10-12T10:00"), false);

      expect(await withdrawals.contract(marie.id, "plan")).toMatchObject({ refund: { amount: 1900 }, immediateExecutionRequested: false });
      expect(await withdrawals.withdraw(marie, confirm, "fr")).toMatchObject({ ok: true, withdrawal: { refunds: [{ amount: 1900, kept: 0 }] } });
      expect(t.stripe.callsTo("/v1/refunds")[0]!.params.has("amount")).toBe(false);
    });

    it("sends the acknowledgement to another address when the Candidate asks", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));

      await withdrawals.withdraw(marie, { ...confirm, receipt: "other", receiptEmail: " Marie.Perso@Example.org " }, "en");

      expect(sent.map((message) => message.to)).toEqual(["marie.perso@example.org"]);
      expect(sent[0]!.subject).toBe("Acknowledgement of your withdrawal");
    });

    it("records a withdrawal with nothing to refund when a 100 % code made the Plan free", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"), 0);

      const result = await withdrawals.withdraw(marie, confirm, "fr");

      expect(result).toMatchObject({ ok: true, withdrawal: { refunds: [] } });
      expect(t.stripe.refunds()).toEqual([]);
      expect((await t.billing.entitlements(marie.id)).plan).toBe("free");
      expect(sent[0]!.text).toContain("Rien à rembourser");
    });

    it("withdraws once when « Confirmer la rétractation » is clicked twice", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));

      const results = await Promise.all([withdrawals.withdraw(marie, confirm, "fr"), withdrawals.withdraw(marie, confirm, "fr")]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(t.stripe.refunds()).toHaveLength(1);
      expect(await withdrawals.list()).toHaveLength(1);
    });

    it("refuses a form without a name or with a bad address, and a contract that cannot be withdrawn from", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));

      expect(await withdrawals.withdraw(marie, { ...confirm, name: " " }, "fr")).toEqual({ ok: false, errors: [{ field: "name", code: "required" }] });
      expect(await withdrawals.withdraw(marie, { ...confirm, receipt: "other", receiptEmail: "pas-une-adresse" }, "fr")).toEqual({ ok: false, errors: [{ field: "receiptEmail", code: "invalid" }] });
      t.clock.now = paris("2026-10-28T10:00");
      expect(await withdrawals.withdraw(marie, confirm, "fr")).toEqual({ ok: false, error: "not_withdrawable" });
      expect(t.stripe.refunds()).toEqual([]);
      expect(sent).toEqual([]);
    });

    it("records nothing when Stripe cannot cancel the subscription: the Candidate can try again", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));
      t.stripe.stopAnswering();

      expect(await withdrawals.withdraw(marie, confirm, "fr")).toEqual({ ok: false, error: "stripe_unavailable" });
      expect(await withdrawals.list()).toEqual([]);
    }, 30_000);
  });

  describe("from a Coaching Session", () => {
    /** Marie's Coaching Session with Sophie, paid 90 € at `paidAt`. */
    async function paidSession(paidAt: Date) {
      const marie = await t.signUp("marie.dupont@example.fr");
      const added = await coaches.add({ name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance" });
      if (!added.ok) throw new Error("fixture refused");
      await coaches.recordPaidSession({ checkoutSessionId: "cs_session_1", candidateId: marie.id, coachId: added.coach.id, amount: 9000, currency: "eur" });
      const [session] = await coaches.sessions(marie.id);
      await t.database.query("UPDATE coaching_session SET paid_at = $2 WHERE id = $1", [session!.id, paidAt]);
      const paymentIntent = t.stripe.payCheckoutSession("cs_session_1", 9000);
      return { marie, sessionId: session!.id, paymentIntent };
    }

    it("is offered for a paid session not held yet, within 14 days of its payment", async () => {
      const { marie, sessionId } = await paidSession(paris("2026-10-13T09:00"));

      expect(await withdrawals.contracts(marie.id)).toEqual([
        {
          ref: `coaching-session:${sessionId}`,
          kind: "coachingSession",
          sessionId,
          subject: { fr: "Sophie Martin", en: "Sophie Martin" },
          concludedAt: paris("2026-10-13T09:00"),
          deadline: paris("2026-10-28T00:00"),
          paid: { amount: 9000, currency: "eur" },
        },
      ]);

      // Held, bought without the Immediate Performance Request: still withdrawable, refunded in full (#512).
      await coaches.scheduleSession(marie.id, sessionId, { scheduledAt: "2026-10-15T09:30" });
      expect(await withdrawals.contracts(marie.id)).toMatchObject([{ ref: `coaching-session:${sessionId}` }]);
    });

    describe("bought on the Order page (#512)", () => {
      /** Marie's Coaching Session with Sophie, ordered on the page (with the Immediate Performance Request or not) and paid 90 €. */
      async function orderedSession(immediateExecution: boolean) {
        const marie = await t.signUp("marie.dupont@example.fr");
        const added = await coaches.add({ name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance" });
        if (!added.ok) throw new Error("fixture refused");
        await orders.place(marie, { kind: "coachingSession", coachId: added.coach.id }, immediateExecution ? { immediateExecution: "yes" } : {}, "fr");
        const { rows } = await t.database.query<{ checkout_session_id: string }>("SELECT checkout_session_id FROM checkout_order WHERE candidate_id = $1", [marie.id]);
        const checkoutSessionId = rows[0]!.checkout_session_id;
        await coaches.recordPaidSession({ checkoutSessionId, candidateId: marie.id, coachId: added.coach.id, amount: 9000, currency: "eur" });
        const paymentIntent = t.stripe.payCheckoutSession(checkoutSessionId, 9000);
        const [session] = await coaches.sessions(marie.id);
        await t.database.query("UPDATE coaching_session SET paid_at = $2 WHERE id = $1", [session!.id, paris("2026-10-13T09:00")]);
        return { marie, sessionId: session!.id, paymentIntent };
      }

      it("is no longer withdrawable once held, with the Immediate Performance Request", async () => {
        const { marie, sessionId } = await orderedSession(true);
        expect(await orders.immediateExecutionRequested({ coachingSessionId: sessionId })).toBe(true);
        expect(await withdrawals.contracts(marie.id)).toHaveLength(1);

        await coaches.scheduleSession(marie.id, sessionId, { scheduledAt: "2026-10-15T09:30" });

        expect(await withdrawals.contracts(marie.id)).toEqual([]);
        expect(await withdrawals.withdraw(marie, { contract: `coaching-session:${sessionId}`, name: "Marie Dupont", receipt: "account" }, "fr")).toEqual({ ok: false, error: "not_withdrawable" });
      });

      it("is refunded in full once held, without the Immediate Performance Request, and keeps its date", async () => {
        const { marie, sessionId, paymentIntent } = await orderedSession(false);
        expect(await orders.immediateExecutionRequested({ coachingSessionId: sessionId })).toBe(false);
        await coaches.scheduleSession(marie.id, sessionId, { scheduledAt: "2026-10-15T09:30" });

        const result = await withdrawals.withdraw(marie, { contract: `coaching-session:${sessionId}`, name: "Marie Dupont", receipt: "account" }, "fr");

        expect(result).toMatchObject({ ok: true, withdrawal: { refunds: [{ amount: 9000, kept: 0 }] } });
        expect(t.stripe.refunds()).toEqual([expect.objectContaining({ payment_intent: paymentIntent, amount: 9000 })]);
        const { rows } = await t.database.query("SELECT scheduled_at, withdrawn_at FROM coaching_session WHERE id = $1", [sessionId]);
        expect(rows[0]).toEqual({ scheduled_at: paris("2026-10-15T09:30"), withdrawn_at: paris("2026-10-15T10:00") });
        const toCoach = sent.find((message) => message.to === "sophie.martin@rh-conseil.fr")!;
        expect(toCoach.text).toContain("a eu lieu le 15 octobre 2026 à 09:30");
      });

      it("is refunded in full before it is held, with the Immediate Performance Request", async () => {
        const { marie, sessionId } = await orderedSession(true);

        expect(await withdrawals.withdraw(marie, { contract: `coaching-session:${sessionId}`, name: "Marie Dupont", receipt: "account" }, "fr")).toMatchObject({
          ok: true,
          withdrawal: { refunds: [{ amount: 9000, kept: 0 }] },
        });
      });
    });

    it("refunds a paid session not held yet in full, cancels it from the Agenda and tells the Human Coach", async () => {
      const { marie, sessionId, paymentIntent } = await paidSession(paris("2026-10-13T09:00"));
      await coaches.scheduleSession(marie.id, sessionId, { scheduledAt: "2026-10-20T14:00" });

      const result = await withdrawals.withdraw(marie, { contract: `coaching-session:${sessionId}`, name: "Marie Dupont", receipt: "account" }, "fr");

      expect(result).toMatchObject({ ok: true, withdrawal: { contract: "coachingSession", subject: { fr: "Sophie Martin" }, refunds: [{ amount: 9000, status: "succeeded" }] } });
      expect(t.stripe.refunds()).toEqual([expect.objectContaining({ payment_intent: paymentIntent, amount: 9000 })]);
      expect(await coaches.sessions(marie.id)).toEqual([]);
      expect(sent.map((message) => message.to).sort()).toEqual([marie.email, "sophie.martin@rh-conseil.fr"].sort());
      const toCoach = sent.find((message) => message.to === "sophie.martin@rh-conseil.fr")!;
      expect(toCoach.text).toContain("20 octobre 2026 à 14:00");
    });
  });

  describe("refunds that fail, in the Back Office", () => {
    it("lists a refund Stripe refused, which Support can try again", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));
      t.stripe.refuseRefunds("insufficient_funds");

      const result = await withdrawals.withdraw(marie, confirm, "fr");

      // The Candidate gets the acknowledgement whatever happens.
      expect(result).toMatchObject({ ok: true, withdrawal: { refunds: [{ status: "failed", failureReason: "insufficient_funds" }] } });
      expect(sent).toHaveLength(1);
      const [listed] = await withdrawals.list();
      expect(listed).toMatchObject({ candidateEmail: marie.email, contract: "plan", refunds: [{ amount: 1900, status: "failed", failureReason: "insufficient_funds", attempts: 1 }] });

      t.stripe.refuseRefunds(null);
      expect(await withdrawals.retryRefund(listed!.refunds[0]!.id)).toEqual({ ok: true, status: "succeeded" });

      expect((await withdrawals.list())[0]!.refunds).toMatchObject([{ status: "succeeded", failureReason: null, attempts: 2 }]);
      expect(t.stripe.refunds()).toHaveLength(1);
    });

    it("lists a refund Stripe reports failed days later, which can be tried again", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));
      await withdrawals.withdraw(marie, confirm, "fr");
      const [refund] = t.stripe.refunds();

      await deliver(t.stripe.failRefund(refund!.id, "expired_or_canceled_card"));

      const [listed] = await withdrawals.list();
      expect(listed!.refunds).toMatchObject([{ status: "failed", failureReason: "expired_or_canceled_card" }]);
      expect(await withdrawals.retryRefund(listed!.refunds[0]!.id)).toEqual({ ok: true, status: "succeeded" });
      expect(t.stripe.refunds().map((each) => each.status)).toEqual(["failed", "succeeded"]);
    });

    it("tries again only a refund that failed", async () => {
      const marie = await subscribedMarie(paris("2026-10-12T10:00"));
      await withdrawals.withdraw(marie, confirm, "fr");
      const [listed] = await withdrawals.list();

      expect(await withdrawals.retryRefund(listed!.refunds[0]!.id)).toEqual({ ok: false, error: "not_failed" });
      expect(await withdrawals.retryRefund("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "not_found" });
      expect(await withdrawals.retryRefund("nope")).toEqual({ ok: false, error: "not_found" });
    });
  });

  it("are the Candidate's own data: in their Data export, and deleted with their account", async () => {
    const marie = await subscribedMarie(paris("2026-10-12T10:00"));
    await withdrawals.withdraw(marie, confirm, "fr");

    const exported = await withdrawalsOf(t.database, marie.id);
    expect(exported).toEqual([
      {
        contract: "plan",
        subject: { fr: "Standard", en: "Standard" },
        concludedAt: paris("2026-10-12T10:00"),
        withdrawnAt: paris("2026-10-15T10:00"),
        name: "Marie Dupont",
        receiptEmail: marie.email,
        receiptSentAt: paris("2026-10-15T10:00"),
        refunds: [{ amount: 1900, currency: "eur", status: "succeeded" }],
      },
    ]);
    expect(JSON.stringify(exported)).not.toMatch(/sub_|pi_|re_|cs_/);

    await t.database.query("DELETE FROM candidate WHERE id = $1", [marie.id]);
    expect(await withdrawals.list()).toEqual([]);
  });
});
