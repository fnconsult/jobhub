import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { coachActionsSettings, coachSendEnabled, coachSendsPerDay, coachWebLookupEnabled, LINKEDIN_READING_IN_PRODUCTION, linkedInReadingEnabled, SEND_IN_PRODUCTION, WEB_LOOKUP_IN_PRODUCTION } from "./settings";

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

describe("COACH_SEND_ENABLED and COACH_SENDS_PER_DAY, sending on the Candidate's click (ADR-0119, #1162)", () => {
  it("is off by default, and switched on by Paramètres on the Beta, the e2e suite and a developer's machine", () => {
    for (const env of [{ JOBHUB_TARGET: "staging" }, { JOBHUB_TARGET: "e2e" }, {}]) {
      expect(coachSendEnabled(snapshotOfSettings({}, {}), env), JSON.stringify(env)).toBe(false);
      expect(coachSendEnabled(snapshotOfSettings({ COACH_SEND_ENABLED: "true" }, {}), env), JSON.stringify(env)).toBe(true);
    }
  });

  it("stays off in Production, whatever it is set to, until its Legal Review is done (#1160)", () => {
    expect(SEND_IN_PRODUCTION).toBe(false);
    for (const env of [{ JOBHUB_TARGET: "production" }, { NODE_ENV: "production" }]) {
      expect(coachSendEnabled(snapshotOfSettings({ COACH_SEND_ENABLED: "true" }, {}), env), JSON.stringify(env)).toBe(false);
    }
  });

  it("caps the Sends at 20 a day per Candidate by default, from 1 to 200", () => {
    expect(coachSendsPerDay(snapshotOfSettings({}, {}))).toBe(20);
    expect(coachSendsPerDay(snapshotOfSettings({ COACH_SENDS_PER_DAY: "5" }, {}))).toBe(5);
    expect(coachSendsPerDay(snapshotOfSettings({ COACH_SENDS_PER_DAY: "0" }, {}))).toBe(20);
    expect(coachSendsPerDay(snapshotOfSettings({ COACH_SENDS_PER_DAY: "500" }, {}))).toBe(20);
  });
});

describe("the extension's reading of a LinkedIn page, LINKEDIN_READING_ENABLED (ADR-0119, #1164)", () => {
  it("is off by default, and on once set, on the Beta and in development", () => {
    for (const env of [{ JOBHUB_TARGET: "staging", NODE_ENV: "production" }, { NODE_ENV: "development" }, { JOBHUB_TARGET: "e2e" }]) {
      expect(linkedInReadingEnabled(snapshotOfSettings({}, {}), env), JSON.stringify(env)).toBe(false);
      expect(linkedInReadingEnabled(snapshotOfSettings({ LINKEDIN_READING_ENABLED: "true" }, {}), env), JSON.stringify(env)).toBe(true);
    }
  });

  it("stays off in Production, whatever it is set to, until its Legal Review is done (#1160)", () => {
    expect(LINKEDIN_READING_IN_PRODUCTION).toBe(false);
    for (const env of [{ JOBHUB_TARGET: "production" }, { NODE_ENV: "production" }]) {
      expect(linkedInReadingEnabled(snapshotOfSettings({ LINKEDIN_READING_ENABLED: "true" }, {}), env), JSON.stringify(env)).toBe(false);
    }
  });
});
