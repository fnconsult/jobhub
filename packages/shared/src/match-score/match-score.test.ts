import { describe, expect, it } from "vitest";
import type { CvContent, JobOfferDetails, SearchCriteria } from "../domain";
import { criterionPoints, matchScoreReliability, scoreMatch, wantedValues, type MatchScore } from "./index";

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

  describe("skills by normalised form and synonyms", () => {
    const coverage = (offerSkill: string, cvSkill: string) =>
      scoreMatch({ cv: { ...cv, headline: "", summary: "", experience: [], skills: [cvSkill] }, jobOffer: { ...offer, skills: [offerSkill] } }).breakdown.skills
        .status;

    it.each([
      // Normalised form: accents, case, plurals, small words.
      ["Trésorerie", "TRESORERIE"],
      ["Gestion des projets", "gestion de projet"],
      ["Comptes consolidés", "compte consolidé"],
      ["Canaux de distribution", "canal de distribution"],
      ["Négociations", "négociation"],
      // Common French/English equivalents.
      ["Gestion de projet", "Project management"],
      ["Project management", "Pilotage de projets"],
      ["Gestion de la chaîne d'approvisionnement", "Supply chain"],
      ["Conduite du changement", "Change management"],
      ["Contrôle de gestion", "Controlling"],
      ["Achats", "Procurement"],
      ["Anglais", "English"],
      // Abbreviations.
      ["P&L", "Compte de résultat"],
      ["Comptes de résultats", "P & L"],
      ["Profit and loss", "P&L"],
      ["S&OP", "Plan industriel et commercial"],
      ["Ressources humaines", "RH"],
      ["KPI", "Indicateurs clés de performance"],
      ["M&A", "Fusions et acquisitions"],
    ])("covers %s with a CV that says %s", (offerSkill, cvSkill) => {
      expect(coverage(offerSkill, cvSkill)).toBe("match");
    });

    it.each([
      ["Power BI", "Business intelligence"],
      ["Gestion de projet agile", "Project management"],
      ["Comptabilité", "Compte de résultat"],
      ["SAP", "Sapin"],
      ["Java", "JavaScript"],
      ["Supply chain", "Chaîne"],
    ])("does not cover %s with a CV that only says %s", (offerSkill, cvSkill) => {
      expect(coverage(offerSkill, cvSkill)).toBe("mismatch");
    });

    describe("abbreviations only in capitals", () => {
      const fromSummary = (offerSkill: string, summary: string) =>
        scoreMatch({ cv: { ...cv, headline: "", summary, experience: [], skills: [] }, jobOffer: { ...offer, skills: [offerSkill] } }).breakdown.skills
          .status;

      it.each([
        ["Intelligence artificielle", "J'ai dirigé une équipe de 40 personnes."],
        ["IA", "Ce que j'ai appris en dix ans de direction."],
        ["S&OP", "Gestion du pic d'activité de Noël."],
        ["Business intelligence", "Reporting bi-mensuel au comité de direction."],
        ["Ressources humaines", "Suivi des Rh positifs en laboratoire."],
      ])("does not cover %s with a CV whose ordinary words only spell an abbreviation: %s", (offerSkill, summary) => {
        expect(fromSummary(offerSkill, summary)).toBe("mismatch");
      });

      it.each([
        ["Intelligence artificielle", "Projets d'IA générative pour la supply chain."],
        ["IA", "Déploiement de l'AI dans les achats."],
        ["S&OP", "Animation du PIC mensuel."],
        ["Business intelligence", "Tableaux de bord BI."],
      ])("covers %s with a CV that writes the abbreviation in capitals: %s", (offerSkill, summary) => {
        expect(fromSummary(offerSkill, summary)).toBe("match");
      });
    });

    it("still covers a skill written inside a longer wording on the CV", () => {
      expect(coverage("Management", "Project management")).toBe("match");
      expect(coverage("Consolidation", "Consolidation des comptes IFRS")).toBe("match");
    });

    it("does not read a skill across two fields of the CV", () => {
      const twoSkills = { ...cv, headline: "", summary: "", experience: [], skills: ["Supply", "Chain"] };
      expect(scoreMatch({ cv: twoSkills, jobOffer: { ...offer, skills: ["Supply chain"] } }).breakdown.skills.status).toBe("mismatch");
    });

    it("covers the baseline Job Offer that scored 55 because its skill was not literally on the CV (#97)", () => {
      // c08 of the Job Search baseline: a relevant Directeur Supply Chain offer in Lille.
      const supplyChainCv: CvContent = {
        ...cv,
        headline: "Directeur Supply Chain – Retail et e-commerce",
        location: "Lille",
        summary: "Directeur supply chain, 23 ans en logistique, S&OP, achats et transport dans le retail et l'e-commerce.",
        experience: [
          { title: "Directeur supply chain", employer: "RetailNord", location: "Lille", period: "2014 – aujourd'hui", description: "Entrepôts, transport, S&OP, prévisions, WMS." },
          { title: "Ingénieur logistique", employer: "Distrib", location: "Lille", period: "2001 – 2005", description: "Flux, approvisionnement." },
        ],
        skills: ["Supply chain", "Logistique", "S&OP", "Transport", "Achats", "Approvisionnement", "WMS", "SAP", "Lean"],
      };
      const jobOffer: JobOfferDetails = {
        title: "Directeur Supply Chain H/F",
        content: "Exp. 15 ans min.",
        location: "Lille - 59",
        contractType: "cdi",
        remoteWork: "on_site",
        salary: { min: 70_000, max: 90_000 },
        skills: ["Gestion de la chaîne d'approvisionnement"],
        requiredExperienceYears: 15,
      };
      const searchCriteria: SearchCriteria = { targetRole: "Directeur supply chain", locations: ["Lille"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [], minSalary: 95_000 };

      const result = scoreMatch({ cv: supplyChainCv, jobOffer, searchCriteria, today: new Date("2026-10-12") });

      expect(result.breakdown.skills).toEqual({ status: "match", covered: ["Gestion de la chaîne d'approvisionnement"], missing: [] });
      // Skills 40 + seniority 20 + location 15 + salary partial 5 + contract type 15 (was 55 with skills a mismatch).
      expect(result.score).toBe(95);
    });
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
    const criteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

    it("matches when the Job Offer is where the Search Criteria want to work", () => {
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer: { ...offer, location: "Lyon 3e (69)" } }).breakdown.location).toEqual({
        status: "match",
        offer: "Lyon 3e (69)",
        wanted: ["Lyon"],
      });
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer: { ...offer, location: "Paris" } }).breakdown.location.status).toBe("mismatch");
    });

    it("matches a Job Offer near any one of several locations (ADR-0025)", () => {
      const twoRegions: SearchCriteria = { ...criteria, locations: ["Lyon", "Bordeaux"] };
      expect(scoreMatch({ cv, searchCriteria: twoRegions, jobOffer: { ...offer, location: "Bordeaux (33)" } }).breakdown.location).toEqual({
        status: "match",
        offer: "Bordeaux (33)",
        wanted: ["Lyon", "Bordeaux"],
      });
      expect(scoreMatch({ cv, searchCriteria: twoRegions, jobOffer: { ...offer, location: "Lille" } }).breakdown.location.status).toBe("mismatch");
    });

    it("matches a fully remote Job Offer wherever it is based", () => {
      const jobOffer = { ...offer, location: "Paris", remoteWork: "full_remote" as const };
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer }).breakdown.location.status).toBe("match");
    });

    it("uses the CV's location for a Guest without Search Criteria, and is unknown when the Job Offer gives none", () => {
      expect(scoreMatch({ cv, jobOffer: { ...offer, location: "Villeurbanne, Lyon" } }).breakdown.location).toEqual({
        status: "match",
        offer: "Villeurbanne, Lyon",
        wanted: ["Lyon"],
      });
      expect(scoreMatch({ cv, searchCriteria: criteria, jobOffer: offer }).breakdown.location).toEqual({ status: "unknown", wanted: ["Lyon"] });
    });
  });

  describe("salary", () => {
    const criteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], minSalary: 100_000, contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
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
      expect(salaryOf({ max: 90_000 }, { ...criteria, minSalary: undefined })).toEqual({ status: "unknown", offer: { max: 90_000 } });
    });
  });

  it("compares the Job Offer's contract type with the one the Search Criteria want", () => {
    const searchCriteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
    expect(scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, contractType: "cdi" } }).breakdown.contractType).toEqual({
      status: "match",
      offer: "cdi",
      wanted: ["cdi"],
    });
    expect(scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, contractType: "cdd" } }).breakdown.contractType.status).toBe("mismatch");
    expect(scoreMatch({ cv, jobOffer: { ...offer, contractType: "cdd" } }).breakdown.contractType).toEqual({ status: "unknown", offer: "cdd" });
  });

  it("matches a contract type when the Job Offer's is any one of those wanted, and has no preference when none is (ADR-0025)", () => {
    const searchCriteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi", "freelance"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
    expect(scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, contractType: "freelance" } }).breakdown.contractType).toEqual({
      status: "match",
      offer: "freelance",
      wanted: ["cdi", "freelance"],
    });
    expect(scoreMatch({ cv, searchCriteria, jobOffer: { ...offer, contractType: "cdd" } }).breakdown.contractType.status).toBe("mismatch");
    const noPreference = { ...searchCriteria, contractTypes: [] };
    expect(scoreMatch({ cv, searchCriteria: noPreference, jobOffer: { ...offer, contractType: "cdd" } }).breakdown.contractType).toEqual({
      status: "unknown",
      offer: "cdd",
    });
  });

  it("reads a wanted value kept from before ADR-0025 as a list of one", () => {
    expect(wantedValues({ status: "match", offer: "Lyon", wanted: "Lyon" })).toEqual(["Lyon"]);
    expect(wantedValues({ status: "match", offer: "cdi", wanted: ["cdi", "freelance"] })).toEqual(["cdi", "freelance"]);
    expect(wantedValues({ status: "unknown" })).toEqual([]);
  });

  describe("score", () => {
    const today = new Date("2026-10-06");
    const searchCriteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], minSalary: 100_000, contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
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

  describe("reliability (#94)", () => {
    const today = new Date("2026-10-06");
    const searchCriteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], minSalary: 100_000, contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

    it("is not computable when no criterion is known, rather than a score of 0", () => {
      const matchScore = scoreMatch({ cv: { ...cv, location: "", experience: [] }, jobOffer: { title: "DAF", content: "" }, today });
      expect(matchScoreReliability(matchScore)).toBe("not_computable");
    });

    it("is partial when only seniority is known, so its 100 is not a confident one", () => {
      const matchScore = scoreMatch({ cv, searchCriteria, jobOffer: { title: "DAF", content: "10 ans d'expérience minimum." }, today });
      expect(matchScore.score).toBe(100);
      expect(matchScoreReliability(matchScore)).toBe("partial");
    });

    it("is reliable once the known criteria weigh half the score or more (skills and seniority)", () => {
      const jobOffer: JobOfferDetails = { ...offer, skills: ["IFRS"], requiredExperienceYears: 10 };
      expect(matchScoreReliability(scoreMatch({ cv, searchCriteria, jobOffer, today }))).toBe("reliable");
      const located: JobOfferDetails = { title: "DAF", content: "", location: "Lyon", contractType: "cdi", salary: { max: 120_000 } };
      expect(matchScoreReliability(scoreMatch({ cv, searchCriteria, jobOffer: located, today }))).toBe("partial");
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

describe("each criterion's points, as the Match Score's detail draws them in bars", () => {
  const breakdown: MatchScore["breakdown"] = {
    skills: { status: "partial", covered: ["IFRS", "SAP"], missing: ["Power BI"] },
    seniority: { status: "match", cvYears: 25, requiredYears: 15 },
    location: { status: "partial", offer: "Lyon" },
    salary: { status: "unknown" },
    contractType: { status: "mismatch", offer: "freelance", wanted: ["cdi"] },
  };

  it("are what the CV earns out of what the criterion weighs, rounded to whole points", () => {
    expect(criterionPoints(breakdown, "skills")).toEqual({ earned: 27, possible: 40 });
    expect(criterionPoints(breakdown, "seniority")).toEqual({ earned: 20, possible: 20 });
    expect(criterionPoints(breakdown, "location")).toEqual({ earned: 8, possible: 15 });
    expect(criterionPoints(breakdown, "contractType")).toEqual({ earned: 0, possible: 15 });
  });

  it("are none for a criterion that could not be compared", () => {
    expect(criterionPoints(breakdown, "salary")).toBeUndefined();
  });
});
