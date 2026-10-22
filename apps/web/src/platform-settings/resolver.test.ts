import { describe, expect, it, vi } from "vitest";
import { createPlatformSettingsResolver, snapshotOfSettings, type StoredPlatformSettings } from "./resolver";

const AT = new Date("2026-10-22T10:00:00Z");
const stored = (values: Record<string, string>): StoredPlatformSettings =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, updatedBy: "ops@jobbbox.ai", updatedAt: AT }]));

describe("a Platform Setting's value in use: the Back Office's, else env's, else the code's default", () => {
  it("takes the code's default when neither the Back Office nor env sets it", () => {
    const setting = snapshotOfSettings({}, {}).setting("ANTHROPIC_ENDPOINT");
    expect(setting).toMatchObject({ value: "auto", source: "default", default: "auto", differsFromDefault: false, valid: true, updatedBy: null });
  });

  it("takes env's value over the default, and flags it when it differs from the default", () => {
    const snapshot = snapshotOfSettings({ ANTHROPIC_ENDPOINT: "bedrock", JOB_DIGEST_TARGET_COUNT: "10" }, {});
    expect(snapshot.setting("ANTHROPIC_ENDPOINT")).toMatchObject({ value: "bedrock", source: "env", default: "auto", differsFromDefault: true });
    // The same as the default: from env, not flagged.
    expect(snapshot.setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "10", source: "env", differsFromDefault: false });
  });

  it("compares numbers as numbers and leaves an empty env value to the default", () => {
    const snapshot = snapshotOfSettings({ JOB_DISCOVERY_BUDGET_EUR: "0.080", JOB_DIGEST_MIN_MATCH_SCORE: "  " }, {});
    expect(snapshot.setting("JOB_DISCOVERY_BUDGET_EUR")).toMatchObject({ source: "env", differsFromDefault: false });
    expect(snapshot.setting("JOB_DIGEST_MIN_MATCH_SCORE")).toMatchObject({ value: "60", source: "default" });
  });

  it("takes the Back Office's value over env's, with who set it and when", () => {
    const snapshot = snapshotOfSettings({ ANTHROPIC_ENDPOINT: "bedrock" }, stored({ ANTHROPIC_ENDPOINT: "direct" }));
    expect(snapshot.setting("ANTHROPIC_ENDPOINT")).toMatchObject({ value: "direct", source: "back_office", updatedBy: "ops@jobbbox.ai", updatedAt: AT });
    // Only a value from env is flagged: the Back Office's is meant.
    expect(snapshot.setting("ANTHROPIC_ENDPOINT")?.differsFromDefault).toBe(false);
    expect(snapshot.env.ANTHROPIC_ENDPOINT).toBe("direct");
  });

  it("says when env holds a value the code refuses", () => {
    expect(snapshotOfSettings({ ANTHROPIC_ENDPOINT: "us-east" }, {}).setting("ANTHROPIC_ENDPOINT")).toMatchObject({ source: "env", valid: false, differsFromDefault: true });
  });

  it("lists every Platform Setting, and ignores a stored name that is not one", () => {
    const snapshot = snapshotOfSettings({}, stored({ NOT_A_SETTING: "x", AUTH_SECRET: "never" }));
    expect(snapshot.settings.map((setting) => setting.name)).toContain("EXTENSION_STORE_URL");
    expect(snapshot.setting("NOT_A_SETTING")).toBeUndefined();
    expect(snapshot.env.AUTH_SECRET).toBeUndefined();
  });

  it("changes the version of the names whose value or source changed, and only theirs", () => {
    const before = snapshotOfSettings({ MAIL_FROM: "a@x" }, {});
    const after = snapshotOfSettings({ MAIL_FROM: "a@x" }, stored({ ANTHROPIC_ENDPOINT: "bedrock" }));
    expect(after.versionOf(["MAIL_FROM"])).toBe(before.versionOf(["MAIL_FROM"]));
    expect(after.versionOf(["ANTHROPIC_ENDPOINT"])).not.toBe(before.versionOf(["ANTHROPIC_ENDPOINT"]));
  });
});

describe("the Platform Settings resolver", () => {
  it("serves env and the defaults until the database is read, then the Back Office's values over them", async () => {
    let rows = stored({ JOB_DIGEST_TARGET_COUNT: "12" });
    const load = vi.fn(async () => rows);
    const resolver = createPlatformSettingsResolver({ load, env: { JOB_DIGEST_TARGET_COUNT: "8" } });

    expect(resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "8", source: "env" });
    await resolver.refresh();
    expect(resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "12", source: "back_office" });

    // « Rétablir » clears the Back Office's value: env's is used again.
    rows = {};
    await resolver.refresh();
    expect(resolver.current().setting("JOB_DIGEST_TARGET_COUNT")).toMatchObject({ value: "8", source: "env" });
  });

  it("reads the database again once its cache is 60 s old", async () => {
    let clock = 0;
    let rows = stored({ MAIL_FROM: "first@x" });
    const load = vi.fn(async () => rows);
    const resolver = createPlatformSettingsResolver({ load, env: {}, now: () => clock });
    await resolver.refresh();
    rows = stored({ MAIL_FROM: "second@x" });

    clock = 60_000;
    resolver.current();
    await vi.waitFor(() => expect(resolver.current().setting("MAIL_FROM")?.value).toBe("second@x"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps what it had when the database cannot be read, and says so as the Platform Settings'", async () => {
    const log = vi.fn();
    const load = vi.fn().mockResolvedValueOnce(stored({ MAIL_FROM: "kept@x" })).mockRejectedValueOnce(new Error("relation platform_setting does not exist"));
    const resolver = createPlatformSettingsResolver({ load, env: {}, log });
    await resolver.refresh();
    await resolver.refresh();
    expect(resolver.current().setting("MAIL_FROM")?.value).toBe("kept@x");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[platform-settings\].*does not exist/));
  });
});
