import { describe, expect, it } from "vitest";
import { STARTING_PLAN_QUOTAS } from "./index";
import { usageMeter } from "./usage-meter";

const nothingUsed = { matchScores: 0, atsScores: 0, enrichedContacts: 0, jobSearches: 0 };

describe("usageMeter", () => {
  it("weighs each quota by what the Plan grants: all uses over all allowances", () => {
    const quotas = { ...STARTING_PLAN_QUOTAS.free, matchScores: 3, atsScores: 1, jobSearches: 4 };

    const meter = usageMeter(quotas, { ...nothingUsed, matchScores: 2, jobSearches: 1 });

    // (2 + 0 + 1) / (3 + 1 + 4): the 0 Enriched Contacts and the Job Digest weigh nothing.
    expect(meter.used).toBe(3);
    expect(meter.allowed).toBe(8);
    expect(meter.percent).toBe(38);
  });

  it("lists each quota, in the sidebar's order, with what was used and what is allowed", () => {
    const meter = usageMeter(STARTING_PLAN_QUOTAS.standard, { ...nothingUsed, matchScores: 12, jobSearches: 2 });

    expect(meter.quotas).toEqual([
      { quota: "matchScores", used: 12, limit: null },
      { quota: "atsScores", used: 0, limit: null },
      { quota: "jobSearches", used: 2, limit: 7 },
      { quota: "enrichedContacts", used: 0, limit: 0 },
    ]);
    expect(meter.jobDigest).toBe("weekly");
    expect(meter.percent).toBe(29);
  });

  it("never goes past 100%, even when a lowered quota is below what was already used", () => {
    const quotas = { ...STARTING_PLAN_QUOTAS.free, matchScores: 1, atsScores: 1, jobSearches: 2 };

    expect(usageMeter(quotas, { ...nothingUsed, matchScores: 5, atsScores: 1, jobSearches: 2 })).toMatchObject({ used: 4, allowed: 4, percent: 100 });
  });

  it("has no percentage when the Plan limits nothing", () => {
    const quotas = { ...STARTING_PLAN_QUOTAS.premium, enrichedContacts: null };

    expect(usageMeter(quotas, { ...nothingUsed, matchScores: 40 })).toMatchObject({ used: 0, allowed: 0, percent: null });
  });
});
