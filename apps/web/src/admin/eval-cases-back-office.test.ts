import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCoachingPlaybooks, migrateCoachingPlaybooks } from "../coaching-playbooks";
import { createEvals, migrateEvals, type Evals } from "../evals";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createEvalCasesBackOffice, type EvalCasesBackOffice } from "./eval-cases-back-office";

const SOURCES = "| ID | Titre | Auteur | Année | URL | Licence |\n|--|--|--|--|--|--|\n| S1 | Étude | Apec | 2026 | https://apec.fr | publique |";
const agent = { provider: "mistral" as const, model: "mistral-medium-3-5", effort: "medium" as const, consultWhen: "Quand le candidat prépare un entretien." };
const CASE = {
  title: "Prépare un entretien",
  context: "Le candidat s'appelle Paul (prénom seulement).",
  message: "Comment préparer mon entretien ?",
  inViewKind: "",
  inViewText: "",
  criteria: "Trois exemples chiffrés.",
};

describe.skipIf(!connectionString)("Eval Cases' Back Office writes and their Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let evals: Evals;
  let changes: EvalCasesBackOffice;
  let claire: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateCoachingPlaybooks(database, () => ({ sources: SOURCES, coreDigest: "# Socle [S1]", playbooks: [{ id: "interview-psychology", content: "# Entretiens [S1]", agent }], tasks: [] }));
    await migrateEvals(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: { coaching: "mistral" }, usage: createMemoryUsageLog() });
    const playbooks = createCoachingPlaybooks(database, { serving: "latest", agentModels: () => [], evalRunOn: async () => true });
    evals = createEvals(database, { ai, playbooks, guardrails: { current: unused } });
    changes = createEvalCasesBackOffice(evals, backOffice);
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const entries = async () => (await backOffice.journal({ section: "eval_cases" })).reverse().map(({ actor: { email }, target, action, before, after }) => ({ email, target, action, before, after }));

  it("records every change to a Coaching Playbook's Eval Cases, with the case before and after; refused or unchanged ones record nothing", async () => {
    const added = await changes.addCase(claire, "interview-psychology", CASE);
    if (!added.ok) throw new Error(added.error);
    expect(await changes.addCase(claire, "interview-psychology", { ...CASE, title: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await changes.saveCase(claire, "interview-psychology", added.evalCase.id, CASE)).toEqual({ ok: false, error: "unchanged" });
    expect(await changes.saveCase(claire, "interview-psychology", added.evalCase.id, { ...CASE, inViewKind: "job_offer", inViewText: "DAF H/F" })).toMatchObject({ ok: true });
    expect(await changes.removeCase(claire, "interview-psychology", added.evalCase.id)).toMatchObject({ ok: true });

    const recorded = { caseId: added.evalCase.id, title: CASE.title, context: CASE.context, message: CASE.message, inViewKind: null, inViewText: null, criteria: CASE.criteria };
    expect(await entries()).toEqual([
      { email: "claire@jobbbox.fr", target: "interview-psychology", action: "added", before: null, after: recorded },
      { email: "claire@jobbbox.fr", target: "interview-psychology", action: "updated", before: recorded, after: { ...recorded, inViewKind: "job_offer", inViewText: "DAF H/F" } },
      { email: "claire@jobbbox.fr", target: "interview-psychology", action: "removed", before: { ...recorded, inViewKind: "job_offer", inViewText: "DAF H/F" }, after: null },
    ]);
  });

  it("keeps a change and its entry together: when the entry cannot be recorded, the case is not kept", async () => {
    await database.query("ALTER TABLE back_office_audit ADD CONSTRAINT no_eval_cases CHECK (section <> 'eval_cases')");

    await expect(changes.addCase(claire, "interview-psychology", CASE)).rejects.toThrow();

    expect(await evals.cases("interview-psychology")).toEqual([]);
  });
});
