import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { secretCipherFromEnv } from "../provider-secrets/cipher";
import { coachingTaxes } from "./index";
const identity = {
  kind: "individual",
  legalName: "Test business",
  firstName: "Test",
  lastName: "Owner",
  birthDate: "1980-01-01",
  residence: "FR",
  tin: "12345678900011",
  tinCountry: "FR",
  siret: "12345678900011",
  street: "1 rue Exemple",
  postalCode: "75001",
  city: "Paris",
  addressCountry: "FR",
  iban: "FR7630006000011234567890189",
  accountHolder: "Test Owner",
};
describe.skipIf(!connectionString)("Seller fiscal identity and annual preparation", () => {
  let auth: TestAuth, owner: string, outsider: string, seller: string, taxes: ReturnType<typeof coachingTaxes>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    async function person(email: string) {
      const cookie = await signInWithMagicLink(auth, email);
      return (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
    }
    owner = await person("tax-owner@example.test");
    outsider = await person("outsider@example.test");
    const coach = (
      await auth.database.query(
        "INSERT INTO human_coach(name,email,booking_url,public_ready) VALUES('Tax Coach','tax-owner@example.test','',true) RETURNING id",
      )
    ).rows[0].id;
    seller = (
      await auth.database.query(
        "INSERT INTO coaching_seller(kind,name,status,siret,coach_id,commission_bps) VALUES('human_coach','Test business','EI','12345678900011',$1,2000) RETURNING id",
        [coach],
      )
    ).rows[0].id;
    taxes = coachingTaxes(auth.database, {
      cipher: secretCipherFromEnv({ SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=" }),
      permitted: async () => true,
      now: () => new Date("2027-01-15T12:00Z"),
    });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  it("encrypts fiscal identity at rest and exposes it only to the current business owner", async () => {
    expect(await taxes.saveIdentity(owner, seller, 2026, identity)).toBe(true);
    expect((await taxes.identity(owner, seller, 2026))?.identity.tin).toBe(identity.tin);
    expect(await taxes.identity(outsider, seller, 2026)).toBe(null);
    expect(await taxes.saveIdentity(outsider, seller, 2026, identity)).toBe(false);
    const raw = JSON.stringify((await auth.database.query("SELECT * FROM coaching_tax_identity")).rows);
    expect(raw).not.toContain(identity.tin);
    expect(raw).not.toContain(identity.iban);
  });
  it("refuses an encrypted identity whose fiscal year metadata was reassigned", async () => {
    await taxes.saveIdentity(owner, seller, 2026, identity);
    await auth.database.query("UPDATE coaching_tax_identity SET year=2027 WHERE seller_id=$1", [seller]);
    await expect(taxes.identity(owner, seller, 2027)).rejects.toThrow();
  });
  it("prepares one immutable annual snapshot with distinct credits and bank-remittance quarters", async () => {
    await taxes.saveIdentity(owner, seller, 2026, identity);
    const coach = (await auth.database.query("SELECT coach_id FROM coaching_seller WHERE id=$1", [seller])).rows[0].coach_id;
    const payment = crypto.randomUUID(),
      batch = crypto.randomUUID();
    await auth.database.query(
      `INSERT INTO coaching_connect_payment(id,candidate_id,coach_id,recipient_id,account_id,amount,currency,commission,payee_amount,request,sale_snapshot,created_at,payment_intent,paid_at) VALUES($1,$2,$3,$4,'acct_tax',10000,'eur',2000,8000,'{}',$5,'2026-03-01T12:00Z','pi_tax','2026-03-01T12:00Z')`,
      [payment, owner, coach, seller, JSON.stringify({ seller: { id: seller, kind: "human_coach", siret: identity.siret } })],
    );
    await auth.database.query("INSERT INTO coaching_connect_earning(payment_id,amount,commission) VALUES($1,10000,2000)", [payment]);
    await auth.database.query(
      `INSERT INTO coaching_connect_batch(id,seller_id,month,currency,amount,transfer_amount,account_id,created_at,state,paid_at) VALUES($1,$2,'2026-05','eur',8000,0,'acct_tax','2026-05-01T12:00Z','paid','2026-05-02T12:00Z')`,
      [batch, seller],
    );
    await auth.database.query("INSERT INTO coaching_connect_allocation(batch_id,payment_id,amount) VALUES($1,$2,8000)", [batch, payment]);
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=" });
    const annual = coachingTaxes(auth.database, {
      cipher,
      permitted: async () => true,
      now: () => new Date("2027-01-15T12:00Z"),
      facts: async (context) => {
        expect(context.accountId).toBe("acct_tax");
        return [{ id: payment, at: new Date("2026-03-01T12:00Z"), consideration: 8000, fees: 2000, activities: 1, currency: "eur" }];
      },
    });
    const operator = {
      legalName: "Test platform",
      tin: "123456789",
      platformName: "Jobbbox test",
      street: "1 rue Exemple",
      postalCode: "75001",
      city: "Paris",
    };
    // A future original resource is outside this return, even if its refund or identity cannot yet be reconciled.
    await auth.database.query(
      `INSERT INTO coaching_connect_payment(id,candidate_id,coach_id,recipient_id,account_id,amount,currency,commission,payee_amount,request,sale_snapshot,created_at,payment_intent,paid_at) VALUES($1,$2,$3,$4,'acct_future',10000,'eur',2000,8000,'{}',$5,'2027-01-02T12:00Z','pi_unresolved_future','2027-01-02T12:00Z')`,
      [crypto.randomUUID(), owner, coach, seller, JSON.stringify({ seller: { id: seller, kind: "human_coach", siret: "99999999900011" } })],
    );
    await auth.database.query(
      `INSERT INTO coaching_connect_batch(id,seller_id,month,currency,amount,transfer_amount,account_id,created_at,transfer_id) VALUES($1,$2,'2027-01','eur',8000,8000,'acct_future','2027-01-02T12:00Z','tr_unresolved_future')`,
      [crypto.randomUUID(), seller],
    );
    const first = await annual.prepare(2026, operator, owner),
      again = await annual.prepare(2026, operator, owner);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.document.id).toBe(first.document.id);
    expect(first.document.sellers[0]!.quarters[0]).toMatchObject({ consideration: 8000, fees: 2000, bankPayouts: 0 });
    expect(first.document.sellers[0]!.quarters[1]!.bankPayouts).toBe(8000);
    expect((await annual.annual(first.document.id))!.schemaValid).toBe(false);
    await auth.database.query("INSERT INTO coaching_connect_account(seller_id,account_id,created_at,owner_id) VALUES($1,'acct_tax',now(),$2)", [seller, owner]);
    const delivered: string[] = [];
    const copies = coachingTaxes(auth.database, {
      cipher,
      permitted: async () => false,
      sendCopy: async (notice) => {
        delivered.push(notice.to);
      },
    });
    await copies.deliverCopies();
    expect(delivered).toEqual([]);
    expect(await annual.sellerCopy(outsider, first.document.id, seller)).toBe(null);
    const closed = coachingTaxes(auth.database, { cipher, permitted: async () => false });
    expect((await closed.sellerCopy(owner, first.document.id, seller))?.year).toBe(2026);
    const validator = coachingTaxes(auth.database, { cipher, permitted: async () => true, validateXml: async (xml) => xml.includes("<dpi:PersonalServices>") });
    expect(await validator.validate(first.document.id)).toBe(true);
    expect((await annual.annual(first.document.id))!.schemaValid).toBe(true);
    await copies.deliverCopies();
    await copies.deliverCopies();
    expect(delivered).toEqual(["tax-owner@example.test"]);
    expect(JSON.stringify((await auth.database.query("SELECT * FROM coaching_tax_report")).rows)).not.toContain(identity.tin);
    await taxes.saveIdentity(owner, seller, 2026, { ...identity, city: "Lyon" });
    await expect(annual.prepare(2026, operator, owner, undefined, { replaceId: first.document.id, confirmedUnfiled: false })).rejects.toThrow("confirmation");
    const replacement = await annual.prepare(2026, operator, owner, undefined, { replaceId: first.document.id, confirmedUnfiled: true });
    expect(replacement.document.id).not.toBe(first.document.id);
    expect(replacement.document.sellers[0]!.identity.city).toBe("Lyon");
    expect((await annual.annual(first.document.id))!.supersededAt).not.toBe(null);
    expect((await annual.annual(first.document.id))!.document.sellers[0]!.identity.city).toBe("Paris");
    expect((await annual.reportsFor(owner, seller)).map((row) => row.id)).toEqual([replacement.document.id]);
    await expect(annual.prepare(2026, operator, owner, undefined, { replaceId: first.document.id, confirmedUnfiled: true })).rejects.toThrow("revision");
  });
  it("keeps revisions ordered at an identical clock and reuses a still-current identity", async () => {
    await taxes.saveIdentity(owner, seller, 2026, identity);
    await taxes.saveIdentity(owner, seller, 2026, { ...identity, city: "Lyon" });
    expect((await taxes.identity(owner, seller, 2026))?.identity.city).toBe("Lyon");
    expect(await taxes.saveIdentity(owner, seller, 2028, identity)).toBe(false);
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=" });
    const later = coachingTaxes(auth.database, { cipher, permitted: async () => true, now: () => new Date("2028-01-15T12:00Z") });
    expect(await later.ready(seller)).toBe(true);
    const expired = coachingTaxes(auth.database, { cipher, permitted: async () => true, now: () => new Date("2031-01-15T12:00Z") });
    expect(await expired.ready(seller)).toBe(false);
  });
  it("rotates fiscal encryption without changing the owned identity", async () => {
    await taxes.saveIdentity(owner, seller, 2026, identity);
    const key = "2:" + Buffer.alloc(32, 2).toString("base64"),
      first = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=";
    const rotation = coachingTaxes(auth.database, { cipher: secretCipherFromEnv({ SECRETS_MASTER_KEYS: first + "," + key }), permitted: async () => true });
    expect(await rotation.reencrypt()).toBe(1);
    const after = coachingTaxes(auth.database, { cipher: secretCipherFromEnv({ SECRETS_MASTER_KEYS: key }), permitted: async () => true });
    expect((await after.identity(owner, seller, 2026))?.identity.tin).toBe(identity.tin);
  });
  it("includes actual Jobbbox-funded compensation, without reporting Jobbbox retail gross as Coach income", async () => {
    await taxes.saveIdentity(owner, seller, 2026, identity);
    const coach = (await auth.database.query("SELECT coach_id FROM coaching_seller WHERE id=$1", [seller])).rows[0].coach_id,
      payment = crypto.randomUUID(),
      batch = crypto.randomUUID();
    await auth.database.query(
      `INSERT INTO coaching_connect_payment(id,candidate_id,coach_id,recipient_id,account_id,amount,currency,commission,payee_amount,request,sale_snapshot,payee_snapshot,created_at,payment_intent,paid_at) VALUES($1,$2,$3,$4,NULL,12000,'eur',0,4000,'{}',$5,$6,'2026-03-01T12:00Z','pi_platform','2026-03-01T12:00Z')`,
      [payment, owner, coach, seller, JSON.stringify({ seller: { kind: "jobbbox", name: "Jobbbox" } }), JSON.stringify({ id: seller, siret: identity.siret })],
    );
    await auth.database.query("INSERT INTO coaching_connect_earning(payment_id,amount,commission) VALUES($1,4000,0)", [payment]);
    await auth.database.query(
      `INSERT INTO coaching_connect_batch(id,seller_id,month,currency,amount,transfer_amount,account_id,created_at,transfer_id,state,paid_at) VALUES($1,$2,'2026-05','eur',4000,4000,'acct_platform','2026-05-01T12:00Z','tr_platform','paid','2026-05-02T12:00Z')`,
      [batch, seller],
    );
    await auth.database.query("INSERT INTO coaching_connect_allocation(batch_id,payment_id,amount) VALUES($1,$2,4000)", [batch, payment]);
    const annual = coachingTaxes(auth.database, {
      cipher: secretCipherFromEnv({ SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=" }),
      permitted: async () => true,
      now: () => new Date("2027-01-15T12:00Z"),
      facts: async () => {
        throw Error("Retail charge is not a Coach receipt");
      },
      platformFacts: async (transfer) => [
        {
          id: transfer.id,
          at: new Date("2026-05-01T12:00Z"),
          consideration: transfer.amount,
          fees: 0,
          activities: transfer.activities,
          currency: transfer.currency,
        },
      ],
    });
    const result = await annual.prepare(
      2026,
      { legalName: "Test platform", tin: "123456789", platformName: "Jobbbox test", street: "1 rue Exemple", postalCode: "75001", city: "Paris" },
      owner,
    );
    expect(result.document.sellers[0]!.quarters[1]).toMatchObject({ consideration: 4000, bankPayouts: 4000, activities: 1 });
  });
});
