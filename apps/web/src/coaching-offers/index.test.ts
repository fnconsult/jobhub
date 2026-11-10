import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingOffers, JOBBBOX_SELLER } from "./index";
describe.skipIf(!connectionString)("Coaching Offers and immutable Seller snapshots", () => {
  let auth: TestAuth, candidateId: string, coachId: string;
  let offers: ReturnType<typeof coachingOffers>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, "offer-candidate@example.test");
    candidateId = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    coachId = (
      await auth.database.query(
        "INSERT INTO human_coach(name,email,booking_url) VALUES('Offer Coach','offers@example.test','https://cal.com/offers') RETURNING id",
      )
    ).rows[0].id;
    offers = coachingOffers(auth.database, { price: async () => ({ amount: 7200, currency: "eur" }) });
  }, 60_000);
  afterEach(async () => {
    await auth.stop();
  }, 60_000);
  it("creates a Jobbbox default, takes the Plan price, and refuses unpayable third-party offers", async () => {
    expect(await offers.sale(candidateId, coachId)).toMatchObject({ seller: JOBBBOX_SELLER, amount: 7200, durationMinutes: 60, commissionBps: 0 });
    const seller = (await offers.saveSeller({ kind: "human_coach", coachId, name: "Coach SAS", status: "SAS", siret: "12345678901234", commissionBps: 1500 }))!;
    expect(await offers.saveOffer({ coachId, sellerId: seller.id, durationMinutes: 90, amount: 12000 })).toBe(true);
    expect(await offers.sale(candidateId, coachId)).toBeNull();
    expect(await offers.quote(candidateId, coachId)).toBeNull();
    const eligible = coachingOffers(auth.database, { price: async () => ({ amount: 7200, currency: "eur" }), eligibleSeller: async () => true });
    expect(await eligible.sale(candidateId, coachId)).toMatchObject({
      seller: { name: "Coach SAS", status: "SAS", siret: "12345678901234" },
      amount: 12000,
      durationMinutes: 90,
      commissionBps: 1500,
    });
  });
  it("freezes Commission and identity before payment and keeps duplicate webhook deliveries immutable", async () => {
    await offers.commission(JOBBBOX_SELLER.id, 1200);
    const quote = (await offers.quote(candidateId, coachId))!;
    await offers.commission(JOBBBOX_SELLER.id, 3300);
    const session = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs-offer',7200,'eur') RETURNING id",
        [candidateId, coachId],
      )
    ).rows[0];
    const paid = { candidateId, coachId, checkoutSessionId: "cs-offer", quoteId: quote.id, amount: 7200, currency: "eur" };
    await offers.attachPaid(paid);
    await offers.attachPaid(paid);
    const rows = (await auth.database.query("SELECT snapshot FROM coaching_session_sale WHERE session_id=$1", [session.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].snapshot).toEqual(quote.sale);
    expect(rows[0].snapshot.commissionBps).toBe(1200);
  });
  it("keeps offers unorderable when the platform Price cannot be read",async()=>{
    const unavailable=coachingOffers(auth.database,{price:async()=>{throw new Error("Stripe unavailable");}});
    expect(await unavailable.sale(candidateId,coachId)).toBeNull();
    expect(await unavailable.quote(candidateId,coachId)).toBeNull();
  });
  it("validates identity, price, duration, cross-coach Sellers and quote ownership", async () => {
    expect(await offers.saveSeller({ kind: "human_coach", coachId, name: "A", status: "", siret: "123", commissionBps: 100 })).toBeNull();
    expect(await offers.saveOffer({ coachId, sellerId: JOBBBOX_SELLER.id, durationMinutes: 0, amount: 100 })).toBe(false);
    expect(await offers.commission(JOBBBOX_SELLER.id, 10001)).toBe(false);
    const second = (
      await auth.database.query(
        "INSERT INTO human_coach(name,email,booking_url) VALUES('Other','other-offers@example.test','https://cal.com/other') RETURNING id",
      )
    ).rows[0].id;
    const seller = (await offers.saveSeller({
      kind: "human_coach",
      coachId: second,
      name: "Other SAS",
      status: "SAS",
      siret: "12345678901234",
      commissionBps: 100,
    }))!;
    expect(await offers.saveOffer({ coachId, sellerId: seller.id, durationMinutes: 60, amount: 9000 })).toBe(false);
    const quote = (await offers.quote(candidateId, coachId))!;
    const session = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs-wrong-quote',7200,'eur') RETURNING id",
        [candidateId, second],
      )
    ).rows[0];
    await expect(
      offers.attachPaid({ candidateId, coachId: second, checkoutSessionId: "cs-wrong-quote", quoteId: quote.id, amount: 7200, currency: "eur" }),
    ).rejects.toThrow("does not match");
    expect((await auth.database.query("SELECT * FROM coaching_session_sale WHERE session_id=$1", [session.id])).rows).toHaveLength(0);
  });
});
