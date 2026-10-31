import type { LegalTextVersionRecord } from "@jobhub/help";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptancesOf, createAcceptances, migrateAcceptances } from "../acceptances";
import type { MailMessage } from "../auth";
import { checkoutSessionEvent, FAKE_STRIPE_COACHING_SESSION_PRICES, FAKE_STRIPE_PRICES, signedEvent } from "../billing/fake-stripe";
import { createBilling, type PaidCheckout } from "../billing";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createOrders, migrateOrders, ordersOf, type Orders } from "./index";

const CGV: LegalTextVersionRecord = { text: "cgv", version: "2026-10-01", url: "/legal/cgv/2026-10-01", sha256: "a".repeat(64), change: "substantielle" };
const COACH = { id: "8d0c6c4e-2f4f-4a51-9c39-0b7b2f1c9a10", name: "Claire Martin" };

/**
 * Orders (#512, C. conso. L221-5 9°, L221-13, L221-25, L221-28 1°; C. civ. 1127-1, 1127-2): the page before Stripe
 * Checkout, for a Plan or a Coaching Session. Its summary, the CGV box (shown, and required, only while a CGV version
 * is in effect) and the Immediate Performance Request; checked by the server before any Checkout Session is created,
 * written to the Acceptances; the Order Confirmation emailed once per payment Stripe's signed webhook confirms.
 */
