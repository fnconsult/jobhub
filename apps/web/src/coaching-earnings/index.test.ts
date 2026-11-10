import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingOffers, type CoachingSale } from "../coaching-offers";
import { earningLine } from "../coaching-connect/earnings";
import { deleteConnectDataOf } from "../coaching-connect";
import { coachEarnings, archiveEarningsService, earningsPeriod } from "./index";
import { earningsPdf, earningsPdfBlocks } from "./pdf";
describe.skipIf(!connectionString)("owned monthly Coach Earnings", () => {
  let auth: TestAuth, ownerId: string, buyerId: string, outsiderId: string, coachId: string, sellerId: string, clock: Date;
  let offers: ReturnType<typeof coachingOffers>, earnings: ReturnType<typeof coachEarnings>;
  async function person(email: string) {
    const cookie = await signInWithMagicLink(auth, email);
    return (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    ownerId = await person("earnings-owner@example.test");
    buyerId = await person("PRIVATE_BUYER@example.test");
    outsiderId = await person("earnings-outsider@example.test");
    coachId = (
      await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Sophie Conseil','earnings-owner@example.test','') RETURNING id")
    ).rows[0].id;
    offers = coachingOffers(auth.database, { price: async () => ({ amount: 10000, currency: "eur" }), eligibleSeller: async () => true });
    sellerId = (await offers.saveSeller({ kind: "human_coach", coachId, name: "Sophie Société", status: "EI", siret: "12345678901234", commissionBps: 2000 }))!
      .id;
    await offers.saveOffer({ coachId, sellerId, durationMinutes: 90, amount: 10000 });
    await auth.database.query(
      "INSERT INTO coaching_connect_account(seller_id,account_id,owner_id,created_at) VALUES($1,'acct_PRIVATE_OWNER',$2,clock_timestamp())",
      [sellerId, ownerId],
    );
    clock = new Date("2026-07-02T12:00Z");
    earnings = coachEarnings(auth.database, { now: () => clock });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  async function payment(input: {
    paidAt: string;
    scheduledAt?: string;
    amount?: number;
    commission?: number;
    refunded?: number;
    refundedCommission?: number;
    held?: number;
    allocated?: number;
    recipientId?: string;
    sale?: CoachingSale;
  }) {
    const snapshot = input.sale ?? (await offers.quote(buyerId, coachId))!.sale,
      id = randomUUID(),
      checkout = `cs_${id}`,
      recipient = input.recipientId ?? sellerId;
    const payee = (await auth.database.query("SELECT id,kind,name,status,siret FROM coaching_seller WHERE id=$1", [recipient])).rows[0];
    await auth.database.query(
      `INSERT INTO coaching_connect_payment(id,quote_id,candidate_id,coach_id,recipient_id,account_id,amount,currency,commission,payee_amount,request,sale_snapshot,payee_snapshot,created_at,checkout_id,payment_intent,paid_at) VALUES($1,NULL,$2,$3,$4,'acct_PRIVATE_OWNER',$5,'eur',$6,$7,$8,$9,$10,$11,$12,'pi_PRIVATE',$11)`,
      [
        id,
        buyerId,
        coachId,
        recipient,
        input.amount ?? 10000,
        input.commission ?? 2000,
        (input.amount ?? 10000) - (input.commission ?? 2000),
        { email: "PRIVATE_BUYER@example.test" },
        snapshot,
        payee,
        new Date(input.paidAt),
        checkout,
      ],
    );
    await auth.database.query(
      "INSERT INTO coaching_connect_earning(payment_id,amount,commission,refunded,refunded_commission,held,allocated,available) VALUES($1,$2,$3,$4,$5,$6,$7,true)",
      [id, input.amount ?? 10000, input.commission ?? 2000, input.refunded ?? 0, input.refundedCommission ?? 0, input.held ?? 0, input.allocated ?? 0],
    );
    await auth.database.query(
      "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,paid_at,scheduled_at,duration_minutes,note) VALUES($1,$2,$3,$4,'eur',$5,$6,90,'PRIVATE_BUYER_NOTE')",
      [buyerId, coachId, checkout, input.amount ?? 10000, new Date(input.paidAt), input.scheduledAt ? new Date(input.scheduledAt) : null],
    );
    return id;
  }
  it("uses the settlement calculation and carries a refunded old payout across the selected month", async () => {
    await payment({ paidAt: "2026-05-01T12:00Z", refunded: 10000, refundedCommission: 2000, allocated: 8000 });
    const id = await payment({ paidAt: "2026-06-01T12:00Z", scheduledAt: "2026-06-14T10:00Z", amount: 15000, commission: 3000 });
    const shown = (await earnings.statement(ownerId, sellerId, "2026-06"))!;
    expect(shown.sessionsHeld).toBe(1);
    expect(shown.currencies).toMatchObject([{ collected: 15000, commission: 3000, net: 12000, outstanding: 4000 }]);
    const row = (
      await auth.database.query(
        'SELECT amount,commission,refunded,refunded_commission AS "refundedCommission",processing_fees AS "processingFees",held,allocated FROM coaching_connect_earning WHERE payment_id=$1',
        [id],
      )
    ).rows[0];
    expect(shown.currencies[0]!.net).toBe(earningLine({ ...row, id, paidAt: new Date("2026-06-01T12:00Z") }).net);
    expect(shown.offers).toMatchObject([{ seller: { id: sellerId }, durationMinutes: 90, sessionsHeld: 1, net: 12000 }]);
    expect(JSON.stringify(shown)).not.toMatch(/PRIVATE_BUYER|PRIVATE_OWNER|pi_PRIVATE/);
  });
  it("counts a held service in its actual month even when its payment was in the preceding month", async () => {
    await payment({ paidAt: "2026-05-20T12:00Z", scheduledAt: "2026-06-04T10:00Z" });
    const may = (await earnings.statement(ownerId, sellerId, "2026-05"))!,
      june = (await earnings.statement(ownerId, sellerId, "2026-06"))!;
    expect(may.sessionsHeld).toBe(0);
    expect(may.currencies[0]?.collected).toBe(10000);
    expect(june.sessionsHeld).toBe(1);
    expect(june.currencies[0]?.collected).toBe(0);
    expect(june.offers[0]).toMatchObject({ sessionsHeld: 1, collected: 0 });
  });
  it("keeps only the business fact of completion after purchaser erasure", async () => {
    await payment({ paidAt: "2026-06-01T12:00Z", scheduledAt: "2026-06-04T10:00Z" });
    await archiveEarningsService(auth.database, buyerId, clock);
    await deleteConnectDataOf(auth.database, buyerId);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [buyerId]);
    const shown = (await earnings.statement(ownerId, sellerId, "2026-06"))!;
    expect(shown.sessionsHeld).toBe(1);
    expect(shown.currencies[0]?.collected).toBe(10000);
    expect(JSON.stringify(shown)).not.toMatch(/PRIVATE_BUYER|PRIVATE_BUYER_NOTE/);
  });
  it("does not grant a purchaser/outsider a Seller statement and binds old ownership across email reuse/retirement", async () => {
    await payment({ paidAt: "2026-06-01T12:00Z" });
    expect(await earnings.statement(buyerId, sellerId, "2026-06")).toBeNull();
    expect(await earnings.statement(outsiderId, sellerId, "2026-06")).toBeNull();
    await auth.database.query("UPDATE human_coach SET retired_at=clock_timestamp() WHERE id=$1", [coachId]);
    await auth.database.query("UPDATE candidate SET email=$2 WHERE id=$1", [ownerId, "former-owner@example.test"]);
    const recycled = await person("earnings-owner@example.test");
    expect(await earnings.statement(recycled, sellerId, "2026-06")).toBeNull();
    expect(await earnings.statement(ownerId, sellerId, "2026-06")).not.toBeNull();
  });
  it("shows immutable Seller/beneficiary identities and an authenticated printable statement in both languages", async () => {
    await payment({ paidAt: "2026-06-01T12:00Z" });
    await auth.database.query("UPDATE coaching_seller SET name='Current company',siret='98765432109876' WHERE id=$1", [sellerId]);
    const shown = (await earnings.statement(ownerId, sellerId, "2026-06"))!;
    expect(shown.seller.name).toBe("Current company");
    expect(shown.beneficiaries).toMatchObject([{ name: "Sophie Société", siret: "12345678901234" }]);
    expect(shown.offers[0]?.seller.name).toBe("Sophie Société");
    const blocks = earningsPdfBlocks(shown, "fr", "America/Montreal")
      .flatMap((block) => (block.kind === "gap" ? [] : [block.text]))
      .join("\n");
    expect(blocks).toContain("Sophie Société");
    expect(blocks).toContain("America/Montreal");
    expect(blocks).not.toMatch(/PRIVATE_BUYER|acct_|pi_/);
    const pdf = await earningsPdf(shown, "fr", "Europe/Paris");
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toBe("releve-revenus-2026-06.pdf");
    expect((await earningsPdf(shown, "en", "Europe/Paris")).fileName).toBe("earnings-statement-2026-06.pdf");
  });
  it("scopes an Association manager to its own business, without Candidate contacts or private notes", async () => {
    const association = (
      await auth.database.query("INSERT INTO coach_association(name,legal_status,siret) VALUES('Association A','Association','11111111111111') RETURNING id")
    ).rows[0].id;
    await auth.database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [association, outsiderId]);
    const seller = (await offers.saveSeller({
      kind: "association",
      name: "Association A",
      status: "Association",
      siret: "11111111111111",
      commissionBps: 2000,
    }))!;
    await auth.database.query("UPDATE coaching_seller SET association_id=$2 WHERE id=$1", [seller.id, association]);
    const snapshot = (await offers.quote(buyerId, coachId))!.sale;
    await payment({ paidAt: "2026-06-01T12:00Z", recipientId: seller.id, sale: { ...snapshot, seller } });
    const shown = (await earnings.statement(outsiderId, seller.id, "2026-06"))!;
    expect(shown.currencies[0]?.net).toBe(8000);
    expect(await earnings.statement(ownerId, seller.id, "2026-06")).toBeNull();
    expect(JSON.stringify(shown)).not.toMatch(/PRIVATE_BUYER|PRIVATE_BUYER_NOTE/);
    await auth.database.query("DELETE FROM coach_association_manager WHERE association_id=$1", [association]);
    expect(await earnings.statement(outsiderId, seller.id, "2026-06")).toBeNull();
  });
  it("keeps linked later payouts visible without presenting a cancelled attempt as paid", async () => {
    const paymentId = await payment({ paidAt: "2026-06-01T12:00Z", refunded: 1000, refundedCommission: 200, held: 500 });
    const batch = randomUUID();
    await auth.database.query("INSERT INTO coaching_connect_batch(id,seller_id,month,currency,amount,transfer_amount,account_id,created_at,state,paid_at) VALUES($1,$2,'2026-07','eur',6700,0,'acct_PRIVATE_OWNER','2026-07-01','paid','2026-07-02')", [batch,sellerId]);
    await auth.database.query("INSERT INTO coaching_connect_allocation VALUES($1,$2,6700)",[batch,paymentId]);
    const shown = (await earnings.statement(ownerId,sellerId,"2026-06"))!;
    expect(shown.currencies[0]).toMatchObject({ refunded:1000,refundedCommission:200,withheld:500,net:6700 });
    expect(shown.payouts).toMatchObject([{ amount:6700,state:"paid",month:"2026-07",paidAt:new Date("2026-07-02") }]);
    await auth.database.query("UPDATE coaching_connect_batch SET state='cancelled',paid_at=NULL WHERE id=$1",[batch]);
    expect((await earnings.statement(ownerId,sellerId,"2026-06"))!.payouts[0]).toMatchObject({state:"cancelled",paidAt:null});
  });
  it("validates month boundaries and follows the French DST calendar", () => {
    expect(earningsPeriod("2026-00")).toBeNull();
    expect(earningsPeriod("0000-01")).toBeNull();
    expect(earningsPeriod("../2026")).toBeNull();
    const october = earningsPeriod("2026-10")!;
    expect((october.end.getTime() - october.start.getTime()) / 3600000).toBe(745);
  });
});
