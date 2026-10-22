import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrowawayDatabase } from "../test-support/throwaway-database";
import { migratePlatformSettings, PLATFORM_SETTINGS_CHANNEL, platformSettingsReader } from "./index";
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
});
