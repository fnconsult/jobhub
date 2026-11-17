/**
 * #887's acceptance: the DAC7 export of a test year matches the payouts of #878. A year of one Seller's sales goes through
 * Stripe Connect (the real SDK over the fake Stripe): Checkout, Withdrawals' refunds, a Coaching Offer sold by Jobbbox with its
 * compensation, and the monthly payouts. The year is then prepared, read back from that same Stripe.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeStripe, FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET } from "../billing/fake-stripe";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingOffers, JOBBBOX_SELLER } from "../coaching-offers";
import { createHumanCoaches } from "../human-coaches";
import { createProfiles } from "../profiles";
import { createApplications } from "../applications";
import { createJobOffers } from "../job-offers";
import { coachingConnect } from "../coaching-connect";
import { earningLine } from "../coaching-connect/earnings";
import { stripeConnect } from "../coaching-connect/stripe";
import { secretCipherFromEnv } from "../provider-secrets/cipher";
import { coachingTaxes } from "./index";
import { stripeTaxFacts, stripeTaxTransfers } from "./stripe";
import { taxXml } from "./xml";
import type { TaxQuarter } from "./model";

const SIRET = "12345678901234";
const KEY = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=";
const OPERATOR = { legalName: "Test platform", tin: "123456789", platformName: "Jobbbox test", street: "1 rue Exemple", postalCode: "75001", city: "Paris" };
const IDENTITY = {
  kind: "individual",
  legalName: "Coach Business",
  firstName: "Test",
  lastName: "Coach",
  birthDate: "1980-01-01",
  residence: "FR",
  tin: SIRET,
  tinCountry: "FR",
  siret: SIRET,
  street: "1 rue Exemple",
  postalCode: "75001",
  city: "Paris",
  addressCountry: "FR",
  iban: "FR7630006000011234567890189",
  accountHolder: "Test Coach",
};
/** The calendar quarter of a date in French time, as DAC7 counts it. */
const quarterOf = (date: Date) => Math.ceil(Number(date.toLocaleString("en-CA", { timeZone: "Europe/Paris", month: "numeric" })) / 3);

