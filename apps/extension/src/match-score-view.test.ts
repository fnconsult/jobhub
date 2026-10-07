import type { MatchScore } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { describeMatchScore } from "./match-score-view";

/** Plain spaces for the narrow no-break spaces Intl puts in amounts ("90 000 €"). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value).replace(/[\u202f\u00a0]/g, " "));

const matchScore: MatchScore = {
  score: 72,
  breakdown: {
    skills: { status: "partial", covered: ["IFRS", "SAP"], missing: ["Power BI"] },
    seniority: { status: "match", cvYears: 25, requiredYears: 15 },
    location: { status: "match", offer: "Lyon", wanted: "Lyon (69003)" },
    salary: { status: "unknown" },
    contractType: { status: "unknown" },
  },
};

describe("a Match Score, as the Guest reads it", () => {
  it("gives the score and each criterion with what it compared, in the Interface Language", () => {
    expect(describeMatchScore(matchScore, createI18n("fr"))).toEqual({
      score: "Match Score : 72 / 100",
      criteria: [
        { label: "Compétences", status: "Correspond en partie", details: ["Présentes dans votre CV : IFRS, SAP", "Absentes de votre CV : Power BI"] },
        { label: "Expérience", status: "Correspond", details: ["Votre CV : 25 ans · l'offre : 15 ans"] },
        { label: "Lieu", status: "Correspond", details: ["Lyon"] },
        { label: "Salaire", status: "Non précisé dans l'offre", details: [] },
        { label: "Type de contrat", status: "Non précisé dans l'offre", details: [] },
      ],
    });
  });

  it("does not say the offer is silent on what it states, when only the Guest's side is missing", () => {
    const guest: MatchScore = {
      score: 60,
      breakdown: {
        skills: { status: "unknown", covered: [], missing: [] },
        seniority: { status: "unknown", requiredYears: 10 },
        location: { status: "unknown", offer: "Lyon" },
        salary: { status: "unknown", offer: { min: 90_000, max: 110_000 } },
        contractType: { status: "unknown", offer: "cdi" },
      },
    };

    expect(plain(describeMatchScore(guest, createI18n("fr")).criteria)).toEqual([
      { label: "Compétences", status: "Non précisé dans l'offre", details: [] },
      { label: "Expérience", status: "Non trouvé dans votre CV", details: ["L'offre : 10 ans"] },
      { label: "Lieu", status: "Aucune préférence de votre part à comparer", details: ["Lyon"] },
      { label: "Salaire", status: "Aucune préférence de votre part à comparer", details: ["L'offre : 90 000 € – 110 000 € brut par an"] },
      { label: "Type de contrat", status: "Aucune préférence de votre part à comparer", details: ["L'offre : CDI"] },
    ]);
    expect(plain(describeMatchScore(guest, createI18n("en")).criteria).map(({ status, details }) => [status, details])).toEqual([
      ["Not stated in the offer", []],
      ["Not found in your CV", ["The offer: 10 years"]],
      ["No preference of yours to compare with", ["Lyon"]],
      ["No preference of yours to compare with", ["The offer: €90,000 – €110,000 gross per year"]],
      ["No preference of yours to compare with", ["The offer: Permanent (CDI)"]],
    ]);
  });

  it("shows the salary the offer states and the one wanted, whatever the outcome", () => {
    const view = plain(describeMatchScore(
      { ...matchScore, breakdown: { ...matchScore.breakdown, salary: { status: "mismatch", offer: { min: 60_000 }, wanted: 80_000 } } },
      createI18n("fr"),
    ));

    expect(view.criteria[3]).toEqual({
      label: "Salaire",
      status: "Ne correspond pas",
      details: ["L'offre : à partir de 60 000 € brut par an", "Votre minimum : 80 000 € brut par an"],
    });
  });
});
