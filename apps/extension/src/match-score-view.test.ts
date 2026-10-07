import type { MatchScore } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { describeMatchScore } from "./match-score-view";

const matchScore: MatchScore = {
  score: 72,
  breakdown: {
    skills: { status: "partial", covered: ["IFRS", "SAP"], missing: ["Power BI"] },
    seniority: { status: "match", cvYears: 25, requiredYears: 15 },
    location: { status: "match", offer: "Lyon", wanted: "Lyon (69003)" },
    salary: { status: "unknown" },
    contractType: { status: "unknown", offer: "cdi" },
  },
};

describe("a Match Score, as the Guest reads it", () => {
  it("gives the score and each criterion with what it compared, in the Interface Language", () => {
    const { t } = createI18n("fr");

    expect(describeMatchScore(matchScore, t)).toEqual({
      score: "Match Score : 72 / 100",
      criteria: [
        { label: "Compétences", status: "correspond en partie", details: ["Présentes dans votre CV : IFRS, SAP", "Absentes de votre CV : Power BI"] },
        { label: "Expérience", status: "correspond", details: ["Votre CV : 25 ans · l'offre : 15 ans"] },
        { label: "Lieu", status: "correspond", details: ["Lyon"] },
        { label: "Salaire", status: "non précisé dans l'offre", details: [] },
        { label: "Type de contrat", status: "non précisé dans l'offre", details: [] },
      ],
    });
  });
});
