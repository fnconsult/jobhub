import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import type { MatchScore } from "@jobhub/shared";
import { matchScoreReasons, searchCriteriaInWords } from "./job-search-words";

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

describe("why a Job Offer has its Match Score, criterion by criterion", () => {
  const matchScore: MatchScore = {
    score: 86,
    breakdown: {
      skills: { status: "partial", covered: ["IFRS", "Consolidation"], missing: ["SAP"] },
      seniority: { status: "match", cvYears: 27, requiredYears: 15 },
      location: { status: "match", offer: "Villeurbanne", wanted: "Lyon" },
      salary: { status: "match", offer: { min: 95000, max: 110000 }, wanted: 85000 },
      contractType: { status: "mismatch", offer: "cdd", wanted: "cdi" },
    },
  };

  it("gives each criterion its verdict and what the Job Offer and the Candidate say", () => {
    expect(matchScoreReasons(matchScore, fr, "fr")).toEqual([
      { status: "partial", verdict: "En partie", text: "Compétences : 2 sur 3 sur votre CV ; absentes : SAP" },
      { status: "match", verdict: "Correspond", text: "Expérience : 15 ans demandés, 27 ans sur votre CV" },
      { status: "match", verdict: "Correspond", text: "Lieu : Villeurbanne, recherché : Lyon" },
      { status: "match", verdict: "Correspond", text: `Salaire : 95${NNBSP}000 – 110${NNBSP}000 €, recherché : 85${NNBSP}000 € minimum` },
      { status: "mismatch", verdict: "Ne correspond pas", text: "Type de contrat : CDD, recherché : CDI" },
    ]);
  });

  it("names a criterion alone when the Job Offer says nothing to compare it with", () => {
    const silent: MatchScore = {
      score: 40,
      breakdown: {
        skills: { status: "unknown", covered: [], missing: [] },
        seniority: { status: "unknown", cvYears: 27 },
        location: { status: "unknown", wanted: "Lyon" },
        salary: { status: "unknown", wanted: 85000 },
        contractType: { status: "unknown", wanted: "cdi" },
      },
    };
    expect(matchScoreReasons(silent, fr, "fr").map(({ verdict, text }) => `${verdict} · ${text}`)).toEqual([
      "Non comparable · Compétences",
      "Non comparable · Expérience",
      "Non comparable · Lieu",
      "Non comparable · Salaire",
      "Non comparable · Type de contrat",
    ]);
  });

  it("reads in the Candidate's Interface Language", () => {
    expect(matchScoreReasons(matchScore, createI18n("en").t, "en")[2]).toEqual({ status: "match", verdict: "Matches", text: "Location: Villeurbanne, wanted: Lyon" });
  });
});