describe.skipIf(!connectionString)("DAC7 export of a test year against the Seller payouts (#878)", () => {
  let auth: TestAuth, fake: Awaited<ReturnType<typeof startFakeStripe>>, clock: Date;
  let sellerId: string, accountId: string, ownerId: string;
  let offers: ReturnType<typeof coachingOffers>, connect: ReturnType<typeof coachingConnect>, sale: (iso: string, account: string | null) => Promise<string>;
  let sellByJobbbox: () => Promise<void>, sellByCoach: () => Promise<void>;
  /** Moves the clock of Jobbbox and of the fake Stripe together. */
  async function at(iso: string) {
    clock = new Date(iso);
    await fetch(`${fake.url}/__connect/clock`, { method: "POST", body: new URLSearchParams({ at: iso }) });
  }
  async function monthly(iso: string) {
    await at(iso);
    await connect.runMonthly();
  }
  /** A Withdrawal refunded by Stripe on the Seller's account, with its Commission in proportion. */
  async function refund(iso: string, paymentIntent: string, amount: number) {
    await at(iso);
    await fetch(`${fake.url}/v1/refunds`, {
      method: "POST",
      headers: { "stripe-account": accountId },
      body: new URLSearchParams({ payment_intent: paymentIntent, amount: String(amount), refund_application_fee: "true" }),
    });
  }
  /** The Back Office prepares the year on 15 January, once the Seller entered their fiscal identity in « Revenus ». */
  async function prepare(year: number) {
    await at(`${year + 1}-01-15T12:00Z`);
    const taxes = coachingTaxes(auth.database, {
      cipher: secretCipherFromEnv({ SECRETS_MASTER_KEYS: KEY }),
      permitted: async () => true,
      now: () => clock,
      facts: stripeTaxFacts({ secretKey: FAKE_STRIPE_SECRET_KEY, apiUrl: fake.url }),
      platformFacts: stripeTaxTransfers({ secretKey: FAKE_STRIPE_SECRET_KEY, apiUrl: fake.url }),
    });
    expect(await taxes.saveIdentity(ownerId, sellerId, year, IDENTITY)).toBe(true);
    const { document } = await taxes.prepare(year, OPERATOR, ownerId);
    expect(document.sellers.map((seller) => seller.sellerId)).toEqual([sellerId]);
    return document;
  }
  /** What #878 paid: its payouts, and what each sale earned the Seller as Coach Earnings show it. */
  async function payouts() {
    const batches = (
      await auth.database.query<{ amount: number; paidAt: Date }>(
        `SELECT amount,paid_at AS "paidAt" FROM coaching_connect_batch WHERE seller_id=$1 AND state='paid' ORDER BY paid_at`,
        [sellerId],
      )
    ).rows;
    return { batches, earnings: (await connect.earnings(sellerId)).map(earningLine) };
  }
  /** Each quarter of the export against the payouts: bank payouts by their date, income by the date of the sale it was credited for. */
  function expectMatches(quarters: TaxQuarter[], { batches, earnings }: Awaited<ReturnType<typeof payouts>>) {
    for (const quarter of quarters) {
      expect(quarter.bankPayouts).toBe(batches.filter((batch) => quarterOf(batch.paidAt) === quarter.quarter).reduce((sum, b) => sum + b.amount, 0));
      const credited = earnings.filter((line) => quarterOf(line.paidAt) === quarter.quarter);
      expect(quarter.activities).toBe(credited.length);
      expect(quarter.consideration).toBe(credited.reduce((sum, line) => sum + line.net, 0));
      expect(quarter.fees).toBe(credited.reduce((sum, line) => sum + line.commission - line.refundedCommission, 0));
    }
    // Everything credited is either paid out or still due to the Seller (a negative due is recovered from a later payout), never twice.
    expect(quarters.reduce((sum, q) => sum + q.consideration, 0)).toBe(
      batches.reduce((sum, b) => sum + b.amount, 0) + earnings.reduce((sum, line) => sum + line.due, 0),
    );
  }

  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    fake = await startFakeStripe();
    await at("2026-01-05T12:00Z");
    const person = async (email: string) =>
      (await (await auth.request("/api/auth/get-session", { cookie: await signInWithMagicLink(auth, email) })).json()).user as { id: string; email: string };
    const candidate = await person("dac7-buyer@example.test");
    ownerId = (await person("dac7-coach@example.test")).id;
    const coachId = (
      await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('DAC7 Coach','dac7-coach@example.test','') RETURNING id")
    ).rows[0].id as string;
    offers = coachingOffers(auth.database, { price: async () => ({ amount: 10000, currency: "eur" }), eligibleSeller: async () => true });
    sellerId = (await offers.saveSeller({ kind: "human_coach", coachId, name: "Coach Business", status: "EI", siret: SIRET, commissionBps: 2000 }))!.id;
    await offers.saveOffer({ coachId, sellerId, durationMinutes: 60, amount: 10000 });
    const stripe = stripeConnect({ secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: fake.url, now: () => clock });
    const profiles = createProfiles(auth.database),
      humans = createHumanCoaches(auth.database, {
        profiles,
        applications: createApplications(auth.database, { profiles, jobOffers: createJobOffers(auth.database) }),
        tailoredDocuments: { get: async () => null },
        tailoredCvs: { get: async () => null },
      });
    connect = coachingConnect(auth.database, {
      stripe,
      baseURL: "http://localhost:3000",
      now: () => clock,
      permitted: async () => true,
      maySell: async () => true,
      recordPaid: (paid, financials) => humans.recordPaidSession(paid, financials),
      attachSale: (paid, within) => offers.attachPaid(paid, within),
      confirmOrder: async () => undefined,
    });
    await connect.onboarding(sellerId, "/espace-coach/revenus", ownerId);
    accountId = (await auth.database.query("SELECT account_id FROM coaching_connect_account WHERE seller_id=$1", [sellerId])).rows[0].account_id;
    await fetch(`${fake.url}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: accountId }) });
    // A Candidate buys the coach's current Coaching Offer and Stripe's signed webhook records it; returns its PaymentIntent.
    sale = async (iso, account) => {
      await at(iso);
      const started = (await connect.startCheckout(candidate, (await offers.quote(candidate.id, coachId))!.id, "fr", {
        success: "http://localhost/coachs",
        cancel: "http://localhost/coachs",
      }))!;
      await fetch(`${fake.url}/__connect/pay`, { method: "POST", body: new URLSearchParams({ session: started.checkoutSessionId }) });
      const session = (await stripe.readCheckout(started.checkoutSessionId, account))!;
      expect(await connect.paid(session, account)).toBe(true);
      return session.paymentIntent!;
    };
    // Jobbbox sells the coach's offer; the coach's share (60 %) is owed to their business and transferred to its account.
    sellByJobbbox = async () => {
      await offers.saveOffer({ coachId, sellerId: JOBBBOX_SELLER.id, durationMinutes: 60, amount: null });
      expect(await offers.compensation(coachId, 6000, sellerId)).toBe(true);
    };
    sellByCoach = async () => {
      await offers.saveOffer({ coachId, sellerId, durationMinutes: 60, amount: 10000 });
    };
  }, 60000);
  afterEach(async () => {
    await fake.stop();
    await auth.stop();
  }, 60000);

  it("reports per quarter what the year credited the Seller, and the bank payouts apart, as the payouts and Coach Earnings show them", async () => {
    // Q1: a third-party sale, paid out on 1 March once its Withdrawal period is over.
    await sale("2026-02-10T10:00Z", accountId);
    await monthly("2026-03-01T12:00Z");
    // Q2: a sale half refunded (a Withdrawal) before its payout on 1 July.
    await refund("2026-05-25T10:00Z", await sale("2026-05-20T10:00Z", accountId), 5000);
    await monthly("2026-06-01T12:00Z");
    await monthly("2026-07-01T12:00Z");
    // Q3: a Coaching Offer sold by Jobbbox: the coach's share transferred, then paid out on 1 September.
    await sellByJobbbox();
    await sale("2026-08-10T10:00Z", null);
    await monthly("2026-09-01T12:00Z");
    // Q4: a sale credited in December whose payout falls in 2027: income of 2026, remittance of 2027.
    await sellByCoach();
    await sale("2026-12-20T10:00Z", accountId);
    await monthly("2027-01-01T12:00Z");

    const document = await prepare(2026),
      paid = await payouts();
    expect(paid.batches.map((batch) => batch.amount)).toEqual([8000, 4000, 6000]);
    expectMatches(document.sellers[0]!.quarters, paid);
    expect(document.sellers[0]!.quarters).toEqual([
      { quarter: 1, consideration: 8000, fees: 2000, taxes: 0, activities: 1, bankPayouts: 8000 },
      { quarter: 2, consideration: 4000, fees: 1000, taxes: 0, activities: 1, bankPayouts: 0 },
      { quarter: 3, consideration: 6000, fees: 0, taxes: 0, activities: 1, bankPayouts: 10000 },
      { quarter: 4, consideration: 8000, fees: 2000, taxes: 0, activities: 1, bankPayouts: 0 },
    ]);
    // The DGFiP file carries those amounts, in euros.
    const xml = taxXml(document);
    for (const [quarter, euros] of [
      [1, 80],
      [2, 40],
      [3, 60],
      [4, 80],
    ])
      expect(xml).toContain(`<dpi:ConsQ${quarter} currCode="EUR">${euros}</dpi:ConsQ${quarter}>`);
    expect(xml).toContain(`<dpi:FeesQ2 currCode="EUR">10</dpi:FeesQ2>`);
    expect(xml).toContain(`<dpi:NumbQ3>1</dpi:NumbQ3>`);
  }, 60000);

  it("lowers the quarter of the sale for a Withdrawal refunded after its payout, which the next payout recovers", async () => {
    const first = await sale("2026-02-10T10:00Z", accountId);
    await monthly("2026-03-01T12:00Z");
    await refund("2026-04-02T10:00Z", first, 5000);
    await sale("2026-04-20T10:00Z", accountId);
    await monthly("2026-05-01T12:00Z");
    await monthly("2026-06-01T12:00Z");

    const document = await prepare(2026),
      paid = await payouts();
    // 8 000 paid in March; June's payout is the April sale's 8 000 less the 4 000 refunded net of its Commission.
    expect(paid.batches.map((batch) => batch.amount)).toEqual([8000, 4000]);
    expectMatches(document.sellers[0]!.quarters, paid);
    expect(document.sellers[0]!.quarters).toEqual([
      { quarter: 1, consideration: 4000, fees: 1000, taxes: 0, activities: 1, bankPayouts: 8000 },
      { quarter: 2, consideration: 8000, fees: 2000, taxes: 0, activities: 1, bankPayouts: 4000 },
      { quarter: 3, consideration: 0, fees: 0, taxes: 0, activities: 0, bankPayouts: 0 },
      { quarter: 4, consideration: 0, fees: 0, taxes: 0, activities: 0, bankPayouts: 0 },
    ]);
  }, 60000);
});
