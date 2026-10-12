import { describe, expect, it } from "vitest";
import { withoutIdentity } from "./cv-identity";
import type { CvContent } from "./domain";

const cv: CvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "12 rue de la République, 69002 Lyon",
  summary: "Directrice financière depuis 2005.",
  experience: [{ title: "DAF", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["IFRS"],
  languages: [{ name: "Anglais", level: "courant" }],
  photo: true,
};

describe("a CV without its identity block", () => {
  it("says nothing of the Candidate's name, postal address, phone or email, and keeps everything else", () => {
    expect(withoutIdentity(cv)).toEqual({
      fullName: "",
      headline: "Directrice financière",
      email: "",
      phone: "",
      location: "",
      summary: "Directrice financière depuis 2005.",
      experience: [{ title: "DAF", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
      education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
      skills: ["IFRS"],
      languages: [{ name: "Anglais", level: "courant" }],
      photo: true,
    });
  });
});
