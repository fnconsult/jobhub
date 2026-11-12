import { describe, expect, it } from "vitest";
import { COACH_SPACE_V2, coachSpaceV2In, coachSpaceV2InEnv } from ".";

const snapshot = (value?: string) => ({ setting: (name: string) => (name === COACH_SPACE_V2 && value !== undefined ? { value } : undefined) });

describe("« Espace coach v2 » (ADR-0107)", () => {
  it("is off unless the setting is exactly true", () => {
    expect(coachSpaceV2In(snapshot())).toBe(false);
    expect(coachSpaceV2In(snapshot("false"))).toBe(false);
    expect(coachSpaceV2In(snapshot("TRUE"))).toBe(false);
    expect(coachSpaceV2In(snapshot("true"))).toBe(true);
  });

  it("reads the worker's resolved settings the same way", () => {
    expect(coachSpaceV2InEnv({})).toBe(false);
    expect(coachSpaceV2InEnv({ COACH_SPACE_V2: "1" })).toBe(false);
    expect(coachSpaceV2InEnv({ COACH_SPACE_V2: "true" })).toBe(true);
  });
});
