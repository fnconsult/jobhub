import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrowawayDatabase } from "../test-support/throwaway-database";
import { migratePlatformSettings, PLATFORM_SETTINGS_CHANNEL, platformSettingsReader, platformSettingsStore } from "./index";
import { watchPlatformSettings, type WatchedPlatformSettings } from "./watch";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Platform Settings in the database (needs Postgres: DATABASE_URL)", () => {
  let database: Awaited<ReturnType<typeof createThrowawayDatabase>>;
  let watched: WatchedPlatformSettings | undefined;

  /** What the editing slices will write: a value, who set it, and the change announced. */
  const set = async (name: string, value: string) => {
    await database.pool.query(
      `INSERT INTO platform_setting (name, value, updated_by_email) VALUES ($1, $2, 'ops@jobbbox.ai')
       ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [name, value],
    );
    await database.pool.query("SELECT pg_notify($1, '')", [PLATFORM_SETTINGS_CHANNEL]);
  };

  beforeEach(async () => {
    database = await createThrowawayDatabase("platform_settings");
    await migratePlatformSettings(database.pool);
    // Safe to run again.
    await migratePlatformSettings(database.pool);
  }, 60_000);
  afterEach(async () => {
    await watched?.stop();
    watched = undefined;
    await database.drop();
  }, 60_000);

  it("reads nothing while the Back Office has set nothing", async () => {
    expect(await platformSettingsReader(database.pool).load()).toEqual({});
  });

  it("reads what the Back Office set, with who and when, and leaves out a name that is not a Platform Setting", async () => {
    await set("JOB_DIGEST_TARGET_COUNT", "12");
    await set("AUTH_SECRET", "never-a-platform-setting");

    const stored = await platformSettingsReader(database.pool).load();

    expect(Object.keys(stored)).toEqual(["JOB_DIGEST_TARGET_COUNT"]);
    expect(stored.JOB_DIGEST_TARGET_COUNT).toMatchObject({ value: "12", updatedBy: "ops@jobbbox.ai" });
    expect(stored.JOB_DIGEST_TARGET_COUNT?.updatedAt).toBeInstanceOf(Date);
  });

  it("is kept current in the process: a change announced on NOTIFY is in use within seconds", async () => {
    watched = watchPlatformSettings({ database: database.pool, env: { JOB_DIGEST_TARGET_COUNT: "8" }, log: vi.fn() });
    await watched.ready;
    expect(watched.resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "8", source: "env" });

    await set("JOB_DIGEST_TARGET_COUNT", "12");

    await vi.waitFor(() => expect(watched!.resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "12", source: "back_office" }), { timeout: 5_000 });
  });

  describe("set and restored by the Back Office", () => {
    const env = { JOB_DIGEST_TARGET_COUNT: "8" };

    it("sets an editable setting as its parser takes it, saying its value and source before and after", async () => {
      const store = platformSettingsStore(database.pool, env);

      expect(await store.set("JOB_DIGEST_MIN_MATCH_SCORE", " 75 ", "ops@jobbbox.ai")).toEqual({
        ok: true,
        changed: true,
        before: { value: "60", source: "default" },
        after: { value: "75", source: "back_office" },
      });
      expect(await store.set("JOB_DISCOVERY_BUDGET_EUR", "0.150", "ops@jobbbox.ai")).toMatchObject({ ok: true, after: { value: "0.15", source: "back_office" } });
      expect(await store.set("JOB_DIGEST_TARGET_COUNT", "12", "ops@jobbbox.ai")).toMatchObject({ before: { value: "8", source: "env" }, after: { value: "12", source: "back_office" } });

      const stored = await platformSettingsReader(database.pool).load();
      expect(stored.JOB_DIGEST_MIN_MATCH_SCORE).toMatchObject({ value: "75", updatedBy: "ops@jobbbox.ai" });
    });

    it("says a value already set is unchanged", async () => {
      const store = platformSettingsStore(database.pool, env);
      await store.set("JOB_DIGEST_MIN_MATCH_SCORE", "75", "ops@jobbbox.ai");

      expect(await store.set("JOB_DIGEST_MIN_MATCH_SCORE", "75.0", "other@jobbbox.ai")).toMatchObject({ ok: true, changed: false });
      expect((await platformSettingsReader(database.pool).load()).JOB_DIGEST_MIN_MATCH_SCORE?.updatedBy).toBe("ops@jobbbox.ai");
    });

    it("refuses a value out of the setting's bounds or of its type, an empty one, and a setting not editable yet, keeping nothing", async () => {
      const store = platformSettingsStore(database.pool, env);

      expect(await store.set("JOB_DIGEST_MIN_MATCH_SCORE", "120", "ops@jobbbox.ai")).toEqual({ ok: false, error: "invalid" });
      expect(await store.set("JOB_DIGEST_FIRST_LOOK_BACK_DAYS", "1.5", "ops@jobbbox.ai")).toEqual({ ok: false, error: "invalid" });
      expect(await store.set("JOB_DISCOVERY_BUDGET_SECONDS", "900", "ops@jobbbox.ai")).toEqual({ ok: false, error: "invalid" });
      expect(await store.set("JOB_DISCOVERY_BUDGET_JOB_OFFERS", "trente", "ops@jobbbox.ai")).toEqual({ ok: false, error: "invalid" });
      expect(await store.set("JOB_DIGEST_TARGET_COUNT", "  ", "ops@jobbbox.ai")).toEqual({ ok: false, error: "empty" });
      expect(await store.set("MAIL_TRANSPORT", "brevo", "ops@jobbbox.ai")).toEqual({ ok: false, error: "not_editable" });
      expect(await store.set("AUTH_SECRET", "x", "ops@jobbbox.ai")).toEqual({ ok: false, error: "not_editable" });

      expect(await platformSettingsReader(database.pool).load()).toEqual({});
    });

    it("sets MAIL_FROM to an email sender and refuses anything else; MAIL_TRANSPORT stays env's alone", async () => {
      const store = platformSettingsStore(database.pool, { MAIL_FROM: "Jobbbox <bonjour@jobbbox.fr>", MAIL_TRANSPORT: "console" });

      expect(await store.set("MAIL_FROM", " Jobbbox <hello@jobbbox.ai> ", "ops@jobbbox.ai")).toEqual({
        ok: true,
        changed: true,
        before: { value: "Jobbbox <bonjour@jobbbox.fr>", source: "env" },
        after: { value: "Jobbbox <hello@jobbbox.ai>", source: "back_office" },
      });
      expect(await store.set("MAIL_FROM", "Jobbbox", "ops@jobbbox.ai")).toEqual({ ok: false, error: "invalid" });
      expect(await store.set("MAIL_FROM", "Jobbbox <hello@jobbbox.ai>\nBcc: someone@example.fr", "ops@jobbbox.ai")).toEqual({ ok: false, error: "invalid" });
      expect(await store.set("MAIL_TRANSPORT", "brevo", "ops@jobbbox.ai")).toEqual({ ok: false, error: "not_editable" });
      expect(await store.restore("MAIL_TRANSPORT")).toEqual({ ok: false, error: "not_editable" });

      expect(await store.restore("MAIL_FROM")).toMatchObject({ ok: true, changed: true, after: { value: "Jobbbox <bonjour@jobbbox.fr>", source: "env" } });
      expect(await platformSettingsReader(database.pool).load()).toEqual({});
    });

    it("restores a setting to env's value, else the code's default; one the Back Office did not set is unchanged", async () => {
      const store = platformSettingsStore(database.pool, env);
      await store.set("JOB_DIGEST_TARGET_COUNT", "12", "ops@jobbbox.ai");
      await store.set("JOB_DIGEST_MIN_MATCH_SCORE", "75", "ops@jobbbox.ai");

      expect(await store.restore("JOB_DIGEST_TARGET_COUNT")).toEqual({
        ok: true,
        changed: true,
        before: { value: "12", source: "back_office" },
        after: { value: "8", source: "env" },
      });
      expect(await store.restore("JOB_DIGEST_MIN_MATCH_SCORE")).toMatchObject({ ok: true, changed: true, after: { value: "60", source: "default" } });
      expect(await store.restore("JOB_DIGEST_MIN_MATCH_SCORE")).toMatchObject({ ok: true, changed: false });
      expect(await store.restore("MAIL_TRANSPORT")).toEqual({ ok: false, error: "not_editable" });
      expect(await platformSettingsReader(database.pool).load()).toEqual({});
    });

    it("asks its check about a change, with the settings in use before and after it, and keeps nothing it refuses (#301)", async () => {
      const technical = { class: "DataResidencyError", message: "AI_SCORING_PROVIDER: outside the EU" };
      const check = vi.fn(async ({ after }: { name: string; before: Record<string, string | undefined>; after: Record<string, string | undefined> }) =>
        after.AI_SCORING_PROVIDER === "openai" ? { reason: "data_residency" as const, technical } : null,
      );
      const store = platformSettingsStore(database.pool, { ...env, ANTHROPIC_ENDPOINT: "bedrock" }, { check });

      expect(await store.set("AI_SCORING_PROVIDER", "openai", "ops@jobbbox.ai")).toEqual({ ok: false, error: "refused", reason: "data_residency", technical });
      expect(check).toHaveBeenLastCalledWith({
        name: "AI_SCORING_PROVIDER",
        before: expect.not.objectContaining({ AI_SCORING_PROVIDER: expect.anything() }),
        after: expect.objectContaining({ ANTHROPIC_ENDPOINT: "bedrock", AI_SCORING_PROVIDER: "openai" }),
      });
      expect(await platformSettingsReader(database.pool).load()).toEqual({});

      expect(await store.set("ANTHROPIC_ENDPOINT", "auto", "ops@jobbbox.ai")).toMatchObject({ ok: true, changed: true, before: { value: "bedrock", source: "env" }, after: { value: "auto", source: "back_office" } });
      // « Rétablir » is a change too: back to env's bedrock, asked about first.
      expect(await store.restore("ANTHROPIC_ENDPOINT")).toMatchObject({ ok: true, changed: true, after: { value: "bedrock", source: "env" } });
      expect(check).toHaveBeenLastCalledWith({
        name: "ANTHROPIC_ENDPOINT",
        before: expect.objectContaining({ ANTHROPIC_ENDPOINT: "auto" }),
        after: expect.objectContaining({ ANTHROPIC_ENDPOINT: "bedrock" }),
      });
      // Nothing changes: nothing to ask.
      check.mockClear();
      expect(await store.restore("ANTHROPIC_ENDPOINT")).toMatchObject({ ok: true, changed: false });
      expect(check).not.toHaveBeenCalled();
    });

    it("announces each change, so a watching process uses it within seconds", async () => {
      watched = watchPlatformSettings({ database: database.pool, env, log: vi.fn() });
      await watched.ready;
      const store = platformSettingsStore(database.pool, env);

      await store.set("JOB_DIGEST_TARGET_COUNT", "12", "ops@jobbbox.ai");
      await vi.waitFor(() => expect(watched!.resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "12", source: "back_office" }), { timeout: 5_000 });

      await store.restore("JOB_DIGEST_TARGET_COUNT");
      await vi.waitFor(() => expect(watched!.resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "8", source: "env" }), { timeout: 5_000 });
    });
  });
});
