import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import type { MatchScore } from "@jobhub/shared";
import { matchScoreFigure, matchScoreInWords, matchScoreReasons, matchScoreReliabilityHint, matchScoreWhyInWords, searchCriteriaInWords } from "./job-search-words";

/** French groups thousands with a narrow no-break space. */
const NNBSP = "\u202f";

const fr = createI18n("fr").t;

describe("the Search Criteria of a Job Search, in words", () => {
  it("says where, which contract, from what salary and how much remote work, in one line", () => {
    expect(
      searchCriteriaInWords({ targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"], minSalary: 85000, remoteWorkOptions: ["hybrid"], sectors: [], subsectors: [], domains: [] }, fr, "fr"),
    ).toBe(`Lyon · CDI · 85${NNBSP}000 € brut par an minimum · Télétravail : Hybride`);
  });

  it("says every place, contract type and remote-work option wanted, any one of which will do (ADR-0025)", () => {
    const criteria = { targetRole: "DAF", locations: ["Lyon", "Bordeaux"], contractTypes: ["cdi" as const, "freelance" as const], remoteWorkOptions: ["hybrid" as const, "full_remote" as const], sectors: [], subsectors: [], domains: [] };
    expect(searchCriteriaInWords(criteria, fr, "fr")).toBe("Lyon ou Bordeaux · CDI ou Indépendant (freelance) · Télétravail : Hybride ou Télétravail complet");
    expect(searchCriteriaInWords({ ...criteria, locations: ["Lyon", "Bordeaux", "Nantes"] }, createI18n("en").t, "en")).toBe(
      "Lyon, Bordeaux, or Nantes · Permanent (CDI) or Freelance · Remote work: Hybrid or Fully remote",
    );
  });

  it("leaves out what the Candidate did not specify", () => {
    expect(searchCriteriaInWords({ targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] }, fr, "fr")).toBe("Lyon");
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

  it("names every value wanted, any one of which is enough (ADR-0025), and still reads a Match Score kept from before", () => {
    const several: MatchScore = {
      ...matchScore,
      breakdown: {
        ...matchScore.breakdown,
        location: { status: "match", offer: "Villeurbanne", wanted: ["Lyon", "Bordeaux"] },
        contractType: { status: "match", offer: "freelance", wanted: ["cdi", "freelance"] },
      },
    };
    const reasons = matchScoreReasons(several, fr, "fr");
    expect(reasons[2]!.text).toBe("Lieu : Villeurbanne, recherché : Lyon ou Bordeaux");
    expect(reasons[4]!.text).toBe("Type de contrat : Indépendant (freelance), recherché : CDI ou Indépendant (freelance)");
    // The Match Score above holds single wanted values, as one kept from before does.
    expect(matchScoreReasons(matchScore, fr, "fr")[4]!.text).toBe("Type de contrat : CDD, recherché : CDI");
  });
});

describe("a Match Score's value, in words (#94)", () => {
  const unknown = {
    skills: { status: "unknown", covered: [], missing: [] },
    seniority: { status: "unknown" },
    location: { status: "unknown" },
    salary: { status: "unknown" },
    contractType: { status: "unknown" },
  } as const satisfies MatchScore["breakdown"];

  it("says a score with nothing to compare is not computable, not 0 / 100", () => {
    const figure = matchScoreFigure({ score: 0, breakdown: unknown });

    expect(matchScoreInWords(figure, fr)).toBe("Non calculable");
    expect(matchScoreWhyInWords(figure, fr)).toBe("Pourquoi pas de score ?");
    expect(matchScoreReliabilityHint(figure, fr)).toMatch(/^Aucun critère/);
  });

  it("shows a score on one known criterion as partial, naming how many were compared", () => {
    const figure = matchScoreFigure({ score: 100, breakdown: { ...unknown, seniority: { status: "match", cvYears: 20, requiredYears: 10 } } });

    expect(matchScoreInWords(figure, fr)).toBe("100 / 100, partiel");
    expect(matchScoreReliabilityHint(figure, fr)).toMatch(/seul 1 critère sur 5/);
    expect(matchScoreInWords(figure, createI18n("en").t)).toBe("100 / 100, partial");
  });

  it("shows a reliable score as before, with no hint", () => {
    const figure = matchScoreFigure({
      score: 72,
      breakdown: { ...unknown, skills: { status: "partial", covered: ["IFRS"], missing: ["SAP"] }, seniority: { status: "match", cvYears: 20, requiredYears: 10 } },
    });

    expect(matchScoreInWords(figure, fr)).toBe("72 / 100");
    expect(matchScoreWhyInWords(figure, fr)).toBe("Pourquoi 72 ?");
    expect(matchScoreReliabilityHint(figure, fr)).toBeNull();
  });
});
