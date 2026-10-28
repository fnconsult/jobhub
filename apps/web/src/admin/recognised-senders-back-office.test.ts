import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateEmailIntake } from "../email-intake";
import { createRecognisedSenderList, type RecognisedSenderList } from "../email-intake/recognised-sender-list";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createRecognisedSendersBackOffice, type RecognisedSendersBackOffice } from "./recognised-senders-back-office";

describe.skipIf(!connectionString)("the Recognised senders' Back Office writes and their Back Office Audit (#448; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let senders: RecognisedSenderList;
  let changes: RecognisedSendersBackOffice;
  let claire: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateEmailIntake(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    senders = createRecognisedSenderList(database);
    changes = createRecognisedSendersBackOffice(senders, backOffice);
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const entries = async () => (await backOffice.journal()).reverse().map(({ section, target, action, before, after }) => ({ section, target, action, before, after }));

  it("adding, relabelling, switching and removing a sender each record one entry, its label and state before and after", async () => {
    expect(await changes.add(claire, { sender: "alertes.monster.fr", label: "Monster – monster.fr" })).toMatchObject({ ok: true });
    expect(await changes.update(claire, "alertes.monster.fr", { label: "Monster – www.monster.fr" })).toEqual({ ok: true });
    expect(await changes.update(claire, "alertes.monster.fr", { enabled: false })).toEqual({ ok: true });
    expect(await changes.remove(claire, "alertes.monster.fr")).toBe(true);

    expect(await entries()).toEqual([
      { section: "recognised_senders", target: "alertes.monster.fr", action: "added", before: null, after: { label: "Monster – monster.fr", enabled: true } },
      { section: "recognised_senders", target: "alertes.monster.fr", action: "updated", before: { label: "Monster – monster.fr", enabled: true }, after: { label: "Monster – www.monster.fr", enabled: true } },
      { section: "recognised_senders", target: "alertes.monster.fr", action: "updated", before: { label: "Monster – www.monster.fr", enabled: true }, after: { label: "Monster – www.monster.fr", enabled: false } },
      { section: "recognised_senders", target: "alertes.monster.fr", action: "removed", before: { label: "Monster – www.monster.fr", enabled: false }, after: null },
    ]);
    expect((await backOffice.journal())[0]?.actor).toEqual({ candidateId: claire.id, email: "claire@jobbbox.fr" });
  });

  it("a refused write records nothing", async () => {
    expect(await changes.add(claire, { sender: "cadremploi.fr", label: "Cadremploi – cadremploi.fr" })).toEqual({ ok: false, error: "exists" });
    expect(await changes.add(claire, { sender: "nope", label: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(await changes.update(claire, "unknown.fr", { enabled: false })).toEqual({ ok: false, error: "not_found" });
    expect(await changes.remove(claire, "unknown.fr")).toBe(false);

    expect(await entries()).toEqual([]);
  });
});
