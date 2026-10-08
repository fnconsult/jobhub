import { describe, expect, it } from "vitest";
import type { CvContent } from "../domain";
import { scoreAts } from "./index";

/** A Master CV an ATS reads without trouble, for a finance role. */
const readableCv: CvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Directrice financière dans l'industrie, j'ai piloté la trésorerie et le reporting d'un groupe coté.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Budget, clôture mensuelle et consolidation." },
    { title: "Contrôleuse de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "Contrôle de gestion industriel." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Budget", "Consolidation"],
  languages: [{ name: "Anglais", level: "courant" }],
};

describe("ATS Score", () => {
  it("is 100 for a readable CV that lists every keyword of the target role", () => {
    const cv = { ...readableCv, skills: ["IFRS", "ERP", "Budget", "Consolidation", "Reporting", "Trésorerie", "Contrôle de gestion", "Clôture"] };

    const result = scoreAts({ cv, targetRole: "Directrice financière" });

    expect(result.score).toBe(100);
    expect(result.breakdown.readability).toEqual({
      score: 100,
      checks: [
        { check: "contact", passed: true },
        { check: "headline", passed: true },
        { check: "summary", passed: true },
        { check: "datedExperience", passed: true },
        { check: "skillsList", passed: true },
        { check: "plainText", passed: true },
      ],
    });
    expect(result.breakdown.keywords.missing).toEqual([]);
    expect(result.breakdown.keywords.mentioned).toEqual([]);
    expect(result.breakdown.keywords.score).toBe(100);
  });

  it("counts a keyword only mentioned in the text for half of one listed in the headline or skills", () => {
    const result = scoreAts({ cv: readableCv, targetRole: "Directrice financière" });

    // Finance keywords: the target role, Budget, Reporting, Contrôle de gestion, Trésorerie, Consolidation, IFRS, Clôture, ERP.
    expect(result.breakdown.keywords).toEqual({
      score: 67, // 4 listed + 4 mentioned × ½ = 6 of 9
      listed: ["Directrice financière", "Budget", "Consolidation", "IFRS"],
      mentioned: ["Reporting", "Contrôle de gestion", "Trésorerie", "Clôture"],
      missing: ["ERP"],
    });
    expect(result.score).toBe(83); // half Readability (100), half keywords (66.7)
  });

  it("loses Readability for each thing an ATS cannot read: contact, headline, summary, dates, a skills list, plain text", () => {
    const cv: CvContent = {
      ...readableCv,
      phone: "",
      headline: "",
      summary: "",
      experience: [{ ...readableCv.experience[0]!, period: "Depuis toujours" }],
      skills: ["IFRS, SAP, Budget, Consolidation"],
      education: [{ degree: "★ Master Finance", institution: "ESSEC", year: "1998" }],
    };

    const { readability } = scoreAts({ cv, targetRole: "Directrice financière" }).breakdown;

    expect(readability.score).toBe(0);
    expect(readability.checks.every((item) => !item.passed)).toBe(true);
  });

  it("scores Readability by the share of checks passed", () => {
    const { readability } = scoreAts({ cv: { ...readableCv, summary: "", phone: "" }, targetRole: "Directrice financière" }).breakdown;

    expect(readability.score).toBe(67); // 4 of 6
    expect(readability.checks.filter((item) => !item.passed).map((item) => item.check)).toEqual(["contact", "summary"]);
  });

  it("looks for the keywords of the target role's family, and the role itself, ignoring case and accents", () => {
    const cv = { ...readableCv, headline: "DRH", skills: ["recrutement", "paie", "SIRH"], summary: "", experience: [] };

    const { keywords } = scoreAts({ cv, targetRole: "Responsable des ressources humaines" }).breakdown;

    expect(keywords.listed).toEqual(["Recrutement", "Paie", "SIRH"]);
    expect(keywords.missing).toContain("Responsable des ressources humaines");
    expect(keywords.score).toBe(33); // 3 of 9
  });

  it("finds the target role in a job title too", () => {
    const cv = { ...readableCv, headline: "Cadre dirigeante" };

    expect(scoreAts({ cv, targetRole: "Directrice financière" }).breakdown.keywords.listed).toContain("Directrice financière");
  });

  it("falls back on what any senior role shows for a role outside the known families", () => {
    const cv = { ...readableCv, headline: "Chef de cuisine", skills: ["Management d'équipe", "Budget"], summary: "Pilotage d'une brigade." };

    expect(scoreAts({ cv, targetRole: "Chef de cuisine" }).breakdown.keywords).toEqual({
      score: 70, // 3 listed + 1 mentioned × ½ = 3.5 of 5
      listed: ["Chef de cuisine", "Management d'équipe", "Budget"],
      mentioned: ["Pilotage"],
      missing: ["Gestion de projet"],
    });
  });
});
