import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateBilling } from "../billing";
import { createSignalements, migrateSignalements, type Signalements, type SendingContext } from "../signalements";
import { backOfficeAccess } from "./access";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createSignalementsBackOffice, type SignalementsBackOffice } from "./signalements-back-office";

const FROM_CHROME: SendingContext = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36",
  interfaceLanguage: "fr",
};
const BUG = { type: "bug", message: "Le bouton « Enregistrer » ne fait rien sur ma lettre.", path: "/candidatures", textSize: "large" };
const IDEE = { type: "idee", message: "Pouvoir trier mes candidatures par date de relance.", path: "/candidatures", textSize: "standard" };
const QUESTION = {
  type: "question",
  message: "L'aide ne m'a pas dit comment changer mon offre.",
  path: "/compte",
  textSize: "standard",
  attachedQuestion: "Comment passer à l'offre Standard ?",
  attachedCoachReply: "Je ne trouve pas d'article sur ce point.",
};

const support = backOfficeAccess(["support"]);
const superAdmin = backOfficeAccess(["super-admin"]);
const helpEditor = backOfficeAccess(["help-editor"]);

describe.skipIf(!connectionString)("« Signalements » in the Back Office: Support triages, statuses, reply, and their Back Office Audit (#376; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let now: Date;
  let signalements: Signalements;
  let backOffice: BackOffice;
  let triage: SignalementsBackOffice;
  let sophie: BackOfficeActor;
  let marie: string;
  let paul: string;

  async function candidate(email: string): Promise<{ id: string; email: string }> {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id, email: user.email };
  }

  /** Sends `sent` for `candidateId` at `at`. */
  async function sent(candidateId: string, body: Record<string, unknown>, at: string): Promise<string> {
    now = new Date(at);
    const done = await signalements.send(candidateId, body, FROM_CHROME);
    if (!done.ok) throw new Error(`not sent: ${JSON.stringify(done)}`);
    return done.signalement.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateBilling(database);
    await migrateSignalements(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    now = new Date("2026-10-25T09:00:00Z");
    signalements = createSignalements(database, { version: "35e2ea1", now: () => now });
    triage = createSignalementsBackOffice(signalements, backOffice);
    sophie = await candidate("sophie@jobbbox.fr");
    marie = (await candidate("marie.dupont@example.fr")).id;
    paul = (await candidate("paul.martin@example.fr")).id;
    await database.query(`INSERT INTO candidate_plan (candidate_id, plan) VALUES ($1, 'standard')`, [paul]);
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("the list", () => {
    it("shows those « à traiter » (nouveau and vu) by default, oldest first, each with its context and the Candidate's email and Plan", async () => {
      const newest = await sent(marie, BUG, "2026-10-25T09:00:00Z");
      const oldest = await sent(paul, IDEE, "2026-10-23T09:00:00Z");
      const handled = await sent(marie, BUG, "2026-10-22T09:00:00Z");
      const seen = await sent(marie, QUESTION, "2026-10-24T09:00:00Z");
      await signalements.changeStatus(handled, "traite");
      await signalements.changeStatus(seen, "vu");

      const listed = await triage.list(support);

      expect(listed.map((each) => each.id)).toEqual([oldest, seen, newest]);
      expect(listed[0]).toEqual({
        id: oldest,
        type: "idee",
        message: IDEE.message,
        attachedQuestion: null,
        attachedCoachReply: null,
        context: { path: "/candidatures", version: "35e2ea1", browser: "Chrome 141, Mac", interfaceLanguage: "fr", textSize: "standard" },
        status: "nouveau",
        statusChangedAt: null,
        reply: null,
        repliedAt: null,
        replyUpdatedAt: null,
        createdAt: new Date("2026-10-23T09:00:00Z"),
        candidate: { email: "paul.martin@example.fr", plan: "standard" },
      });
      expect(listed[2]!.candidate).toEqual({ email: "marie.dupont@example.fr", plan: "free" });
    });

    it("filters on type and on status", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");
      const idee = await sent(marie, IDEE, "2026-10-22T09:00:00Z");
      const question = await sent(marie, QUESTION, "2026-10-23T09:00:00Z");
      await signalements.changeStatus(bug, "traite");

      expect((await triage.list(support, { type: "idee" })).map((each) => each.id)).toEqual([idee]);
      expect((await triage.list(support, { type: "bug" })).map((each) => each.id)).toEqual([]);
      expect((await triage.list(support, { type: "bug", statuses: ["traite"] })).map((each) => each.id)).toEqual([bug]);
      expect((await triage.list(superAdmin, { statuses: ["nouveau", "vu", "traite"] })).map((each) => each.id)).toEqual([bug, idee, question]);
    });

    it("shows a Help editor the Questions alone, without the Candidate's email or Plan, and opens no Bug or Idée for them", async () => {
      const bug = await sent(paul, BUG, "2026-10-21T09:00:00Z");
      const idee = await sent(paul, IDEE, "2026-10-21T10:00:00Z");
      const question = await sent(paul, QUESTION, "2026-10-22T09:00:00Z");

      const listed = await triage.list(helpEditor);
      expect(listed.map((each) => [each.id, each.type, each.candidate])).toEqual([[question, "question", null]]);
      expect(await triage.list(helpEditor, { type: "bug" })).toEqual([]);
      expect(await triage.open(helpEditor, bug)).toBeNull();
      expect(await triage.open(helpEditor, idee)).toBeNull();
      expect(JSON.stringify(await triage.open(helpEditor, question))).not.toContain("paul.martin@example.fr");
      expect(JSON.stringify(listed)).not.toContain('"plan"');
    });

    it("shows another role nothing", async () => {
      const bug = await sent(paul, BUG, "2026-10-21T09:00:00Z");

      expect(await triage.list(backOfficeAccess(["plans-manager"]))).toEqual([]);
      expect(await triage.open(backOfficeAccess(["coach-manager"]), bug)).toBeNull();
    });

    it("opens one in full, a Question with its attached question and coach reply, and changes nothing", async () => {
      const question = await sent(paul, QUESTION, "2026-10-22T09:00:00Z");

      expect(await triage.open(support, question)).toMatchObject({
        message: QUESTION.message,
        attachedQuestion: QUESTION.attachedQuestion,
        attachedCoachReply: QUESTION.attachedCoachReply,
        status: "nouveau",
        statusChangedAt: null,
        candidate: { email: "paul.martin@example.fr", plan: "standard" },
      });
      expect((await triage.open(support, question))!.status).toBe("nouveau");
      expect(await triage.open(support, "00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await triage.open(support, "pas-un-id")).toBeNull();
      expect(await backOffice.journal()).toEqual([]);
    });

    it("counts those « à traiter »: as many as the default list holds", async () => {
      expect(await signalements.countToHandle()).toBe(0);
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");
      const idee = await sent(marie, IDEE, "2026-10-22T09:00:00Z");
      await sent(paul, QUESTION, "2026-10-23T09:00:00Z");
      await signalements.changeStatus(bug, "traite");
      await signalements.changeStatus(idee, "vu");

      expect(await signalements.countToHandle()).toBe(2);
      expect(await signalements.countToHandle()).toBe((await triage.list(support)).length);
    });
  });

  describe("statuses", () => {
    it("go nouveau, vu, traité in any direction, each recorded by the Signalement's id with its status before and after", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");
      now = new Date("2026-10-25T10:00:00Z");

      expect(await triage.changeStatus(sophie, bug, "vu")).toMatchObject({ ok: true, signalement: { status: "vu", statusChangedAt: now } });
      expect(await triage.changeStatus(sophie, bug, "traite")).toMatchObject({ ok: true, signalement: { status: "traite" } });
      expect(await triage.changeStatus(sophie, bug, "nouveau")).toMatchObject({ ok: true, signalement: { status: "nouveau" } });

      expect((await backOffice.journal()).reverse()).toEqual([
        expect.objectContaining({
          actor: { candidateId: sophie.id, email: "sophie@jobbbox.fr" },
          section: "signalements",
          target: bug,
          action: "updated",
          before: { status: "nouveau" },
          after: { status: "vu" },
          outcome: "succeeded",
        }),
        expect.objectContaining({ target: bug, before: { status: "vu" }, after: { status: "traite" } }),
        expect.objectContaining({ target: bug, before: { status: "traite" }, after: { status: "nouveau" } }),
      ]);
    });

    it("mark a Bug or an Idée « traité » without a reply", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");
      const idee = await sent(marie, IDEE, "2026-10-21T10:00:00Z");

      expect(await triage.changeStatus(sophie, bug, "traite")).toMatchObject({ ok: true, signalement: { status: "traite", reply: null } });
      expect(await triage.changeStatus(sophie, idee, "traite")).toMatchObject({ ok: true, signalement: { status: "traite", reply: null } });
    });

    it("refuse to mark a Question « traité » before it is replied to, and record the refused attempt", async () => {
      const question = await sent(marie, QUESTION, "2026-10-21T09:00:00Z");

      expect(await triage.changeStatus(sophie, question, "traite")).toEqual({ ok: false, error: "reply_required" });
      expect((await triage.open(support, question))!.status).toBe("nouveau");
      expect(await backOffice.journal()).toEqual([
        expect.objectContaining({
          section: "signalements",
          target: question,
          action: "refused",
          outcome: "failed",
          failure: { reason: "reply_required", tried: "updated", field: "status", technical: null },
        }),
      ]);

      await triage.reply(sophie, question, "Rendez-vous dans Mon compte, rubrique Offre : le bouton « Changer d'offre » y est.");
      expect(await triage.changeStatus(sophie, question, "traite")).toMatchObject({ ok: true, signalement: { status: "traite" } });
    });

    it("record nothing for the same status, an unknown Signalement or a status that is not one", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");

      expect(await triage.changeStatus(sophie, bug, "nouveau")).toMatchObject({ ok: true, signalement: { status: "nouveau" } });
      expect(await triage.changeStatus(sophie, "00000000-0000-4000-8000-000000000000", "vu")).toEqual({ ok: false, error: "not_found" });
      expect(await triage.changeStatus(sophie, bug, "supprime")).toEqual({ ok: false, error: "not_found" });
      expect(await backOffice.journal()).toEqual([]);
    });
  });

  describe("the reply", () => {
    const REPLY = "Merci, c'est corrigé dans la prochaine version.";

    it("is one per Signalement, written then changed until it is « traité », each recorded as written or changed", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");
      now = new Date("2026-10-25T10:00:00Z");

      expect(await triage.reply(sophie, bug, `  ${REPLY}  `)).toMatchObject({ ok: true, signalement: { reply: REPLY, replyUpdatedAt: now } });
      expect(await triage.reply(sophie, bug, "Merci, c'est corrigé.")).toMatchObject({ ok: true, signalement: { reply: "Merci, c'est corrigé." } });
      expect((await backOffice.journal()).reverse()).toEqual([
        expect.objectContaining({ section: "signalements", target: bug, action: "updated", before: { reply: "none" }, after: { reply: "written" }, outcome: "succeeded" }),
        expect.objectContaining({ section: "signalements", target: bug, action: "updated", before: { reply: "written" }, after: { reply: "changed" } }),
      ]);
    });

    it("can no longer be changed once « traité »: refused and recorded", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");
      await triage.reply(sophie, bug, REPLY);
      await triage.changeStatus(sophie, bug, "traite");

      expect(await triage.reply(sophie, bug, "Autre chose.")).toEqual({ ok: false, error: "already_handled" });
      expect((await triage.open(support, bug))!.reply).toBe(REPLY);
      expect((await backOffice.journal())[0]).toMatchObject({
        target: bug,
        action: "refused",
        failure: { reason: "already_handled", tried: "updated", field: "reply" },
      });
    });

    it("is at most 2,000 characters; empty or too long it is only shown on the page, not recorded", async () => {
      const bug = await sent(marie, BUG, "2026-10-21T09:00:00Z");

      expect(await triage.reply(sophie, bug, "x".repeat(2_001))).toEqual({ ok: false, errors: [{ field: "reply", code: "too_long" }] });
      expect(await triage.reply(sophie, bug, "   ")).toEqual({ ok: false, errors: [{ field: "reply", code: "required" }] });
      expect(await triage.reply(sophie, bug, "x".repeat(2_000))).toMatchObject({ ok: true });
      expect(await triage.reply(sophie, "00000000-0000-4000-8000-000000000000", REPLY)).toEqual({ ok: false, error: "not_found" });
      expect(await backOffice.journal()).toHaveLength(1);
    });
  });

  it("keeps ids and statuses in the Back Office Audit, never the message's or the reply's words", async () => {
    const question = await sent(marie, QUESTION, "2026-10-21T09:00:00Z");
    await triage.changeStatus(sophie, question, "vu");
    await triage.changeStatus(sophie, question, "traite");
    await triage.reply(sophie, question, "Rendez-vous dans Mon compte, rubrique Offre.");
    await triage.reply(sophie, question, "Rendez-vous dans Mon compte, rubrique Abonnement.");
    await triage.changeStatus(sophie, question, "traite");
    await triage.reply(sophie, question, "Trop tard pour changer ceci.");

    const recorded = JSON.stringify(await backOffice.journal());
    expect(recorded).toContain(question);
    for (const words of ["changer mon offre", "offre Standard", "article sur ce point", "Mon compte", "Abonnement", "Trop tard", "marie.dupont"]) {
      expect(recorded).not.toContain(words);
    }
  });
});
