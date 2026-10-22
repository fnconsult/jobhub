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

  it("records a change its check refuses (#301) with its Failure Reason and technical detail, never the value entered", async () => {
    const refusing = createPlatformSettingsBackOffice(
      platformSettingsStore(database, { ANTHROPIC_ENDPOINT: "bedrock" }, {
        check: async ({ name, after }) =>
          name === "AI_SCORING_MODEL"
            ? { reason: "test_failed", technical: { class: "AiProviderError", provider: "anthropic", status: 404, message: `AI_SCORING_MODEL: ${after.AI_SCORING_MODEL} failed its test call on anthropic (bedrock eu-north-1): 404 model: ${after.AI_SCORING_MODEL}` } }
            : after.ANTHROPIC_ENDPOINT === "bedrock" && name === "ANTHROPIC_ENDPOINT"
              ? { reason: "key_missing", technical: { class: "AiConfigError", message: "Missing environment variable AWS_BEARER_TOKEN_BEDROCK" } }
              : null,
      }),
      backOffice,
    );

    expect(await refusing.set(claire, "AI_SCORING_MODEL", "claude-inexistant")).toMatchObject({ ok: false, error: "refused", reason: "test_failed" });
    expect(await refusing.set(claire, "ANTHROPIC_ENDPOINT", "auto")).toMatchObject({ ok: true, changed: true });
    expect(await refusing.restore(claire, "ANTHROPIC_ENDPOINT")).toMatchObject({ ok: false, error: "refused", reason: "key_missing" });

    const entries = await journal();
    expect(entries).toEqual([
      {
        email: "claire@jobbbox.fr",
        target: "AI_SCORING_MODEL",
        action: "refused",
        outcome: "failed",
        before: null,
        after: null,
        failure: {
          reason: "test_failed",
          tried: "updated",
          field: "value",
          technical: { class: "AiProviderError", provider: "anthropic", status: 404, message: "AI_SCORING_MODEL: … failed its test call on anthropic (bedrock eu-north-1): 404 model: …" },
        },
      },
      expect.objectContaining({ target: "ANTHROPIC_ENDPOINT", action: "updated", before: { value: "bedrock", source: "env" }, after: { value: "auto", source: "back_office" } }),
      expect.objectContaining({
        target: "ANTHROPIC_ENDPOINT",
        action: "refused",
        failure: { reason: "key_missing", tried: "restored_to_default", field: "value", technical: { class: "AiConfigError", message: "Missing environment variable AWS_BEARER_TOKEN_BEDROCK" } },
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain("claude-inexistant");
    expect(await platformSettingsReader(database).load()).toEqual({ ANTHROPIC_ENDPOINT: expect.objectContaining({ value: "auto" }) });
  });

  it("records MAIL_FROM's save, « Rétablir » and refusal, the sender before and after, never the sender refused (#300)", async () => {
    expect(await changes.set(claire, "MAIL_FROM", "Jobbbox <hello@jobbbox.ai>")).toMatchObject({ ok: true, changed: true });
    expect(await changes.set(claire, "MAIL_FROM", "Jobbbox <hello>")).toEqual({ ok: false, error: "invalid" });
    expect(await changes.restore(claire, "MAIL_FROM")).toMatchObject({ ok: true, changed: true });

    const entries = await journal();
    expect(entries).toEqual([
      {
        email: "claire@jobbbox.fr",
        target: "MAIL_FROM",
        action: "updated",
        outcome: "succeeded",
        before: { value: "Jobbbox <bonjour@localhost>", source: "default" },
        after: { value: "Jobbbox <hello@jobbbox.ai>", source: "back_office" },
        failure: null,
      },
      {
        email: "claire@jobbbox.fr",
        target: "MAIL_FROM",
        action: "refused",
        outcome: "failed",
        before: null,
        after: null,
        failure: { reason: "invalid_value", tried: "updated", field: "value", technical: null },
      },
      {
        email: "claire@jobbbox.fr",
        target: "MAIL_FROM",
        action: "restored_to_default",
        outcome: "succeeded",
        before: { value: "Jobbbox <hello@jobbbox.ai>", source: "back_office" },
        after: { value: "Jobbbox <bonjour@localhost>", source: "default" },
        failure: null,
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("<hello>");
  });

  it("records nothing for an unchanged value, an empty field, a setting not editable, or « Rétablir » on a setting the Back Office did not set", async () => {
    await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "75");

    expect(await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "75")).toMatchObject({ ok: true, changed: false });
    expect(await changes.set(claire, "JOB_DIGEST_MIN_MATCH_SCORE", "")).toEqual({ ok: false, error: "empty" });
    expect(await changes.set(claire, "MAIL_TRANSPORT", "smtp")).toEqual({ ok: false, error: "not_editable" });
    expect(await changes.restore(claire, "JOB_DISCOVERY_BUDGET_EUR")).toMatchObject({ ok: true, changed: false });

    expect(await journal()).toHaveLength(1);
  });
});
