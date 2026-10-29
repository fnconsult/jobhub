import type { MatchScore } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { describeMatchScore, describeRescore } from "./match-score-view";

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
  it("names every place and contract type wanted, any one of which is enough (ADR-0025)", () => {
    const several: MatchScore = {
      ...matchScore,
      breakdown: {
        ...matchScore.breakdown,
        location: { status: "match", offer: "Bordeaux", wanted: ["Lyon", "Bordeaux"] },
        contractType: { status: "match", offer: "freelance", wanted: ["cdi", "freelance"] },
      },
    };

    const [, , location, , contractType] = describeMatchScore(several, createI18n("fr")).criteria;
    expect(location!.details).toEqual(["Bordeaux", "Vous cherchez : Lyon ou Bordeaux"]);
    expect(contractType!.details).toEqual(["L'offre : Indépendant (freelance)", "Vous cherchez : CDI ou Indépendant (freelance)"]);
  });

  it("gives the score and each criterion with what it compared, in the Interface Language", () => {
    expect(describeMatchScore(matchScore, createI18n("fr"))).toEqual({
      score: "Match Score : 72 / 100",
      ring: 72,
      notes: [],
      criteria: [
        { label: "Compétences", points: "27 / 40", fill: 68, status: "Correspond en partie", details: ["Présentes dans votre CV : IFRS, SAP", "Absentes de votre CV : Power BI"] },
        { label: "Expérience", points: "20 / 20", fill: 100, status: "Correspond", details: ["Votre CV : 25 ans · l'offre : 15 ans"] },
        { label: "Lieu", points: "15 / 15", fill: 100, status: "Correspond", details: ["Lyon", "Vous cherchez : Lyon (69003)"] },
        { label: "Salaire", points: "non précisé", status: "Non précisé dans l'offre", details: [] },
        { label: "Type de contrat", points: "non précisé", status: "Non précisé dans l'offre", details: [] },
      ],
      strengthsAndGaps: ["Points forts : IFRS, SAP, expérience et lieu.", "À renforcer : Power BI."],
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

    expect(plain(describeMatchScore(guest, createI18n("fr")).criteria).map(({ label, status, details }) => ({ label, status, details }))).toEqual([
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
      points: "0 / 10",
      fill: 0,
      status: "Ne correspond pas",
      details: ["L'offre : à partir de 60 000 € brut par an", "Votre minimum : 80 000 € brut par an"],
    });
  });
});

describe("a Match Score's strengths and gaps, as the signed-in Candidate reads them beside the ring", () => {
  it("name nothing when nothing could be compared", () => {
    const unknown: MatchScore = {
      score: 0,
      breakdown: {
        skills: { status: "unknown", covered: [], missing: [] },
        seniority: { status: "unknown" },
        location: { status: "unknown" },
        salary: { status: "unknown" },
        contractType: { status: "unknown" },
      },
    };

    const view = describeMatchScore(unknown, createI18n("fr"));

    expect(view.strengthsAndGaps).toEqual([]);
    expect(view.ring).toBeUndefined();
    expect(view.criteria.map((criterion) => criterion.points)).toEqual(Array(5).fill("non précisé"));
  });

  it("name the criteria that do not match among the gaps, in the Interface Language", () => {
    const view = describeMatchScore(
      { ...matchScore, breakdown: { ...matchScore.breakdown, skills: { status: "match", covered: ["IFRS"], missing: [] }, contractType: { status: "mismatch", offer: "freelance", wanted: ["cdi"] } } },
      createI18n("en"),
    );

    expect(view.strengthsAndGaps).toEqual(["Strengths: IFRS, experience, and location.", "To work on: contract type."]);
  });
});

describe("a Match Score on few or no known criteria (#94)", () => {
  const unknown = {
    skills: { status: "unknown", covered: [], missing: [] },
    seniority: { status: "unknown" },
    location: { status: "unknown" },
    salary: { status: "unknown" },
    contractType: { status: "unknown" },
  } as const satisfies MatchScore["breakdown"];

  it("says a score on no known criterion is not computable, never 0 / 100", () => {
    const view = describeMatchScore({ score: 0, breakdown: unknown }, createI18n("fr"));

    expect(view.score).toBe("Match Score : non calculable");
    expect(view.notes).toEqual([expect.stringContaining("Aucun critère n'a pu être comparé")]);
  });

  it("shows a score on one known criterion as partial, not a confident 100 / 100", () => {
    const seniorityOnly: MatchScore = { score: 100, breakdown: { ...unknown, seniority: { status: "match", cvYears: 20, requiredYears: 10 } } };

    expect(describeMatchScore(seniorityOnly, createI18n("fr"))).toMatchObject({
      score: "Match Score : 100 / 100, partiel",
      notes: [expect.stringContaining("seul 1 critère sur 5 a pu être comparé")],
    });
    expect(describeMatchScore(seniorityOnly, createI18n("en")).score).toBe("Match Score: 100 / 100, partial");
  });

  it("says when the offer's text could not be read, so the score uses only what the offer states", () => {
    const view = describeMatchScore({ ...matchScore, offerTextUnread: true }, createI18n("en"));

    expect(view.score).toBe("Match Score: 72 / 100");
    expect(view.notes).toEqual([expect.stringContaining("could not be read")]);
  });

  it("recalls a not computable score as such after a rescore", () => {
    const at = new Date(2026, 9, 10, 14, 32);
    expect(describeRescore({ previous: { score: 0, breakdown: unknown }, current: matchScore, at }, createI18n("fr"))).toBe(
      "Match Score recalculé à 14:32 (avant : non calculable).",
    );
  });
});

describe("a rescore, as the Candidate is told of it (#76)", () => {
  const at = new Date(2026, 9, 10, 14, 32);

  it("confirms when the Match Score was computed again, and that it did not change", () => {
    expect(describeRescore({ previous: matchScore, current: matchScore, at }, createI18n("fr"))).toBe("Match Score recalculé à 14:32 : inchangé.");
  });

  it("confirms when the Match Score was computed again, and what it was before", () => {
    expect(describeRescore({ previous: matchScore, current: { ...matchScore, score: 80 }, at }, createI18n("fr"))).toBe("Match Score recalculé à 14:32 (avant : 72 / 100).");
  });

  it("confirms the rescore when there was no Match Score to compare with", () => {
    expect(describeRescore({ current: matchScore, at }, createI18n("fr"))).toBe("Match Score recalculé à 14:32.");
  });

  it("speaks the Interface Language", () => {
    expect(describeRescore({ previous: matchScore, current: matchScore, at }, createI18n("en"))).toBe("Match Score recalculated at 2:32 PM: unchanged.");
  });
});
