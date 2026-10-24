import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createUnansweredQuestions, migrateUnansweredQuestions, type UnansweredQuestions } from "../unanswered-questions";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createUnansweredQuestionsBackOffice, type UnansweredQuestionsBackOffice } from "./unanswered-questions-back-office";

describe.skipIf(!connectionString)("« Questions sans réponse »: a Help editor's marks and their Back Office Audit (#344; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let questions: UnansweredQuestions;
  let changes: UnansweredQuestionsBackOffice;
  let claire: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateUnansweredQuestions(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, { billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused }, humanCoaches: { add: unused, retire: unused } });
    questions = createUnansweredQuestions(database, { identityOf: async () => null });
    changes = createUnansweredQuestionsBackOffice(questions, backOffice);
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
    for (const question of ["Où est passé le bouton vert ?", "Puis-je imprimer en noir et blanc ?"]) {
      await questions.notice("marie", { question, reply: { text: "Réponse du coach.", outcome: "replied", aboutJobbbox: true }, route: "/", language: "fr" });
    }
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("« Article écrit » and « Écarter » each record which question (its id), its status before and after, and who", async () => {
    const [button, print] = await questions.open();

    expect(await changes.mark(claire, button!.id, "written")).toBe(true);
    expect(await changes.mark(claire, print!.id, "dismissed")).toBe(true);

    expect(await questions.open()).toEqual([]);
    expect((await backOffice.journal()).reverse()).toEqual([
      expect.objectContaining({
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "unanswered_questions",
        target: button!.id,
        action: "updated",
        before: { status: "open" },
        after: { status: "written" },
        outcome: "succeeded",
      }),
      expect.objectContaining({ section: "unanswered_questions", target: print!.id, before: { status: "open" }, after: { status: "dismissed" } }),
    ]);
  });

  it("keeps none of the Candidate's words in the Back Office Audit, which outlives the question by years", async () => {
    for (const { id } of await questions.open()) await changes.mark(claire, id, "dismissed");

    const recorded = JSON.stringify(await backOffice.journal());
    expect(recorded).toContain("dismissed");
    for (const words of ["bouton vert", "noir et blanc", "Réponse du coach"]) expect(recorded).not.toContain(words);
  });

  it("records nothing for one already marked, unknown, or a mark that is not one", async () => {
    const [button] = await questions.open();
    await changes.mark(claire, button!.id, "written");

    expect(await changes.mark(claire, button!.id, "dismissed")).toBe(false);
    expect(await changes.mark(claire, "00000000-0000-4000-8000-000000000000", "written")).toBe(false);
    expect(await changes.mark(claire, button!.id, "open")).toBe(false);
    expect(await backOffice.journal()).toHaveLength(1);
  });
});
