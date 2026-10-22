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

  it("asks for confirmation before the DPA is marked signed, recording nothing until then; confirmed, it is an entry with its value before and after (#302)", async () => {
    expect(await changes.set(claire, "CONTACT_ENRICHMENT_PROVIDER", "Apollo")).toMatchObject({ ok: true, changed: true });
    expect(await changes.set(claire, "CONTACT_ENRICHMENT_DPA_SIGNED", "true")).toEqual({ ok: false, error: "unconfirmed" });
    expect((await platformSettingsReader(database).load()).CONTACT_ENRICHMENT_DPA_SIGNED).toBeUndefined();

    expect(await changes.set(claire, "CONTACT_ENRICHMENT_DPA_SIGNED", "true", { confirmed: true })).toMatchObject({ ok: true, changed: true });
    // Marking it not signed again needs no confirmation.
    expect(await changes.set(claire, "CONTACT_ENRICHMENT_DPA_SIGNED", "false")).toMatchObject({ ok: true, changed: true });

    expect((await journal()).map(({ target, action, before, after }) => ({ target, action, before, after }))).toEqual([
      { target: "CONTACT_ENRICHMENT_PROVIDER", action: "updated", before: { value: "", source: "default" }, after: { value: "apollo", source: "back_office" } },
      { target: "CONTACT_ENRICHMENT_DPA_SIGNED", action: "updated", before: { value: "false", source: "default" }, after: { value: "true", source: "back_office" } },
      { target: "CONTACT_ENRICHMENT_DPA_SIGNED", action: "updated", before: { value: "true", source: "back_office" }, after: { value: "false", source: "back_office" } },
    ]);
  });

  it("asks for confirmation before « Rétablir » falls back to env's DPA marked signed (#302)", async () => {
    const fromEnv = createPlatformSettingsBackOffice(platformSettingsStore(database, { CONTACT_ENRICHMENT_DPA_SIGNED: "true" }), backOffice);
    await fromEnv.set(claire, "CONTACT_ENRICHMENT_DPA_SIGNED", "false");

    expect(await fromEnv.restore(claire, "CONTACT_ENRICHMENT_DPA_SIGNED")).toEqual({ ok: false, error: "unconfirmed" });
    expect((await platformSettingsReader(database).load()).CONTACT_ENRICHMENT_DPA_SIGNED?.value).toBe("false");
    expect(await fromEnv.restore(claire, "CONTACT_ENRICHMENT_DPA_SIGNED", { confirmed: true })).toMatchObject({ ok: true, changed: true, after: { value: "true", source: "env" } });
    // Back to the code's default (not signed): nothing to confirm.
    expect(await changes.set(claire, "CONTACT_ENRICHMENT_DPA_SIGNED", "false")).toMatchObject({ ok: true, changed: true });
    expect(await changes.restore(claire, "CONTACT_ENRICHMENT_DPA_SIGNED")).toMatchObject({ ok: true, changed: true, after: { value: "false", source: "default" } });

    expect((await journal()).map(({ action }) => action)).toEqual(["updated", "restored_to_default", "updated", "restored_to_default"]);
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