describe.skipIf(!connectionString)("Orders (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let registry: LegalTextVersionRecord[];
  let sent: MailMessage[];
  let failMail: boolean;
  let orders: Orders;
  const secret = "test-secret-test-secret-test-secret-0123";

  beforeEach(async () => {
    sent = [];
    failMail = false;
    registry = [CGV];
    t = await startTestBilling();
    t.clock.now = new Date("2026-10-15T10:00:00+02:00");
    await migrateAcceptances(t.database);
    await migrateOrders(t.database);
    const now = () => t.clock.now;
    orders = createOrders(t.database, {
      billing: t.billing,
      coaches: { list: async () => [COACH] },
      acceptances: createAcceptances(t.database, { registry: () => registry, secret, now }),
      mailer: {
        send: async (message) => {
          if (failMail) throw new Error("Brevo is down");
          sent.push(message);
        },
      },
      baseURL: "https://app.jobbbox.fr",
      registry: () => registry,
      now,
    });
  }, 60_000);
  afterEach(async () => {
    await t.stop();
  }, 60_000);

  const ticked = { cgv: CGV.version, immediateExecution: "yes" };
  const checkoutCalls = () => t.stripe.callsTo("/v1/checkout/sessions");

  describe("the page's summary", () => {
    it("names a Plan with its price, all taxes included, how often it is charged, and the CGV version to accept", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.terms(marie.id, { kind: "plan", plan: "standard" })).toEqual({
        summary: { kind: "plan", subject: { fr: "Standard", en: "Standard" }, price: { amount: 1900, currency: "eur", interval: "month" } },
        cgv: CGV,
      });
    });

    it("names a Coaching Session with its Human Coach and the Candidate's Coaching Session Price", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.terms(marie.id, { kind: "coachingSession", coachId: COACH.id })).toEqual({
        summary: { kind: "coachingSession", subject: { fr: COACH.name, en: COACH.name }, price: { amount: 9000, currency: "eur", interval: null } },
        cgv: CGV,
      });
    });

    it("asks no CGV box while no CGV version is in effect", async () => {
      registry = [{ ...CGV, version: "2026-12-01" }];
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.terms(marie.id, { kind: "plan", plan: "standard" })).toMatchObject({ cgv: null });
    });

    it("has nothing to order for Free, an unknown Plan or an unknown Human Coach", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.terms(marie.id, { kind: "plan", plan: "free" })).toBeNull();
      expect(await orders.terms(marie.id, { kind: "plan", plan: "gold" })).toBeNull();
      expect(await orders.terms(marie.id, { kind: "coachingSession", coachId: "nope" })).toBeNull();
    });
  });

  describe("placing an Order", () => {
    it("creates no Checkout Session without the CGV box, while a CGV version is in effect", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.place(marie, { kind: "plan", plan: "standard" }, { immediateExecution: "yes" }, "fr")).toEqual({ ok: false, error: "cgv_required" });
      expect(await orders.place(marie, { kind: "coachingSession", coachId: COACH.id }, { cgv: "on" }, "fr")).toEqual({ ok: false, error: "cgv_required" });
      // The box of a version no longer the one in effect (the page was open while a new one took effect).
      expect(await orders.place(marie, { kind: "plan", plan: "standard" }, { cgv: "2026-01-01" }, "fr")).toEqual({ ok: false, error: "cgv_required" });

      expect(checkoutCalls()).toEqual([]);
      expect(await acceptancesOf(t.database, marie.id)).toEqual([]);
    });

    it("sends the Candidate to Checkout with the CGV accepted, writing the version, the Checkout Session and the Immediate Performance Request to the Acceptances", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      const placed = await orders.place(marie, { kind: "plan", plan: "standard" }, ticked, "fr");

      expect(placed).toEqual({ ok: true, url: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//) });
      const [checkout] = checkoutCalls();
      expect(checkout!.params.get("line_items[0][price]")).toBe(FAKE_STRIPE_PRICES.standard);
      const { rows } = await t.database.query("SELECT checkout_session_id, version, channel, immediate_execution_requested FROM legal_acceptance WHERE candidate_id = $1", [marie.id]);
      expect(rows).toEqual([{ checkout_session_id: expect.stringMatching(/^cs_fake/), version: CGV.version, channel: "paiement_plan", immediate_execution_requested: true }]);
    });

    it("goes on without the Immediate Performance Request, recorded as not asked", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      const placed = await orders.place(marie, { kind: "coachingSession", coachId: COACH.id }, { cgv: CGV.version }, "fr");

      expect(placed).toMatchObject({ ok: true });
      const [checkout] = checkoutCalls();
      expect(checkout!.params.get("line_items[0][price]")).toBe(FAKE_STRIPE_COACHING_SESSION_PRICES.regular);
      expect(checkout!.params.get("metadata[coach_id]")).toBe(COACH.id);
      expect(await acceptancesOf(t.database, marie.id)).toEqual([expect.objectContaining({ text: "cgv", version: CGV.version, channel: "paiement_coaching", immediateExecutionRequested: false })]);
    });

    it("goes to Checkout without any box while no CGV version is in effect, and keeps the Immediate Performance Request with the Order", async () => {
      registry = [];
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.place(marie, { kind: "plan", plan: "standard" }, { immediateExecution: "yes" }, "fr")).toMatchObject({ ok: true });

      expect(await acceptancesOf(t.database, marie.id)).toEqual([]);
      expect(await ordersOf(t.database, marie.id)).toEqual([
        { kind: "plan", subject: { fr: "Standard", en: "Standard" }, cgvVersion: null, immediateExecutionRequested: true, orderedAt: t.clock.now, confirmationSentAt: null },
      ]);
    });

    it("creates no Checkout Session for what cannot be ordered: a Human Coach who is not listed, a hidden or unknown Plan", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      expect(await orders.place(marie, { kind: "coachingSession", coachId: "8d0c6c4e-0000-4a51-9c39-0b7b2f1c9a10" }, ticked, "fr")).toEqual({ ok: false, error: "not_orderable" });
      expect(await orders.place(marie, { kind: "plan", plan: "gold" }, ticked, "fr")).toEqual({ ok: false, error: "not_orderable" });

      expect(checkoutCalls()).toEqual([]);
    });

    it("carries a shared link's code to Checkout", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const code = t.stripe.addPromotionCode("BIENVENUE");

      await orders.place(marie, { kind: "plan", plan: "standard", promotionCode: "BIENVENUE" }, ticked, "fr");

      expect(checkoutCalls()[0]!.params.get("discounts[0][promotion_code]")).toBe(code.id);
    });
  });

  describe("the Order Confirmation", () => {
    async function paidCheckout(candidateId: string, overrides: Partial<PaidCheckout> = {}): Promise<PaidCheckout> {
      const [checkout] = checkoutCalls().slice(-1);
      expect(checkout).toBeDefined();
      const { rows } = await t.database.query<{ checkout_session_id: string }>("SELECT checkout_session_id FROM checkout_order WHERE candidate_id = $1 ORDER BY ordered_at DESC LIMIT 1", [candidateId]);
      return { checkoutSessionId: rows[0]!.checkout_session_id, candidateId, mode: "subscription", subscriptionId: "sub_1", amount: 1900, currency: "eur", ...overrides };
    }

    it("is emailed once per payment Stripe's webhook confirms, with the summary, the CGV version accepted, the Immediate Performance Request and where to withdraw", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await orders.place(marie, { kind: "plan", plan: "standard" }, ticked, "fr");
      const paid = await paidCheckout(marie.id);

      await orders.paid(paid);
      await orders.paid(paid); // Stripe delivers an event more than once.

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: marie.email, subject: "Confirmation de votre commande : offre Standard" });
      const text = sent[0]!.text;
      expect(text).toContain("Offre Standard");
      expect(text).toMatch(/19,00\s€ TTC par mois/);
      expect(text).toContain("reconduit");
      expect(text).toContain("CGV (version du 01/10/2026)");
      expect(text).toContain("https://app.jobbbox.fr/legal/cgv/2026-10-01");
      expect(text).toContain("Vous avez demandé que le service commence immédiatement");
      expect(text).toContain("Renoncer au contrat ici");
      expect(text).toContain("https://app.jobbbox.fr/abonnement/retractation?contrat=plan");
      expect(text).toContain("29 octobre 2026"); // the last day of the Withdrawal period
      expect(await ordersOf(t.database, marie.id)).toEqual([expect.objectContaining({ confirmationSentAt: t.clock.now })]);
    });

    it("says, without the Immediate Performance Request, that a Withdrawal is refunded in full", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await orders.place(marie, { kind: "coachingSession", coachId: COACH.id }, { cgv: CGV.version }, "en");

      await orders.paid(await paidCheckout(marie.id, { mode: "payment", subscriptionId: null, amount: 9000 }));

      expect(sent).toHaveLength(1);
      expect(sent[0]!.subject).toBe(`Your order is confirmed: a coaching session with ${COACH.name}`);
      expect(sent[0]!.text).toContain("refunded in full");
      expect(sent[0]!.text).not.toContain("You asked for the service to start at once");
      expect(sent[0]!.text).toContain("https://app.jobbbox.fr/agenda");
    });

    it("leaves the CGV link out while no CGV version was accepted", async () => {
      registry = [];
      const marie = await t.signUp("marie.dupont@example.fr");
      await orders.place(marie, { kind: "plan", plan: "standard" }, { immediateExecution: "yes" }, "fr");

      await orders.paid(await paidCheckout(marie.id));

      expect(sent[0]!.text).not.toContain("CGV");
    });

    it("is sent again on Stripe's next delivery when the mailer failed, the webhook failing meanwhile", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await orders.place(marie, { kind: "plan", plan: "standard" }, ticked, "fr");
      const paid = await paidCheckout(marie.id);

      failMail = true;
      await expect(orders.paid(paid)).rejects.toThrow(/Brevo/);
      failMail = false;
      await orders.paid(paid);

      expect(sent).toHaveLength(1);
    });

    it("is not sent for a Checkout that was not ordered on the page", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");

      await orders.paid({ checkoutSessionId: "cs_elsewhere", candidateId: marie.id, mode: "subscription", subscriptionId: "sub_9", amount: 1900, currency: "eur" });

      expect(sent).toEqual([]);
    });

    it("is sent from Stripe's signed webhook, as the app wires it", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      const wired = createBilling({ ...t.config, onCheckoutPaid: (paid) => orders.paid(paid) });
      await orders.place(marie, { kind: "plan", plan: "standard" }, ticked, "fr");
      const { checkoutSessionId } = await paidCheckout(marie.id);
      const { payload, signature } = signedEvent(
        checkoutSessionEvent("checkout.session.completed", { id: checkoutSessionId, candidateId: marie.id, amount: 1900, currency: "eur", paymentStatus: "paid", mode: "subscription", subscription: "sub_1" }),
      );

      await wired.handleStripeWebhook(payload, signature);
      await wired.handleStripeWebhook(payload, signature);

      expect(sent).toHaveLength(1);
      expect(await orders.immediateExecutionRequested({ subscriptionId: "sub_1" })).toBe(true);
    });
  });

  describe("the Immediate Performance Request, for a Withdrawal", () => {
    it("is found by the subscription a Plan's Order started, or the Checkout Session of a Coaching Session's", async () => {
      const marie = await t.signUp("marie.dupont@example.fr");
      await orders.place(marie, { kind: "plan", plan: "standard" }, ticked, "fr");
      const plan = (await t.database.query<{ checkout_session_id: string }>("SELECT checkout_session_id FROM checkout_order")).rows[0]!.checkout_session_id;
      await orders.paid({ checkoutSessionId: plan, candidateId: marie.id, mode: "subscription", subscriptionId: "sub_1", amount: 1900, currency: "eur" });
      await orders.place(marie, { kind: "coachingSession", coachId: COACH.id }, { cgv: CGV.version }, "fr");
      const session = (await t.database.query<{ checkout_session_id: string }>("SELECT checkout_session_id FROM checkout_order WHERE kind = 'coaching_session'")).rows[0]!.checkout_session_id;

      expect(await orders.immediateExecutionRequested({ subscriptionId: "sub_1" })).toBe(true);
      expect(await orders.immediateExecutionRequested({ checkoutSessionId: session })).toBe(false);
      // Bought before the page existed: nothing was asked, so nothing was requested.
      expect(await orders.immediateExecutionRequested({ subscriptionId: "sub_older" })).toBe(false);
    });
  });
});
