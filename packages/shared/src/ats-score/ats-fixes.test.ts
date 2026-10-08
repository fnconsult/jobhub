import { describe, expect, it } from "vitest";
import type { CvContent } from "../domain";
import { applyAtsFix, proposeAtsFixes, scoreAts, type AtsFix } from "./index";

const today = new Date("2026-10-08T12:00:00Z");
const targetRole = "Directrice financière";

const cv: CvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "J'ai piloté la trésorerie d'un groupe coté.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – aujourd'hui", description: "Budget et consolidation." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Budget", "Consolidation", "Reporting", "Contrôle de gestion", "Clôture", "ERP"],
  languages: [],
};

const fixesFor = (content: CvContent) => proposeAtsFixes({ cv: content, targetRole, today });
const only = (fixes: AtsFix[], reason: AtsFix["reason"]) => fixes.filter((fix) => fix.reason === reason);

describe("ATS Fixes", () => {
  it("proposes none for a CV with nothing to fix", () => {
    expect(fixesFor({ ...cv, skills: [...cv.skills, "Trésorerie"] })).toEqual([]);
  });

  it("lists in the skills a keyword the CV only mentions, one fix per keyword", () => {
    const fixes = fixesFor(cv);

    expect(fixes).toEqual([
      { id: "list_skill:Trésorerie", category: "keywords", reason: "keyword_not_listed", change: { type: "list_skill", skill: "Trésorerie" } },
    ]);
    const fixed = applyAtsFix(cv, fixes[0]!)!;
    expect(fixed.skills).toEqual([...cv.skills, "Trésorerie"]);
    expect(scoreAts({ cv: fixed, targetRole }).score).toBeGreaterThan(scoreAts({ cv, targetRole }).score);
  });

  it("never adds a keyword the CV does not show: only the Candidate can", () => {
    const fixes = fixesFor({ ...cv, skills: ["IFRS", "SAP", "Budget"] });

    expect(fixes.map((fix) => fix.change)).not.toContainEqual({ type: "list_skill", skill: "ERP" });
  });

  it("puts the target role in a missing headline, or in place of one that does not name it", () => {
    expect(only(fixesFor({ ...cv, headline: "" }), "headline_missing")).toEqual([
      { id: "set_headline", category: "readability", reason: "headline_missing", change: { type: "set_headline", headline: targetRole } },
    ]);
    const fixes = only(fixesFor({ ...cv, headline: "Cadre dirigeante", experience: [] }), "headline_without_role");
    expect(fixes).toEqual([
      { id: "set_headline", category: "keywords", reason: "headline_without_role", change: { type: "set_headline", headline: targetRole } },
    ]);
    expect(applyAtsFix({ ...cv, headline: "Cadre dirigeante" }, fixes[0]!)!.headline).toBe(targetRole);
  });

  it("splits skills written on one line into one skill each", () => {
    const content = { ...cv, skills: ["IFRS, SAP ; Budget", ...cv.skills.slice(3)] };
    const [fix] = only(fixesFor(content), "skills_on_one_line");

    expect(fix).toEqual({
      id: "split_skill:IFRS, SAP ; Budget",
      category: "readability",
      reason: "skills_on_one_line",
      change: { type: "split_skill", skill: "IFRS, SAP ; Budget", into: ["IFRS", "SAP", "Budget"] },
    });
    expect(applyAtsFix(content, fix!)!.skills).toEqual(cv.skills);
  });

  it("removes emoji and symbols an ATS reads as noise", () => {
    const content = { ...cv, summary: "★ J'ai piloté la trésorerie ✓", skills: [...cv.skills, "Trésorerie"] };
    const [fix] = only(fixesFor(content), "decorations");

    expect(fix).toEqual({ id: "remove_decorations", category: "readability", reason: "decorations", change: { type: "remove_decorations" } });
    expect(applyAtsFix(content, fix!)!.summary).toBe("J'ai piloté la trésorerie");
  });

  it("changes nothing else on the CV", () => {
    const content = { ...cv, headline: "" };
    const [fix] = only(fixesFor(content), "headline_missing");

    expect(applyAtsFix(content, fix!)).toEqual({ ...content, headline: targetRole });
  });

  it("applies to nothing once the CV no longer has what the fix changes", () => {
    const listed = { ...cv, skills: [...cv.skills, "Trésorerie"] };
    expect(applyAtsFix(listed, { id: "list_skill:Trésorerie", category: "keywords", reason: "keyword_not_listed", change: { type: "list_skill", skill: "Trésorerie" } })).toBeNull();
    expect(applyAtsFix(cv, { id: "remove_decorations", category: "readability", reason: "decorations", change: { type: "remove_decorations" } })).toBeNull();
    expect(
      applyAtsFix(cv, { id: "split_skill:A, B", category: "readability", reason: "skills_on_one_line", change: { type: "split_skill", skill: "A, B", into: ["A", "B"] } }),
    ).toBeNull();
  });

  describe("Senior Advice", () => {
    const withSkills = { ...cv, skills: [...cv.skills, "Trésorerie"] };

    it("removes a birth date or an age", () => {
      const content = { ...withSkills, headline: "Directrice financière, 58 ans", summary: "Née le 12/03/1968. J'ai piloté la trésorerie d'un groupe coté." };
      const fixes = fixesFor(content).filter((fix) => fix.category === "senior_advice");

      expect(fixes).toEqual([
        { id: "replace_text:, 58 ans", category: "senior_advice", reason: "age", change: { type: "replace_text", from: ", 58 ans", to: "" } },
        {
          id: "replace_text:Née le 12/03/1968.",
          category: "senior_advice",
          reason: "birth_date",
          change: { type: "replace_text", from: "Née le 12/03/1968.", to: "" },
        },
      ]);
      expect(applyAtsFix(content, fixes[0]!)!.headline).toBe("Directrice financière");
      expect(applyAtsFix(content, fixes[1]!)!.summary).toBe("J'ai piloté la trésorerie d'un groupe coté.");
    });

    it("finds other ways of writing a birth date, but not a duration", () => {
      const reasons = (summary: string) => fixesFor({ ...withSkills, summary }).map((fix) => fix.reason);

      expect(reasons("Date de naissance : 3 mars 1968")).toEqual(["birth_date"]);
      expect(reasons("Né en 1966, j'ai dirigé des équipes.")).toEqual(["birth_date"]);
      expect(reasons("J'ai dirigé la trésorerie pendant 12 ans.")).toEqual([]);
    });

    it("caps a long experience at « plus de 15 ans d'expérience »", () => {
      const content = { ...withSkills, summary: "Plus de 30 ans d'expérience en finance d'entreprise." };
      const [fix] = fixesFor(content);

      expect(fix).toEqual({
        id: "replace_text:Plus de 30 ans d'expérience",
        category: "senior_advice",
        reason: "experience_years",
        change: { type: "replace_text", from: "Plus de 30 ans d'expérience", to: "Plus de 15 ans d'expérience" },
      });
      expect(applyAtsFix(content, fix!)!.summary).toBe("Plus de 15 ans d'expérience en finance d'entreprise.");
      expect(fixesFor({ ...withSkills, summary: "12 ans d'expérience en finance." })).toEqual([]);
    });

    it("proposes leaving out the photo of a CV that shows one", () => {
      const content = { ...withSkills, photo: true };
      const fixes = fixesFor(content);

      expect(fixes).toEqual([{ id: "remove_photo", category: "senior_advice", reason: "photo", change: { type: "remove_photo" } }]);
      expect(applyAtsFix(content, fixes[0]!)).toEqual({ ...content, photo: false });
      expect(fixesFor({ ...content, photo: false })).toEqual([]);
      expect(fixesFor(withSkills)).toEqual([]);
      expect(applyAtsFix({ ...content, photo: false }, fixes[0]!)).toBeNull();
    });

    it("proposes leaving out a job that ended more than 20 years ago", () => {
      const old = { title: "Comptable", employer: "Fiduciaire Rhône", location: "Lyon", period: "1988 – 1995", description: "" };
      const content = { ...withSkills, experience: [...withSkills.experience, old] };
      const [fix] = fixesFor(content);

      expect(fix).toEqual({
        id: "remove_experience:Comptable|Fiduciaire Rhône|1988 – 1995",
        category: "senior_advice",
        reason: "old_experience",
        change: { type: "remove_experience", experience: { title: "Comptable", employer: "Fiduciaire Rhône", period: "1988 – 1995" } },
      });
      expect(applyAtsFix(content, fix!)!.experience).toEqual(withSkills.experience);
      expect(fixesFor({ ...withSkills, experience: [...withSkills.experience, { ...old, period: "2004 – 2010" }] })).toEqual([]);
    });
  });
});
