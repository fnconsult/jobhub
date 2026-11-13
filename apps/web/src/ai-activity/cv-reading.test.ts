import { describe, expect, it } from "vitest";
import { nextCreation } from "./creation";
import { readFields, type T } from "./cv-reading";

/** A `t` that writes its key and options, enough to see which words a field gets. */
const t: T = (key, options) => (options ? `${key}${JSON.stringify(options)}` : key);
const cv = (skills: string[], periods: string[]) => ({ skills, experience: periods.map((period) => ({ title: "", employer: "", location: "", period, description: "" })) });

describe("the fields of a CV read on « Créer un profil » (#1003)", () => {
  it("gives each field in words, in its order, null for one the CV does not give", () => {
    const fields = readFields({ masterCv: cv(["IFRS", "SAP"], ["2015 – 2024"]), searchCriteria: { targetRole: " DAF ", locations: ["Lyon", "Paris"] } }, t, "fr");
    expect(fields).toEqual([
      { field: "targetRole", value: "DAF" },
      { field: "experience", value: 'newProfile.fromCv.years{"count":9}' },
      { field: "location", value: "Lyon, Paris" },
      { field: "skills", value: "IFRS, SAP" },
      { field: "contractTypes", value: null },
      { field: "minSalary", value: null },
    ]);
  });

  it("says none for an empty role, place, skills or undated jobs; counts the skills past five; words contracts and a salary", () => {
    const empty = readFields({ masterCv: cv([], ["Groupe Seb"]), searchCriteria: { targetRole: "", locations: [] } }, t, "fr");
    expect(empty.every(({ value }) => value === null)).toBe(true);
    const more = readFields({ masterCv: cv(["a", "b", "c", "d", "e", "f", "g"], []), searchCriteria: { targetRole: "", locations: [], contractTypes: ["cdi"], minSalary: 55_000 } }, t, "fr");
    expect(more.find(({ field }) => field === "skills")!.value).toBe('newProfile.fromCv.moreSkills{"skills":"a, b, c, d, e","count":2}');
    expect(more.find(({ field }) => field === "contractTypes")!.value).toBe("cvReview.contractTypes.cdi");
    expect(more.find(({ field }) => field === "minSalary")!.value).toBe("55 000 €");
  });

  it("is kept with the CV read in « Création du profil », with when", () => {
    const fields = [{ field: "targetRole" as const, value: "DAF" }];
    expect(nextCreation(null, { type: "read", provenance: null, fields }, "2026-11-13T10:00:00.000Z")).toEqual({ reading: { provenance: null, at: "2026-11-13T10:00:00.000Z", fields } });
  });
});
