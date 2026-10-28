import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateEmailIntake } from "./index";
import { createRecognisedSenderList, type RecognisedSenderList } from "./recognised-sender-list";
import { SEEDED_RECOGNISED_SENDERS } from "./recognised-senders";

describe.skipIf(!connectionString)("Email intake: the platform's Recognised senders, kept on the Email intake sheet (#448; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let senders: RecognisedSenderList;
  let now: Date;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  /** A Candidate's own Recognised sender (#450 adds them from the Candidate's side): what « Expéditeurs proposés » is made of. */
  async function addedByCandidate(candidateId: string, value: string, addedAt: Date) {
    await database.query(
      `INSERT INTO candidate_recognised_sender (candidate_id, match, value, label, added_at) VALUES ($1, $2, $3, 'Mon alerte', $4)`,
      [candidateId, value.includes("@") ? "address" : "domain", value, addedAt],
    );
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEmailIntake(database);
    now = new Date("2026-10-28T09:00:00Z");
    senders = createRecognisedSenderList(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("lists the seeded senders, enabled, by label", async () => {
    const listed = await senders.list();

    expect(listed.map((sender) => sender.value).sort()).toEqual(SEEDED_RECOGNISED_SENDERS.map((sender) => sender.value).sort());
    expect(listed.every((sender) => sender.enabled)).toBe(true);
    expect(listed.map((sender) => sender.label)).toEqual([...listed.map((sender) => sender.label)].sort((a, b) => a.localeCompare(b, "fr")));
    expect(listed.find((sender) => sender.value === "diffusion.apec.fr")).toEqual({ match: "domain", value: "diffusion.apec.fr", label: "APEC – apec.fr", aligned: true, enabled: true });
  });

  it("adds a sender by its domain, or by its full address on a shared sending platform, with its label", async () => {
    expect(await senders.add({ sender: " Alertes.Monster.FR ", label: "Monster – monster.fr" })).toEqual({
      ok: true,
      sender: { match: "domain", value: "alertes.monster.fr", label: "Monster – monster.fr", aligned: false, enabled: true },
    });
    expect(await senders.add({ sender: "Thales-JobNotification@noreply5.jobs2web.com", label: "Thales – careers.thalesgroup.com" })).toMatchObject({
      ok: true,
      sender: { match: "address", value: "thales-jobnotification@noreply5.jobs2web.com" },
    });
    expect((await senders.list()).map((sender) => sender.value)).toEqual(expect.arrayContaining(["alertes.monster.fr", "thales-jobnotification@noreply5.jobs2web.com"]));
  });

  it.each([
    [{ sender: "monster", label: "Monster – monster.fr" }, "invalid"],
    [{ sender: "not an address@x", label: "X – x.fr" }, "invalid"],
    [{ sender: "monster.fr", label: "  " }, "invalid"],
    [{ sender: "monster.fr", label: "x".repeat(121) }, "invalid"],
    [null, "invalid"],
    [{ sender: "cadremploi.fr", label: "Cadremploi – cadremploi.fr" }, "exists"],
  ])("refuses %j: %s", async (input, error) => {
    expect(await senders.add(input)).toEqual({ ok: false, error });
  });

  it("relabels, disables and enables a sender, answering it as it was", async () => {
    expect(await senders.update("cadremploi.fr", { label: "Cadremploi – www.cadremploi.fr" })).toEqual({
      ok: true,
      before: { match: "domain", value: "cadremploi.fr", label: "Cadremploi – cadremploi.fr", aligned: false, enabled: true },
      after: { match: "domain", value: "cadremploi.fr", label: "Cadremploi – www.cadremploi.fr", aligned: false, enabled: true },
    });
    expect(await senders.update("cadremploi.fr", { enabled: false })).toMatchObject({ ok: true, before: { enabled: true }, after: { enabled: false } });
    expect((await senders.list()).find((sender) => sender.value === "cadremploi.fr")).toMatchObject({ enabled: false });

    expect(await senders.update("unknown.fr", { enabled: false })).toEqual({ ok: false, error: "not_found" });
    expect(await senders.update("cadremploi.fr", { label: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await senders.update("cadremploi.fr", {})).toEqual({ ok: false, error: "invalid" });
  });

  it("reads only the enabled ones when an email arrives", async () => {
    await senders.update("cadremploi.fr", { enabled: false });

    const read = (await senders.enabled()).map((sender) => sender.value);

    expect(read).not.toContain("cadremploi.fr");
    expect(read).toContain("hellowork.com");
  });

  it("removes a sender; it stays removed when Email intake is migrated again", async () => {
    expect(await senders.remove("jobijoba.com")).toMatchObject({ value: "jobijoba.com", label: "Jobijoba – jobijoba.com" });
    expect(await senders.remove("jobijoba.com")).toBeNull();

    await migrateEmailIntake(database);

    expect((await senders.list()).map((sender) => sender.value)).not.toContain("jobijoba.com");
  });

  describe("« Expéditeurs proposés »: the senders Candidates added for themselves", () => {
    it("are counted per sender, with no Candidate named, and when one was last added; those already on the platform's list are not proposed", async () => {
      const [marie, jean] = [await candidate("marie.dupont@example.fr"), await candidate("jean.martin@example.fr")];
      await addedByCandidate(marie, "alertes.monster.fr", new Date("2026-10-20T08:00:00Z"));
      await addedByCandidate(jean, "alertes.monster.fr", now);
      await addedByCandidate(jean, "thales-jobnotification@noreply5.jobs2web.com", new Date("2026-10-25T08:00:00Z"));
      await addedByCandidate(marie, "hellowork.com", now);

      expect(await senders.proposed()).toEqual([
        { match: "domain", value: "alertes.monster.fr", candidates: 2, lastAddedAt: now },
        { match: "address", value: "thales-jobnotification@noreply5.jobs2web.com", candidates: 1, lastAddedAt: new Date("2026-10-25T08:00:00Z") },
      ]);
      expect(JSON.stringify(await senders.proposed())).not.toMatch(/marie|jean|Mon alerte/);
    });

    it("accepted with a label, one joins the platform's list and is no longer proposed", async () => {
      const marie = await candidate("marie.dupont@example.fr");
      await addedByCandidate(marie, "alertes.monster.fr", now);

      expect(await senders.add({ sender: "alertes.monster.fr", label: "Monster – monster.fr" })).toMatchObject({ ok: true });

      expect(await senders.proposed()).toEqual([]);
    });
  });
});
