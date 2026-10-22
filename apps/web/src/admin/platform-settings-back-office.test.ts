import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migratePlatformSettings, platformSettingsReader, platformSettingsStore } from "../platform-settings";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createPlatformSettingsBackOffice, type PlatformSettingsBackOffice } from "./platform-settings-back-office";

describe.skipIf(!connectionString)("Platform Settings' Back Office writes and their Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let changes: PlatformSettingsBackOffice;
  let claire: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migratePlatformSettings(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    changes = createPlatformSettingsBackOffice(platformSettingsStore(database, { JOB_DIGEST_TARGET_COUNT: "8" }), backOffice);
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const journal = async () =>
    (await backOffice.journal({ section: "platform_settings" })).reverse().map(({ actor: { email }, target, action, outcome, before, after, failure }) => ({ email, target, action, outcome, before, after, failure }));

  it("records each save as changed and each « Rétablir » as restored to default, with the value and source before and after", async () => {
    expect(await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "75")).toMatchObject({ ok: true, changed: true });
    expect(await changes.set(claire, "JOB_DIGEST_TARGET_COUNT", "12")).toMatchObject({ ok: true, changed: true });
    expect(await changes.restore(claire, "JOB_DIGEST_TARGET_COUNT")).toMatchObject({ ok: true, changed: true });

    expect(await journal()).toEqual([
      {
        email: "claire@jobbbox.fr",
        target: "JOB_DIGEST_MIN_MATCH_SCORE",
        action: "updated",
        outcome: "succeeded",
        before: { value: "60", source: "default" },
        after: { value: "75", source: "back_office" },
        failure: null,
      },
      {
        email: "claire@jobbbox.fr",
        target: "JOB_DIGEST_TARGET_COUNT",
        action: "updated",
        outcome: "succeeded",
        before: { value: "8", source: "env" },
        after: { value: "12", source: "back_office" },
        failure: null,
      },
      {
        email: "claire@jobbbox.fr",
        target: "JOB_DIGEST_TARGET_COUNT",
        action: "restored_to_default",
        outcome: "succeeded",
        before: { value: "12", source: "back_office" },
        after: { value: "8", source: "env" },
        failure: null,
      },
    ]);
  });

  it("records a value the setting refuses as a refused save, with its Failure Reason and the field at fault, never the value entered", async () => {
    expect(await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "120")).toEqual({ ok: false, error: "invalid" });

    const entries = await journal();
    expect(entries).toEqual([
      {
        email: "claire@jobbbox.fr",
        target: "JOB_DIGEST_MIN_MATCH_SCORE",
        action: "refused",
        outcome: "failed",
        before: null,
        after: null,
        failure: { reason: "invalid_value", tried: "updated", field: "value", technical: null },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("120");
    expect(await platformSettingsReader(database).load()).toEqual({});
  });

  it("records nothing for an unchanged value, an empty field, a setting not editable, or « Rétablir » on a setting the Back Office did not set", async () => {
    await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "75");

    expect(await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "75")).toMatchObject({ ok: true, changed: false });
    expect(await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "")).toEqual({ ok: false, error: "empty" });
    expect(await changes.set(claire, "ANTHROPIC_ENDPOINT", "vertex")).toEqual({ ok: false, error: "not_editable" });
    expect(await changes.restore(claire, "JOB_DISCOVERY_BUDGET_EUR")).toMatchObject({ ok: true, changed: false });

    expect(await journal()).toHaveLength(1);
  });
});
