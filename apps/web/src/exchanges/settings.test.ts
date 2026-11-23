import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { platformSetting } from "../platform-settings/catalog";
import { APPLICATION_EXCHANGES_ENABLED, exchangesEnabled } from "./settings";

const setBy = { updatedAt: new Date("2026-11-23T10:00:00Z"), updatedBy: "admin@example.fr" };

describe("APPLICATION_EXCHANGES_ENABLED (#1099, ADR-0115)", () => {
  it("is off by default, and asks a confirmation to switch on: only after the Legal Review", () => {
    expect(platformSetting(APPLICATION_EXCHANGES_ENABLED)).toMatchObject({ group: "email_intake", type: { kind: "boolean" }, default: "false", confirm: "true" });
    expect(exchangesEnabled(snapshotOfSettings({}, {}))).toBe(false);
  });

  it("is on only once set to true, Paramètres over env", () => {
    expect(exchangesEnabled(snapshotOfSettings({ APPLICATION_EXCHANGES_ENABLED: "true" }, {}))).toBe(true);
    expect(exchangesEnabled(snapshotOfSettings({ APPLICATION_EXCHANGES_ENABLED: "true" }, { APPLICATION_EXCHANGES_ENABLED: { value: "false", ...setBy } }))).toBe(false);
    expect(exchangesEnabled(snapshotOfSettings({ APPLICATION_EXCHANGES_ENABLED: "yes" }, {}))).toBe(false);
  });
});
