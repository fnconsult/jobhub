import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { searchCriteriaInWords } from "./job-search-words";

/** French groups thousands with a narrow no-break space. */
const NNBSP = "\u202f";

const fr = createI18n("fr").t;

describe("the Search Criteria of a Job Search, in words", () => {
  it("says where, which contract, from what salary and how much remote work, in one line", () => {
    expect(
      searchCriteriaInWords({ targetRole: "DAF", location: "Lyon", contractType: "cdi", minSalary: 85000, remoteWork: "hybrid" }, fr, "fr"),
    ).toBe(`Lyon · CDI · 85${NNBSP}000 € brut par an minimum · Télétravail : Hybride`);
  });

  it("leaves out what the Candidate did not specify", () => {
    expect(searchCriteriaInWords({ targetRole: "DAF", location: "Lyon" }, fr, "fr")).toBe("Lyon");
  });
});
