import { describe, expect, it } from "vitest";
import { isEditable, parseSetting, platformSetting } from "../platform-settings/catalog";
import { settingHref } from "../platform-settings/parametres";
import { snapshotOfSettings, type StoredPlatformSettings } from "../platform-settings/resolver";
import { conversationFirst } from "./index";

const stored = (values: Record<string, string>): StoredPlatformSettings =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, updatedBy: "ops@jobbbox.ai", updatedAt: new Date("2026-10-31T10:00:00Z") }]));

describe("« Conversation au centre », the Platform Setting (#601, ADR-0070)", () => {
  it("is off by default", () => {
    expect(platformSetting("CONVERSATION_FIRST")?.default).toBe("false");
    expect(conversationFirst(snapshotOfSettings({}, {}))).toBe(false);
  });

  it("is switched on in the Back Office, over the environment", () => {
    expect(conversationFirst(snapshotOfSettings({}, stored({ CONVERSATION_FIRST: "true" })))).toBe(true);
    expect(conversationFirst(snapshotOfSettings({ CONVERSATION_FIRST: "true" }, stored({ CONVERSATION_FIRST: "false" })))).toBe(false);
  });

  it("can be switched on by the environment, and a value it does not take leaves it off", () => {
    expect(conversationFirst(snapshotOfSettings({ CONVERSATION_FIRST: "true" }, {}))).toBe(true);
    expect(conversationFirst(snapshotOfSettings({ CONVERSATION_FIRST: "yes" }, {}))).toBe(false);
  });

  it("is a true-or-false setting super-admins change on Paramètres' Environnement tab", () => {
    const setting = platformSetting("CONVERSATION_FIRST")!;
    expect(isEditable(setting)).toBe(true);
    expect(parseSetting(setting, "true")).toEqual({ ok: true, value: true });
    expect(parseSetting(setting, "on")).toMatchObject({ ok: false });
    expect(settingHref("CONVERSATION_FIRST")).toBe("/admin/parametres?tab=environnement#setting-CONVERSATION_FIRST");
  });
});
