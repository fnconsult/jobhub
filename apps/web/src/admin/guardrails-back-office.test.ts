import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { EvalRun, GuardrailsRun } from "../evals";
import type { GuardrailId, GuardrailSetting } from "../guardrails";
import { createGuardrailStore, migrateGuardrails, type GuardrailStore } from "../guardrails/store";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createGuardrailsBackOffice, type GuardrailsBackOffice } from "./guardrails-back-office";

describe.skipIf(!connectionString)("Guardrails' Back Office writes and their Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let store: GuardrailStore;
  let changes: GuardrailsBackOffice;
  let claire: BackOfficeActor & { name: string };
  let paul: BackOfficeActor & { name: string };
  /** The settings each Eval Run played, and what the next one says got through. */
  let played: Record<GuardrailId, GuardrailSetting>[];
  let refused: GuardrailsRun["refused"];

  async function actor(email: string, name: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id, email: user.email, name };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateGuardrails(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    store = createGuardrailStore(database, { serving: "latest" });
    played = [];
    refused = [];
    const evals = {
      async runGuardrails(_starter: { email: string }, settings: Record<GuardrailId, GuardrailSetting>): Promise<GuardrailsRun> {
        played.push(settings);
        return { run: { id: `run-${played.length}` } as EvalRun, refused };
      },
    };
    changes = createGuardrailsBackOffice(store, backOffice, evals);
    claire = await actor("claire@jobbbox.fr", "Claire Martin");
    paul = await actor("paul@jobbbox.fr", "Paul Durand");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const entries = async () => (await backOffice.journal({ section: "guardrails" })).reverse().map(({ actor: { email }, target, action, before, after }) => ({ email, target, action, before, after }));

  it("records each setting changed, message saved and message validated; refused or unchanged ones record nothing", async () => {
    expect(await changes.setSetting(claire, "harmful_advice", "flag")).toMatchObject({ ok: true, changed: true });
    expect(await changes.setSetting(claire, "harmful_advice", "flag")).toMatchObject({ ok: true, changed: false });
    expect(await changes.setSetting(claire, "distress", "flag")).toEqual({ ok: false, error: "always_on" });
    expect(await changes.saveMessage(claire, "distress", "fr", "Appelez le 3114, à toute heure.")).toMatchObject({ ok: true });
    expect(await changes.saveMessage(claire, "distress", "fr", "Courage.")).toEqual({ ok: false, error: "helpline_missing" });
    expect(await changes.validateMessage(claire, "distress", "fr", 1)).toEqual({ ok: false, error: "own_message" });
    expect(await changes.validateMessage(paul, "distress", "fr", 1)).toMatchObject({ ok: true });
    expect(await changes.saveMessage(claire, "distress", "fr", "Appelez le 3114, gratuit, à toute heure.")).toMatchObject({ ok: true });

    expect(await entries()).toEqual([
      { email: "claire@jobbbox.fr", target: "harmful_advice", action: "updated", before: { setting: "block" }, after: { setting: "flag" } },
      { email: "claire@jobbbox.fr", target: "distress", action: "added", before: null, after: { language: "fr", version: 1, text: "Appelez le 3114, à toute heure." } },
      {
        email: "paul@jobbbox.fr",
        target: "distress",
        action: "validated",
        before: { language: "fr", version: 1, validatedBy: null },
        after: { language: "fr", version: 1, validatedBy: "Paul Durand", validatedAt: expect.any(String) },
      },
      {
        email: "claire@jobbbox.fr",
        target: "distress",
        action: "updated",
        before: { language: "fr", version: 1, text: "Appelez le 3114, à toute heure." },
        after: { language: "fr", version: 2, text: "Appelez le 3114, gratuit, à toute heure." },
      },
    ]);
  });

  describe("a new Guardrail setting (ADR-0023, #231)", () => {
    it("is saved only after the Guardrails' Eval Cases are played on it, the other settings as they are", async () => {
      await changes.setSetting(claire, "prompt_injection", "flag");

      const saved = await changes.setSetting(claire, "harmful_advice", "flag");

      expect(saved).toMatchObject({ ok: true, changed: true, run: { id: "run-2" } });
      expect(played.at(-1)).toMatchObject({ prompt_injection: "flag", harmful_advice: "flag", distress: "block" });
      expect((await store.config.current()).settings.harmful_advice).toBe("flag");
    });

    it("is refused, and nothing recorded, when it lets through a case the distress, personal data leak or secret disclosure Guardrail must block", async () => {
      refused = [{ case: { id: "secret-after-injection" } } as GuardrailsRun["refused"][number]];

      const saved = await changes.setSetting(claire, "prompt_injection", "flag");

      expect(saved).toMatchObject({ ok: false, error: "eval_refused", run: { id: "run-1" }, refused: [{ case: { id: "secret-after-injection" } }] });
      expect((await store.config.current()).settings.prompt_injection).toBe("block");
      expect(await entries()).toEqual([]);
    });

    it("plays no Eval Case when the setting is unchanged or refused, nor when a Guardrail message changes", async () => {
      await changes.setSetting(claire, "harmful_advice", "block");
      await changes.setSetting(claire, "distress", "flag");
      await changes.setSetting(claire, "harmful_advice", "sometimes");
      await changes.saveMessage(claire, "harmful_advice", "fr", "Adressez-vous à un professionnel.");
      await changes.validateMessage(paul, "harmful_advice", "fr", 1);

      expect(played).toEqual([]);
    });
  });

  it("keeps a change and its entry together: when the entry cannot be recorded, the change is not kept", async () => {
    await database.query("ALTER TABLE back_office_audit ADD CONSTRAINT no_guardrails CHECK (section <> 'guardrails')");

    await expect(changes.setSetting(claire, "harmful_advice", "flag")).rejects.toThrow();

    expect((await store.config.current()).settings.harmful_advice).toBe("block");
  });
});
