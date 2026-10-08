import { describe, expect, it } from "vitest";
import type { CvContent, JobOfferDetails, SearchCriteria } from "../domain";
import { scoreMatch } from "./index";

const cv: CvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Pilotage financier et contrôle de gestion dans l'industrie.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2010 – 2024", description: "Consolidation des comptes, reporting IFRS." },
  ],
  education: [],
  skills: ["IFRS", "SAP", "Trésorerie"],
  languages: [],
};

const offer: JobOfferDetails = {
  title: "Directeur administratif et financier",
  content: "Nous recherchons un DAF.",
  skills: ["IFRS", "SAP", "Consolidation", "Power BI"],
};

describe("Match Score", () => {
  it("lists the Job Offer's skills the CV covers and those it misses, ignoring case and accents", () => {
    const { breakdown } = scoreMatch({ cv, jobOffer: { ...offer, skills: ["ifrs", "Sap", "consolidation", "Power BI", "tresorerie"] } });

    expect(breakdown.skills).toEqual({ status: "partial", covered: ["ifrs", "Sap", "consolidation", "tresorerie"], missing: ["Power BI"] });
  });

  describe("seniority", () => {
    const today = new Date("2026-10-06");
    const career: CvContent = {
      ...cv,
      experience: [
        { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – aujourd'hui", description: "" },
        { title: "Contrôleuse de gestion", employer: "Renault", location: "Paris", period: "sept. 1998 - 2015", description: "" },
      ],
    };

    it("compares the years of experience on the CV with those the Job Offer asks for", () => {
      expect(scoreMatch({ cv: career, jobOffer: { ...offer, requiredExperienceYears: 15 }, today }).breakdown.seniority).toEqual({
        status: "match",
        cvYears: 28,
        requiredYears: 15,
      });
      expect(scoreMatch({ cv: career, jobOffer: { ...offer, requiredExperienceYears: 32 }, today }).breakdown.seniority.status).toBe("partial");
      expect(scoreMatch({ cv: career, jobOffer: { ...offer, requiredExperienceYears: 40 }, today }).breakdown.seniority.status).toBe("mismatch");
    });

    it("reads the years asked for from the posting's text when they are not given", () => {
      const jobOffer = { ...offer, content: "Profil : 10 ans d'expérience minimum en direction financière." };
      expect(scoreMatch({ cv: career, jobOffer, today }).breakdown.seniority).toEqual({ status: "match", cvYears: 28, requiredYears: 10 });
      const english = { ...offer, content: "You have 12+ years of experience in finance." };
      expect(scoreMatch({ cv: career, jobOffer: english, today }).breakdown.seniority.requiredYears).toBe(12);
    });

    it("counts a current job written 'Depuis 2015' or 'Since 2015' up to today", () => {
      for (const period of ["Depuis 2015", "depuis sept. 2015", "Since 2015"]) {
        const current = { ...cv, experience: [{ ...career.experience[0]!, period }] };
        expect(scoreMatch({ cv: current, jobOffer: { ...offer, requiredExperienceYears: 5 }, today }).breakdown.seniority).toEqual({
          status: "match",
          cvYears: 11,
          requiredYears: 5,
        });
      }
    });

    it("is unknown when the Job Offer does not say, or the CV has no dated experience", () => {
      expect(scoreMatch({ cv: career, jobOffer: offer, today }).breakdown.seniority).toEqual({ status: "unknown", cvYears: 28 });
      const undated = { ...career, experience: [{ ...career.experience[0]!, period: "" }] };
      expect(scoreMatch({ cv: undated, jobOffer: { ...offer, requiredExperienceYears: 10 }, today }).breakdown.seniority).toEqual({
        status: "unknown",
        requiredYears: 10,
      });
    });
  });

  describe("location", () => {
    const criteria = { targetRole: "DAF", location: "Lyon" };

    it("matches when the Job Offer is where the Search Criteria want to work", () => {
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer: { ...offer, location: "Lyon 3e (69)" } }).breakdown.location).toEqual({
        status: "match",
        offer: "Lyon 3e (69)",
        wanted: "Lyon",
      });
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer: { ...offer, location: "Paris" } }).breakdown.location.status).toBe("mismatch");
    });

    it("matches a fully remote Job Offer wherever it is based", () => {
      const jobOffer = { ...offer, location: "Paris", remoteWork: "full_remote" as const };
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer }).breakdown.location.status).toBe("match");
    });

    it("uses the CV's location for a Guest without Search Criteria, and is unknown when the Job Offer gives none", () => {
      expect(scoreMatch({ cv, jobOffer: { ...offer, location: "Villeurbanne, Lyon" } }).breakdown.location).toEqual({
        status: "match",
        offer: "Villeurbanne, Lyon",
        wanted: "Lyon",
      });
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer: offer }).breakdown.location).toEqual({ status: "unknown", wanted: "Lyon" });
    });
  });

  describe("salary", () => {
    const criteria = { targetRole: "DAF", location: "Lyon", minSalary: 100_000 };
    const salaryOf = (salary: JobOfferDetails["salary"], searchCriteria: SearchCriteria = criteria) =>
      scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, salary } }).breakdown.salary;

    it("matches when the Job Offer can pay the minimum salary of the Search Criteria", () => {
      expect(salaryOf({ min: 90_000, max: 110_000 })).toEqual({ status: "match", offer: { min: 90_000, max: 110_000 }, wanted: 100_000 });
      expect(salaryOf({ min: 120_000 }).status).toBe("match");
    });

    it("is partial when the Job Offer pays up to 10% less, and a mismatch below", () => {
      expect(salaryOf({ max: 92_000 }).status).toBe("partial");
      expect(salaryOf({ min: 70_000, max: 85_000 }).status).toBe("mismatch");
    });

    it("is unknown when the Job Offer gives no salary or the Search Criteria no minimum", () => {
      expect(salaryOf(undefined)).toEqual({ status: "unknown", wanted: 100_000 });
      expect(salaryOf({ max: 90_000 }, { targetRole: "DAF", location: "Lyon" })).toEqual({ status: "unknown", offer: { max: 90_000 } });
    });
  });

  it("compares the Job Offer's contract type with the one the Search Criteria want", () => {
    const searchCriteria = { targetRole: "DAF", location: "Lyon", contractType: "cdi" as const };
    expect(scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, contractType: "cdi" } }).breakdown.contractType).toEqual({
      status: "match",
      offer: "cdi",
      wanted: "cdi",
    });
    expect(scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, contractType: "cdd" } }).breakdown.contractType.status).toBe("mismatch");
    expect(scoreMatch({ cv, jobOffer: { ...offer, contractType: "cdd" } }).breakdown.contractType).toEqual({ status: "unknown", offer: "cdd" });
  });

  describe("score", () => {
    const today = new Date("2026-10-06");
    const searchCriteria = { targetRole: "DAF", location: "Lyon", minSalary: 100_000, contractType: "cdi" as const };
    const fullMatch: JobOfferDetails = {
      ...offer,
      skills: ["IFRS", "SAP"],
      requiredExperienceYears: 10,
      location: "Lyon",
      salary: { max: 120_000 },
      contractType: "cdi",
    };

    it("is 100 when every criterion matches", () => {
      expect(scoreMatch({ cv, searchCriteria, jobOffer: fullMatch, today }).score).toBe(100);
    });

    it("weighs skills 40, seniority 20, location 15, contract type 15 and salary 10, leaving out what is unknown", () => {
      // Skills 3 of 4 (30/40), seniority match (20/20), location mismatch (0/15),
      // salary unknown (left out), contract type match (15/15): 65 / 90 = 72.
      const jobOffer: JobOfferDetails = { ...fullMatch, skills: ["IFRS", "SAP", "Consolidation", "Power BI"], location: "Paris", salary: undefined };
      expect(scoreMatch({ cv, searchCriteria, jobOffer, today }).score).toBe(72);
      // Partial seniority and salary count for half: skills 40 + seniority 10 + location 15 + salary 5 + contract 0 = 70.
      const partial: JobOfferDetails = { ...fullMatch, requiredExperienceYears: 18, salary: { max: 95_000 }, contractType: "cdd" };
      expect(scoreMatch({ cv, searchCriteria, jobOffer: partial, today }).score).toBe(70);
    });

    it("is 0 when nothing can be compared", () => {
      const bare = { ...cv, location: "", experience: [] };
      expect(scoreMatch({ cv: bare, jobOffer: { title: "DAF", content: "" }, today }).score).toBe(0);
    });
  });

  it("scores a Tailored CV like its Master CV, so a skill the Candidate confirmed for this Job Offer raises the score", () => {
    const jobOffer = { ...offer, skills: ["IFRS", "Power BI"] };
    const tailoredCv: CvContent = { ...cv, skills: [...cv.skills, "Power BI"] };

    const master = scoreMatch({ cv, jobOffer });
    const tailored = scoreMatch({ cv: tailoredCv, jobOffer });

    expect(master).toMatchObject({ score: 50, breakdown: { skills: { covered: ["IFRS"], missing: ["Power BI"] } } });
    expect(tailored).toMatchObject({ score: 100, breakdown: { skills: { status: "match", covered: ["IFRS", "Power BI"], missing: [] } } });
  });
});
