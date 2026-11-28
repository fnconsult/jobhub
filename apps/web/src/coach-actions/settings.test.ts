import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { coachActionsSettings, coachWebLookupEnabled, WEB_LOOKUP_IN_PRODUCTION } from "./settings";

describe("the Coach Actions' Platform Settings (#713)", () => {
  it("are off, with 2 rounds, by default", () => {
    expect(coachActionsSettings(snapshotOfSettings({}, {}))).toEqual({ enabled: false, maxRounds: 2 });
  });

  it("follow env, and the Back Office's values over it", () => {
    expect(coachActionsSettings(snapshotOfSettings({ COACH_ACTIONS_ENABLED: "true", COACH_TOOL_ROUNDS_MAX: "0" }, {}))).toEqual({ enabled: true, maxRounds: 0 });
    const stored = { COACH_ACTIONS_ENABLED: { value: "true", updatedAt: new Date(), updatedBy: "admin@jobbbox.ai" }, COACH_TOOL_ROUNDS_MAX: { value: "4", updatedAt: new Date(), updatedBy: "admin@jobbbox.ai" } };
    expect(coachActionsSettings(snapshotOfSettings({ COACH_ACTIONS_ENABLED: "false" }, stored))).toEqual({ enabled: true, maxRounds: 4 });
  });

  it("keep the default for a value that does not read: never switched on by mistake", () => {
    expect(coachActionsSettings(snapshotOfSettings({ COACH_ACTIONS_ENABLED: "yes", COACH_TOOL_ROUNDS_MAX: "9" }, {}))).toEqual({ enabled: false, maxRounds: 2 });
  });
});

describe("COACH_WEB_LOOKUP_ENABLED, the AI Coach's Web lookup (ADR-0119, #1159)", () => {
  const set = (value: string) => snapshotOfSettings({ COACH_WEB_LOOKUP_ENABLED: value }, {});

  it("is on by default, for every Plan, on the Beta, the e2e suite and a developer's machine", () => {
    for (const env of [{ JOBHUB_TARGET: "staging" }, { JOBHUB_TARGET: "e2e" }, { JOBHUB_TARGET: "development" }, {}]) {
      expect(coachWebLookupEnabled(snapshotOfSettings({}, {}), env), JSON.stringify(env)).toBe(true);
    }
    expect(coachWebLookupEnabled(set("false"), { JOBHUB_TARGET: "staging" })).toBe(false);
    expect(coachWebLookupEnabled(set("oui"), { JOBHUB_TARGET: "staging" })).toBe(true);
  });

  it("stays off in Production, whatever it is set to, until its Legal Review is done (#1160)", () => {
    expect(WEB_LOOKUP_IN_PRODUCTION).toBe(false);
    for (const env of [{ JOBHUB_TARGET: "production" }, { NODE_ENV: "production" }]) {
      expect(coachWebLookupEnabled(snapshotOfSettings({}, {}), env), JSON.stringify(env)).toBe(false);
      expect(coachWebLookupEnabled(set("true"), env), JSON.stringify(env)).toBe(false);
    }
  });
});
