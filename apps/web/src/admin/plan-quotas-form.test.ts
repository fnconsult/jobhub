import { describe, expect, it } from "vitest";
import { planQuotasFromForm, reductionNoticeFromForm } from "./plan-quotas-form";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("the Plan Quotas form of the back office", () => {
  it("reads numbers as limits and empty fields as unlimited", () => {
    expect(
      planQuotasFromForm(
        form({ plan: "standard", profiles: "5", matchScores: "", atsScores: " ", enrichedContacts: "0", jobSearches: "10", jobDigest: "daily" }),
      ),
    ).toEqual({
      plan: "standard",
      quotas: { profiles: 5, matchScores: null, atsScores: null, enrichedContacts: 0, jobSearches: 10, jobDigest: "daily" },
    });
  });

  it.each([
    ["a negative limit", { profiles: "-1" }],
    ["a fractional limit", { matchScores: "2.5" }],
    ["text", { atsScores: "beaucoup" }],
    ["a limit too large to store", { profiles: "99999999999" }],
    ["an unknown Job Digest frequency", { jobDigest: "hourly" }],
    ["no Plan", { plan: "" }],
    ["a Plan key that is not one", { plan: "Gold Plan!" }],
  ])("refuses %s", (_, override) => {
    const fields = { plan: "free", profiles: "1", matchScores: "3", atsScores: "1", enrichedContacts: "0", jobSearches: "3", jobDigest: "none", ...override };

    expect(planQuotasFromForm(form(fields))).toBeNull();
  });
});

describe("the notice of a Quota Reduction a Back Office form sends (#514)", () => {
  it("reads its reason and effective date, trimmed", () => {
    expect(reductionNoticeFromForm(form({ reductionReason: "  Coûts en hausse ", reductionEffectiveOn: "2026-11-14" }))).toEqual({ reason: "Coûts en hausse", effectiveOn: "2026-11-14" });
    expect(reductionNoticeFromForm(form({ reductionReason: "Coûts en hausse" }))).toEqual({ reason: "Coûts en hausse", effectiveOn: "" });
  });

  it("is none when the form gives neither", () => {
    expect(reductionNoticeFromForm(form({ reductionReason: " ", reductionEffectiveOn: "" }))).toBeNull();
    expect(reductionNoticeFromForm(form({}))).toBeNull();
  });
});
