import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { coachActionsSettings } from "./settings";

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
