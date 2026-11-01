import { describe, expect, it } from "vitest";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { earliestEffectiveOn, effectiveAtOf, splitQuotaChange } from "./reduction";

const standard = STARTING_PLAN_QUOTAS.standard;

describe("splitting a Plan Quota change (#514)", () => {
  it("an increase applies now, with nothing to schedule", () => {
    const after = { ...standard, jobSearches: 10, profiles: null, jobDigest: "daily" as const };

    expect(splitQuotaChange(standard, after)).toEqual({ now: after, reduced: {} });
  });

  it("a lower number, a number where it was unlimited, and a rarer Job Digest are reductions, scheduled; the rest applies now", () => {
    const after = { ...standard, profiles: 2, matchScores: 50, enrichedContacts: 3, jobDigest: "none" as const };

    expect(splitQuotaChange(standard, after)).toEqual({
      now: { ...standard, enrichedContacts: 3 },
      reduced: { profiles: { before: 3, after: 2 }, matchScores: { before: null, after: 50 }, jobDigest: { before: "weekly", after: "none" } },
    });
  });

  it("the same quotas change nothing", () => {
    expect(splitQuotaChange(standard, { ...standard })).toEqual({ now: standard, reduced: {} });
  });
});

describe("a reduction's effective date", () => {
  it("is 30 days after today in Paris at the earliest", () => {
    // 23:30 in Paris on 15 October is already the 15th there.
    expect(earliestEffectiveOn(new Date("2026-10-15T21:30:00Z"))).toBe("2026-11-14");
    expect(earliestEffectiveOn(new Date("2026-10-15T22:30:00Z"))).toBe("2026-11-15");
  });

  it("starts at midnight in Paris", () => {
    expect(effectiveAtOf("2026-11-14")).toEqual(new Date("2026-11-13T23:00:00Z"));
    expect(effectiveAtOf("2026-07-01")).toEqual(new Date("2026-06-30T22:00:00Z"));
    expect(effectiveAtOf("2026-02-30")).toBeNull();
    expect(effectiveAtOf("demain")).toBeNull();
  });
});
