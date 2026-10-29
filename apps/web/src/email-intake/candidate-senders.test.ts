import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCandidateSenders, MAX_CANDIDATE_SENDERS, recognisedSendersFor, type CandidateSenders } from "./candidate-senders";
import { emailIntakeOf, migrateEmailIntake } from "./index";
import { createRecognisedSenderList, type RecognisedSenderList } from "./recognised-sender-list";

describe.skipIf(!connectionString)("Email intake: the Recognised senders a Candidate adds or switches off for themselves (#450; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let senders: CandidateSenders;
  let platform: RecognisedSenderList;
  let now: Date;
  let marie: string;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }
  const readFor = async (candidateId: string) => (await recognisedSendersFor(database, candidateId)).map((sender) => sender.value);

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEmailIntake(database);
    await migrateEmailIntake(database); // safe to run twice
    now = new Date("2026-10-29T09:00:00Z");
    senders = createCandidateSenders(database, { now: () => now });
    platform = createRecognisedSenderList(database);
    marie = await candidate("marie.dupont@example.fr");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("adding one", () => {
    it("keeps the sending address's domain, with the Candidate's label, for them alone", async () => {
      const jean = await candidate("jean.martin@example.fr");

      expect(await senders.add(marie, { sender: " Alertes@Mail.Monster.FR ", label: "  Mes alertes   Monster " })).toEqual({
        ok: true,
        sender: { match: "domain", value: "mail.monster.fr", label: "Mes alertes Monster", addedAt: now },
      });

      expect(await readFor(marie)).toContain("mail.monster.fr");
      expect(await readFor(jean)).not.toContain("mail.monster.fr");
      expect((await senders.list(marie)).own).toEqual([{ match: "domain", value: "mail.monster.fr", label: "Mes alertes Monster", addedAt: now }]);
    });

    it("keeps the full address on a shared sending platform, and refuses that platform's domain alone", async () => {
      expect(await senders.add(marie, { sender: "Thales-JobNotification@noreply5.jobs2web.com" })).toMatchObject({
        ok: true,
        sender: { match: "address", value: "thales-jobnotification@noreply5.jobs2web.com", label: "thales-jobnotification@noreply5.jobs2web.com" },
      });
      expect(await senders.add(marie, { sender: "noreply5.jobs2web.com" })).toEqual({ ok: false, error: "address_needed" });
    });

    it.each([[{ sender: "monster" }], [{ sender: "not an address@" }], [{}], [null], [{ sender: "monster.fr", label: "x".repeat(121) }], [{ sender: "monster.fr", label: 3 }]])(
      "refuses %j as invalid",
      async (input) => {
        expect(await senders.add(marie, input)).toEqual({ ok: false, error: "invalid" });
      },
    );

    it("answers « already recognised » for a sender the platform's list already reads, and keeps nothing", async () => {
      expect(await senders.add(marie, { sender: "offres@alertes.cadremploi.fr" })).toEqual({ ok: false, error: "already_recognised" });
      expect(await senders.add(marie, { sender: "capgemitecp3-jobnotification@noreply12.jobs2web.com" })).toEqual({ ok: false, error: "already_recognised" });
      expect((await senders.list(marie)).own).toEqual([]);
    });

    it("may add one an Administrator disabled: it stays recognised for them", async () => {
      await platform.update("cadremploi.fr", { enabled: false });

      expect(await senders.add(marie, { sender: "cadremploi.fr" })).toMatchObject({ ok: true });
      expect(await readFor(marie)).toContain("cadremploi.fr");
    });

    it("adding the same one twice keeps the first; past MAX_CANDIDATE_SENDERS, refuses", async () => {
      await senders.add(marie, { sender: "monster.fr", label: "Monster" });
      expect(await senders.add(marie, { sender: "monster.fr", label: "Autre" })).toMatchObject({ ok: true, sender: { label: "Monster" } });

      for (let index = 1; index < MAX_CANDIDATE_SENDERS; index++) await senders.add(marie, { sender: `site${index}.example.test` });
      expect(await senders.add(marie, { sender: "one-too-many.example.test" })).toEqual({ ok: false, error: "too_many" });
    });

    it("removes one they added; it is no longer read for them", async () => {
      await senders.add(marie, { sender: "monster.fr" });

      await senders.remove(marie, "MONSTER.fr");

      expect((await senders.list(marie)).own).toEqual([]);
      expect(await readFor(marie)).not.toContain("monster.fr");
    });
  });

  describe("the platform's senders", () => {
    it("switches one off for the Candidate alone, and back on", async () => {
      const jean = await candidate("jean.martin@example.fr");

      expect(await senders.switchPlatformSender(marie, "linkedin.com", false)).toBe(true);
      expect(await senders.switchPlatformSender(marie, "linkedin.com", false)).toBe(true);

      expect(await readFor(marie)).not.toContain("linkedin.com");
      expect(await readFor(jean)).toContain("linkedin.com");
      expect((await senders.list(marie)).platform.find((sender) => sender.value === "linkedin.com")).toEqual({
        match: "domain",
        value: "linkedin.com",
        label: "LinkedIn – linkedin.com",
        switchedOff: true,
      });

      expect(await senders.switchPlatformSender(marie, "linkedin.com", true)).toBe(true);
      expect(await readFor(marie)).toContain("linkedin.com");
    });

    it("lists only the enabled ones, and switches off none that is not one", async () => {
      await platform.update("indeed.com", { enabled: false });

      expect((await senders.list(marie)).platform.map((sender) => sender.value)).not.toContain("indeed.com");
      expect(await senders.switchPlatformSender(marie, "indeed.com", false)).toBe(false);
      expect(await senders.switchPlatformSender(marie, "nowhere.example.test", false)).toBe(false);
    });
  });

  describe("« Expéditeurs proposés »", () => {
    it("the proposal shows a count and no Candidate; accepting it makes it recognised for all", async () => {
      const jean = await candidate("jean.martin@example.fr");
      const paul = await candidate("paul.durand@example.fr");
      await senders.add(marie, { sender: "alertes@mail.monster.fr", label: "Marie's Monster" });
      now = new Date("2026-10-29T10:00:00Z");
      await senders.add(jean, { sender: "mail.monster.fr", label: "Jean's Monster" });

      const proposed = await platform.proposed();
      expect(proposed).toEqual([{ match: "domain", value: "mail.monster.fr", candidates: 2, lastAddedAt: now }]);
      expect(JSON.stringify(proposed)).not.toMatch(new RegExp(`${marie}|${jean}|Marie|Jean`));
      expect(await readFor(paul)).not.toContain("mail.monster.fr");

      // An Administrator accepts it: it is added to the platform's list, with its label.
      expect(await platform.add({ sender: "mail.monster.fr", label: "Monster – monster.fr" })).toMatchObject({ ok: true });

      expect(await readFor(paul)).toContain("mail.monster.fr");
      expect(await platform.proposed()).toEqual([]);
    });

    it("a refused one (never added) stays recognised for those who added it", async () => {
      await senders.add(marie, { sender: "mail.monster.fr" });

      expect(await platform.proposed()).toHaveLength(1);
      expect(await readFor(marie)).toContain("mail.monster.fr");
    });
  });

  it("goes with the Candidate's Data export, and away with their account", async () => {
    await senders.add(marie, { sender: "mail.monster.fr", label: "Monster" });
    await senders.switchPlatformSender(marie, "linkedin.com", false);

    const exported = await emailIntakeOf(database, marie);
    expect(exported.recognisedSenders).toEqual([{ match: "domain", value: "mail.monster.fr", label: "Monster", addedAt: now }]);
    expect(exported.switchedOffSenders).toEqual([{ value: "linkedin.com", switchedOffAt: now }]);

    await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);
    expect((await database.query(`SELECT 1 FROM candidate_recognised_sender UNION ALL SELECT 1 FROM candidate_switched_off_sender`)).rows).toEqual([]);
  });
});
