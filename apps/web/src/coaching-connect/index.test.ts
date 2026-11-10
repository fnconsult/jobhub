import { startFakeStripe, FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET } from "../billing/fake-stripe";
import { stripeConnect } from "./stripe";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingOffers, JOBBBOX_SELLER } from "../coaching-offers";
import { createHumanCoaches } from "../human-coaches";
import { createProfiles } from "../profiles";
import { createApplications } from "../applications";
import { createJobOffers } from "../job-offers";
import { coachingConnect, migrateCoachingConnect, connectDataOf, deleteConnectDataOf, type ConnectPort } from "./index";
import { ConnectOperationNotCreated, type CheckoutRequest, type ConnectCheckout } from "./port";
describe.skipIf(!connectionString)("Connect payment contexts and monthly allocation", () => {
  let auth: TestAuth, coachId: string, sellerId: string, coachPersonId: string, candidate: { id: string; email: string }, clock: Date;
  let build: (stripe: ConnectPort) => ReturnType<typeof coachingConnect>;
  let offers: ReturnType<typeof coachingOffers>, connect: ReturnType<typeof coachingConnect>, port: ConnectPort;
  let checkouts: Map<string, ConnectCheckout>,
    requests: Map<string, CheckoutRequest>,
    permitted: boolean,
    active: boolean,
    interrupt: boolean,
    currentContract: boolean;
  const confirm = vi.fn(),
    notice = vi.fn();
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    await migrateCoachingConnect(auth.database);
    const cookie = await signInWithMagicLink(auth, "connect-buyer@example.test");
    candidate = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
    const coachCookie = await signInWithMagicLink(auth, "connect-coach@example.test");
    coachPersonId = (await (await auth.request("/api/auth/get-session", { cookie: coachCookie })).json()).user.id;
    coachId = (
      await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Connect Coach','connect-coach@example.test','') RETURNING id")
    ).rows[0].id;
    offers = coachingOffers(auth.database, { price: async () => ({ amount: 10000, currency: "eur" }), eligibleSeller: async () => true });
    sellerId = (await offers.saveSeller({ kind: "human_coach", coachId, name: "Coach Business", status: "EI", siret: "12345678901234", commissionBps: 2000 }))!
      .id;
    await offers.saveOffer({ coachId, sellerId, durationMinutes: 90, amount: 10000 });
    clock = new Date("2026-04-18T12:00Z");
    permitted = true;
    currentContract = true;
    active = true;
    interrupt = false;
    checkouts = new Map();
    requests = new Map();
    confirm.mockReset();
    notice.mockReset();
    port = {
      account: vi.fn(async () => ({ id: "acct_coach", active: false })),
      status: vi.fn(async (id) => ({ id, active })),
      onboarding: vi.fn(async () => "https://connect.stripe.com/onboard"),
      dashboard: vi.fn(async () => "https://connect.stripe.com/dashboard"),
      checkout: vi.fn(async (request, key) => {
        requests.set(key, request);
        const existing = checkouts.get(key);
        if (existing) return existing;
        const result = {
          id: `cs_${checkouts.size}`,
          url: "https://checkout.stripe.com/test",
          paid: true,
          amount: request.amount,
          currency: request.currency,
          paymentIntent: `pi_${checkouts.size}`,
          contextId: request.contextId,
        };
        checkouts.set(key, result);
        if (interrupt) {
          interrupt = false;
          throw new Error("Stripe returned after connection lost");
        }
        return result;
      }),
      readCheckout: vi.fn(async (id) => [...checkouts.values()].find((c) => c.id === id)!),
      payment: vi.fn(async () => ({ amount: 10000, refunded: 0, refundedCommission: 0, processingFees: 0, available: true })),
      findPayout: vi.fn(async () => null),
      findTransfer: vi.fn(async () => null),
      transfer: vi.fn(async (input) => `tr_${input.batchId}`),
      payout: vi.fn(async (input) => ({ id: `po_${input.batchId}`, state: "paid" as const })),
      payoutState: vi.fn(async () => "paid" as const),
    };
    const profiles = createProfiles(auth.database),
      humans = createHumanCoaches(auth.database, {
        profiles,
        applications: createApplications(auth.database, { profiles, jobOffers: createJobOffers(auth.database) }),
        tailoredDocuments: { get: async () => null },
        tailoredCvs: { get: async () => null },
      });
    build = (stripe) =>
      coachingConnect(auth.database, {
        stripe,
        baseURL: "http://localhost:3000",
        now: () => clock,
        permitted: async () => permitted,
        maySell: async () => currentContract,
        recordPaid: (paid, financials) => humans.recordPaidSession(paid, financials),
        attachSale: (paid, within) => offers.attachPaid(paid, within),
        confirmOrder: confirm,
        sendPayoutNotice: notice,
      });
    connect = build(port);
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  const start = async () =>
    connect.startCheckout(candidate, (await offers.quote(candidate.id, coachId))!.id, "fr", {
      success: "http://localhost:3000/coachs",
      cancel: "http://localhost:3000/coachs",
    });
  async function paid() {
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    const result = await start();
    expect(result).not.toBeNull();
    const session = [...checkouts.values()].find((c) => c.id === result!.checkoutSessionId)!;
    expect(await connect.paid(session, "acct_coach")).toBe(true);
    return session;
  }
  it("fails closed without legal eligibility or an actually active Express account", async () => {
    permitted = false;
    expect(await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId)).toBeNull();
    expect(await start()).toBeNull();
    expect(port.checkout).not.toHaveBeenCalled();
    permitted = true;
    expect(await start()).toBeNull();
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    active = false;
    expect(await connect.eligible(sellerId)).toBe(false);
    expect(await start()).toBeNull();
    expect(port.checkout).not.toHaveBeenCalled();
  });
  it("recovers interrupted Checkout creation under the same context and refuses another account/session", async () => {
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    interrupt = true;
    await expect(start()).rejects.toThrow("connection lost");
    const original = [...checkouts.values()][0]!;
    expect(await connect.paid(original, "acct_foreign")).toBe(false);
    expect(await connect.paid({ ...original, id: "cs_forged" }, "acct_coach")).toBe(false);
    expect(await connect.paid(original, "acct_coach")).toBe(true);
    expect(await connect.paid(original, "acct_coach")).toBe(true);
    expect(checkouts.size).toBe(1);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_session")).rows[0].n).toBe(1);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_connect_earning")).rows[0].n).toBe(1);
    expect((await auth.database.query("SELECT snapshot FROM coaching_session_sale")).rows[0].snapshot).toMatchObject({
      amount: 10000,
      commissionBps: 2000,
      durationMinutes: 90,
    });
  });
  it("freezes the account and commission then allocates only once, including concurrent workers", async () => {
    await paid();
    await offers.commission(sellerId, 8000);
    clock = new Date("2026-05-01T12:00Z");
    expect(await connect.runMonthly()).toMatchObject({ started: 0 });
    expect(port.payout).not.toHaveBeenCalled();
    clock = new Date("2026-06-01T12:00Z");
    await Promise.all([connect.runMonthly(), connect.runMonthly()]);
    expect(port.payout).toHaveBeenCalledTimes(1);
    expect(port.payout).toHaveBeenCalledWith(expect.objectContaining({ amount: 8000, accountId: "acct_coach" }));
    expect(port.transfer).not.toHaveBeenCalled();
    expect(await connect.runMonthly()).toMatchObject({ started: 0 });
    expect((await connect.earnings(sellerId))[0]).toMatchObject({ amount: 10000, commission: 2000, allocated: 8000 });
  });
  it("subtracts pending refunds before paying and carries refunds after a payout", async () => {
    await paid();
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    vi.mocked(port.payment).mockResolvedValue({ amount: 10000, refunded: 10000, refundedCommission: 2000, processingFees: 0, available: true });
    clock = new Date("2026-07-01T12:00Z");
    expect(await connect.runMonthly()).toMatchObject({ started: 0 });
    expect((await connect.earnings(sellerId))[0]).toMatchObject({ refunded: 10000, refundedCommission: 2000, allocated: 8000 });
    expect(port.payout).toHaveBeenCalledTimes(1);
  });
  it("does not pay an unresolved dispute or an unsettled balance", async () => {
    await paid();
    vi.mocked(port.payment).mockResolvedValue({ amount: 10000, refunded: 0, refundedCommission: 0, processingFees: 0, available: false });
    clock = new Date("2026-06-01T12:00Z");
    expect(await connect.runMonthly()).toMatchObject({ started: 0 });
    expect(port.payout).not.toHaveBeenCalled();
  });
  it("binds onboarding/dashboard to the original owner and never to a recycled email", async () => {
    expect(await connect.onboarding(sellerId, "/espace-coach/revenus", candidate.id)).toBeNull();
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    expect(await connect.dashboard(sellerId, candidate.id)).toBeNull();
    expect(await connect.dashboard(sellerId, coachPersonId)).toContain("stripe.com");
    await auth.database.query("UPDATE candidate SET email=$2 WHERE id=$1", [coachPersonId, "former-connect-coach@example.test"]);
    const cookie = await signInWithMagicLink(auth, "connect-coach@example.test");
    const recycled = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
    expect(await connect.dashboard(sellerId, recycled.id)).toBeNull();
    expect(await connect.onboarding(sellerId, "/espace-coach/revenus", recycled.id)).toBeNull();
  });
  it("pays existing compensation after retirement, with no new Checkout", async () => {
    await paid();
    await auth.database.query("UPDATE human_coach SET retired_at=clock_timestamp() WHERE id=$1", [coachId]);
    expect(await connect.eligible(sellerId)).toBe(false);
    clock = new Date("2026-06-01T12:00Z");
    expect(await connect.runMonthly()).toMatchObject({ started: 1, paid: 1 });
    expect(port.payout).toHaveBeenCalledWith(expect.objectContaining({ amount: 8000 }));
  });
  it("leases one fiscal notice under concurrent workers and retries its failure independently", async () => {
    await paid();
    clock = new Date("2026-06-01T12:00Z");
    notice.mockRejectedValueOnce(new Error("mail temporarily unavailable"));
    await Promise.all([connect.runMonthly(), connect.runMonthly()]);
    expect(notice).toHaveBeenCalledTimes(1);
    clock = new Date("2026-06-01T12:06Z");
    await connect.runMonthly();
    expect(notice).toHaveBeenCalledTimes(2);
    await connect.runMonthly();
    expect(notice).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit Jobbbox compensation recipient/share and recovers that compensation from later third-party proceeds", async () => {
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    await offers.saveOffer({ coachId, sellerId: JOBBBOX_SELLER.id, durationMinutes: 60, amount: null });
    expect(await start()).toBeNull();
    expect(await offers.compensation(coachId, 6000, sellerId)).toBe(true);
    const checkout = await start();
    expect(checkout).not.toBeNull();
    const first = [...checkouts.values()].find((c) => c.id === checkout!.checkoutSessionId)!;
    expect(await connect.paid(first, null)).toBe(true);
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    expect(port.transfer).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 6000 }));
    expect(port.payout).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 6000 }));
    await offers.saveOffer({ coachId, sellerId, durationMinutes: 60, amount: 10000 });
    const second = await start(),
      secondSession = [...checkouts.values()].find((c) => c.id === second!.checkoutSessionId)!;
    expect(await connect.paid(secondSession, "acct_coach")).toBe(true);
    vi.mocked(port.payment).mockImplementation(async (id) => ({
      amount: 10000,
      refunded: id === first.paymentIntent ? 10000 : 0,
      refundedCommission: 0,
      processingFees: 0,
      available: true,
    }));
    clock = new Date("2026-07-01T12:00Z");
    await connect.runMonthly();
    expect(port.transfer).toHaveBeenLastCalledWith(expect.objectContaining({ amount: -6000 }));
    expect(port.payout).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 2000 }));
  });
  it("erases purchaser contact data while preserving the other Seller's pseudonymous accounting", async () => {
    await paid();
    const before = await connectDataOf(auth.database, candidate.id);
    expect(before.purchases).toHaveLength(1);
    expect(before.earnings).toHaveLength(0);
    const owner = await connectDataOf(auth.database, coachPersonId);
    expect(owner.earnings).toHaveLength(1);
    expect(JSON.stringify(owner)).not.toMatch(/connect-buyer|acct_coach|pi_0/);
    await deleteConnectDataOf(auth.database, candidate.id);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidate.id]);
    const row = (await auth.database.query("SELECT candidate_id,quote_id,request,sale_snapshot FROM coaching_connect_payment")).rows[0];
    expect(row.candidate_id).toBeNull();
    expect(row.quote_id).toBeNull();
    expect(row.request.email).toBeUndefined();
    expect(row.sale_snapshot).toMatchObject({ coachId, amount: 10000, commissionBps: 2000, seller: { id: sellerId } });
    expect(await connect.earnings(sellerId)).toHaveLength(1);
    clock = new Date("2037-01-01T00:00Z");
    expect(await connect.purge()).toBe(1);
    expect(await connect.earnings(sellerId)).toHaveLength(0);
  });
  it("requires the current B2B version even when initial approval and Stripe remain active", async () => {
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    expect(await connect.eligible(sellerId)).toBe(true);
    currentContract = false;
    expect(await connect.eligible(sellerId)).toBe(false);
    expect(await start()).toBeNull();
    expect(port.checkout).not.toHaveBeenCalled();
  });
  it("binds a signed paid Checkout after a lost response even beyond the create idempotency window", async () => {
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    interrupt = true;
    await expect(start()).rejects.toThrow("connection lost");
    const session = [...checkouts.values()][0]!;
    clock = new Date(clock.getTime() + 48 * 3600000);
    expect(await connect.paid(session, "acct_coach")).toBe(true);
    expect(port.checkout).toHaveBeenCalledTimes(1);
    expect((await auth.database.query("SELECT checkout_id FROM coaching_connect_payment")).rows[0].checkout_id).toBe(session.id);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_session")).rows[0].n).toBe(1);
  });
  it.each(["refund", "dispute"])("cancels a definitively uncreated payout after a later %s instead of sending its stale allocation", async (cause) => {
    await paid();
    vi.mocked(port.payout).mockRejectedValueOnce(new ConnectOperationNotCreated("insufficient balance"));
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    vi.mocked(port.payment).mockResolvedValue({
      amount: 10000,
      refunded: cause === "refund" ? 10000 : 0,
      refundedCommission: cause === "refund" ? 2000 : 0,
      processingFees: 0,
      available: cause === "refund",
    });
    clock = new Date("2026-06-01T12:06Z");
    await connect.runMonthly();
    await connect.runMonthly();
    expect(port.payout).toHaveBeenCalledTimes(1);
    expect((await connect.earnings(sellerId))[0]?.allocated).toBe(0);
    expect((await auth.database.query("SELECT state FROM coaching_connect_batch")).rows[0].state).toBe("cancelled");
  });
  it("rebatches a partially refunded, definitively uncreated payout with only its remaining liability", async () => {
    await paid();
    vi.mocked(port.payout).mockRejectedValueOnce(new ConnectOperationNotCreated("insufficient balance"));
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    vi.mocked(port.payment).mockResolvedValue({ amount: 10000, refunded: 5000, refundedCommission: 1000, processingFees: 0, available: true });
    clock = new Date("2026-06-01T12:06Z");
    await connect.runMonthly();
    await connect.runMonthly();
    expect(vi.mocked(port.payout).mock.calls.map(([input]) => input.amount)).toEqual([8000, 4000]);
    expect((await connect.earnings(sellerId))[0]?.allocated).toBe(4000);
  });
  it("quarantines an ambiguous uncreated outcome when liability falls and blocks further Seller cash-outs", async () => {
    await paid();
    vi.mocked(port.payout).mockRejectedValueOnce(new Error("network outcome unknown"));
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    vi.mocked(port.payment).mockResolvedValue({ amount: 10000, refunded: 10000, refundedCommission: 2000, processingFees: 0, available: true });
    clock = new Date("2026-06-01T12:06Z");
    await connect.runMonthly();
    expect((await auth.database.query("SELECT state FROM coaching_connect_batch")).rows[0].state).toBe("needs_review");
    expect(port.payout).toHaveBeenCalledTimes(1);
    expect((await connect.earnings(sellerId))[0]?.allocated).toBe(8000);
    clock = new Date("2026-07-01T12:00Z");
    await connect.runMonthly();
    expect(port.payout).toHaveBeenCalledTimes(1);
    vi.mocked(port.findPayout).mockResolvedValue({ id: "po_recovered", state: "paid" });
    expect(await connect.runMonthly()).toMatchObject({ paid: 1 });
    expect(port.payout).toHaveBeenCalledTimes(1);
  });
  it("unwinds a known Jobbbox transfer before releasing a cancelled payout allocation", async () => {
    await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
    await offers.saveOffer({ coachId, sellerId: JOBBBOX_SELLER.id, durationMinutes: 60, amount: null });
    await offers.compensation(coachId, 6000, sellerId);
    const checkout = await start(),
      session = [...checkouts.values()].find((c) => c.id === checkout!.checkoutSessionId)!;
    await connect.paid(session, null);
    vi.mocked(port.payout).mockRejectedValueOnce(new ConnectOperationNotCreated("bank payout not created"));
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    vi.mocked(port.findTransfer).mockResolvedValue({ id: "tr_existing", amount: 6000, complete: true });
    vi.mocked(port.payment).mockResolvedValue({ amount: 10000, refunded: 10000, refundedCommission: 0, processingFees: 0, available: true });
    clock = new Date("2026-06-01T12:06Z");
    await connect.runMonthly();
    expect(vi.mocked(port.transfer).mock.calls.map(([input]) => input.amount)).toEqual([6000, -6000]);
    expect((await connect.earnings(sellerId))[0]?.allocated).toBe(0);
    expect(port.payout).toHaveBeenCalledTimes(1);
  });
  it("uses a fresh create attempt only after an authoritative rejection, even after the old key expires", async () => {
    await paid();
    vi.mocked(port.payout).mockRejectedValueOnce(new ConnectOperationNotCreated("not created"));
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    clock = new Date("2026-06-03T12:00Z");
    expect(await connect.runMonthly()).toMatchObject({ paid: 1 });
    expect(vi.mocked(port.payout).mock.calls.map(([input]) => input.attempt)).toEqual([0, 1]);
    expect(vi.mocked(port.payout).mock.calls[1]?.[0].attemptedAt).toEqual(clock);
  });
  it("does not backfill an old unbound pending batch as a proven uncreated operation", async () => {
    await paid();
    vi.mocked(port.payout).mockRejectedValueOnce(new Error("old unknown outcome"));
    clock = new Date("2026-06-01T12:00Z");
    await connect.runMonthly();
    await auth.database.query("ALTER TABLE coaching_connect_batch DROP COLUMN payout_outcome,DROP COLUMN transfer_outcome");
    await auth.database.query(
      "ALTER TABLE coaching_connect_batch ADD CONSTRAINT coaching_connect_batch_seller_id_month_currency_key UNIQUE(seller_id,month,currency)",
    );
    await migrateCoachingConnect(auth.database);
    expect((await auth.database.query("SELECT payout_outcome FROM coaching_connect_batch")).rows[0].payout_outcome).toBe("unknown");
    vi.mocked(port.payment).mockResolvedValue({ amount: 10000, refunded: 10000, refundedCommission: 2000, processingFees: 0, available: true });
    clock = new Date("2026-06-01T12:06Z");
    await connect.runMonthly();
    expect(port.payout).toHaveBeenCalledTimes(1);
    expect((await auth.database.query("SELECT state FROM coaching_connect_batch")).rows[0].state).toBe("needs_review");
  });

  it("keeps a nondisputed pending Stripe balance out of payout, including fee-refunded net, until settlement", async () => {
    const fake = await startFakeStripe();
    try {
      const actual = stripeConnect({ secretKey: FAKE_STRIPE_SECRET_KEY, webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET, apiUrl: fake.url, now: () => clock });
      connect = build(actual);
      await connect.onboarding(sellerId, "/espace-coach/revenus", coachPersonId);
      const accountId = (await auth.database.query("SELECT account_id FROM coaching_connect_account WHERE seller_id=$1", [sellerId])).rows[0].account_id;
      await fetch(`${fake.url}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: accountId }) });
      const quote = (await offers.quote(candidate.id, coachId))!,
        started = (await connect.startCheckout(candidate, quote.id, "fr", { success: "http://localhost/coachs", cancel: "http://localhost/coachs" }))!;
      await fetch(`${fake.url}/__connect/pay`, { method: "POST", body: new URLSearchParams({ session: started.checkoutSessionId }) });
      const session = (await actual.readCheckout(started.checkoutSessionId, accountId))!;
      expect(await connect.paid(session, accountId)).toBe(true);
      const balance = async (status: string, intent_status = "succeeded") =>
        fetch(`${fake.url}/__connect/balance`, {
          method: "POST",
          body: new URLSearchParams({ payment_intent: session.paymentIntent!, status, intent_status }),
        });
      await balance("pending");
      expect(await actual.payment(session.paymentIntent!, accountId)).toMatchObject({ available: false, settled: false, held: 0 });
      clock = new Date("2026-06-01T12:00Z");
      await connect.runMonthly();
      expect((await connect.earnings(sellerId))[0]?.held).toBe(8000);
      expect((await (await fetch(`${fake.url}/__connect/state`)).json()).payouts).toHaveLength(0);
      await fetch(`${fake.url}/v1/refunds`, {
        method: "POST",
        headers: { "stripe-account": accountId },
        body: new URLSearchParams({ payment_intent: session.paymentIntent!, amount: "5000", refund_application_fee: "true" }),
      });
      await connect.runMonthly();
      expect((await connect.earnings(sellerId))[0]).toMatchObject({ refunded: 5000, refundedCommission: 1000, held: 4000 });
      expect((await (await fetch(`${fake.url}/__connect/state`)).json()).payouts).toHaveLength(0);
      await balance("available", "processing");
      await connect.runMonthly();
      expect((await connect.earnings(sellerId))[0]?.held).toBe(4000);
      await balance("available");
      await connect.runMonthly();
      const payouts = (await (await fetch(`${fake.url}/__connect/state`)).json()).payouts;
      expect(payouts).toHaveLength(1);
      expect(payouts[0].value.amount).toBe(4000);
    } finally {
      await fake.stop();
    }
  });
});
