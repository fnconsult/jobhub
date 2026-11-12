import { describe, expect, it } from "vitest";
import type { CvExperience, MasterCvContent, SearchCriteria } from "./domain";
import { profileSummary, summaryText, type ProfileSummaryInput, type SummaryPart } from "./profile-summary";

const TODAY = new Date("2026-11-12T10:00:00Z");

const job = (title: string, employer: string, period: string): CvExperience => ({ title, employer, location: "", period, description: "" });

const EMPTY_CV: Pick<MasterCvContent, "experience" | "skills"> = { experience: [], skills: [] };

const FULL: ProfileSummaryInput = {
  searchCriteria: {
    targetRole: "Directrice financière",
    locations: ["Lyon", "Paris"],
    minSalary: 85000,
    contractTypes: ["cdi"],
    remoteWorkOptions: ["hybrid"],
    sectors: [],
    subsectors: [],
    domains: [],
  },
  masterCv: {
    experience: [job("Responsable du contrôle de gestion", "Valmont", "2007 – 2015"), job("Directrice financière", "Groupe Seb", "2015 – 2024")],
    skills: ["Consolidation", "IFRS", "SAP", "Trésorerie", "Management"],
  },
};

const fr = (profile: ProfileSummaryInput) => profileSummary(profile, { locale: "fr", today: TODAY });
const en = (profile: ProfileSummaryInput) => profileSummary(profile, { locale: "en", today: TODAY });
/** The paragraph as read, without the narrow no-break spaces Intl puts in amounts. */
const text = (parts: SummaryPart[]) => summaryText(parts).replace(/[\u202f\u00a0]/g, " ");
const strong = (parts: SummaryPart[]) => parts.filter((part) => part.strong).map((part) => part.text.replace(/[\u202f\u00a0]/g, " "));
const criteria = (searchCriteria: Partial<SearchCriteria>, masterCv = EMPTY_CV): ProfileSummaryInput => ({ searchCriteria, masterCv });

describe("profileSummary", () => {
  it("says the whole search in French, its key items strong", () => {
    const parts = fr(FULL);
    expect(text(parts)).toBe(
      "Vous recherchez un poste de Directrice financière en CDI, en télétravail partiel, à partir de 85 000 € brut par an ; lieux : Lyon ou Paris. " +
        "Avec 17 ans d'expérience, vous mettez en avant vos compétences Consolidation, IFRS, SAP et Trésorerie. " +
        "Vos derniers postes : Directrice financière chez Groupe Seb et Responsable du contrôle de gestion chez Valmont.",
    );
    expect(strong(parts)).toEqual([
      "Directrice financière",
      "CDI",
      "en télétravail partiel",
      "85 000 €",
      "Lyon",
      "Paris",
      "17 ans d'expérience",
      "Consolidation",
      "IFRS",
      "SAP",
      "Trésorerie",
      "Directrice financière",
      "Responsable du contrôle de gestion",
    ]);
  });

  it("says the same in English", () => {
    expect(text(en(FULL))).toBe(
      "You are looking for a position as Directrice financière on a permanent contract, partly remote, from €85,000 gross a year, in Lyon or Paris. " +
        "With 17 years of experience, you highlight your skills in Consolidation, IFRS, SAP, and Trésorerie. " +
        "Your latest roles: Directrice financière at Groupe Seb and Responsable du contrôle de gestion at Valmont.",
    );
  });

  it("says nothing when the Profile says nothing", () => {
    expect(fr(criteria({ targetRole: "", locations: [] }))).toEqual([]);
    expect(en(criteria({}))).toEqual([]);
  });

  it("leaves out every criterion the Profile does not have, never inventing one", () => {
    const parts = fr(criteria({ targetRole: "Contrôleur de gestion", locations: ["Nantes"], contractTypes: [], remoteWorkOptions: [] }));
    expect(text(parts)).toBe("Vous recherchez un poste de Contrôleur de gestion ; lieu : Nantes.");
    expect(text(fr(criteria({ targetRole: "Contrôleur de gestion", locations: [] })))).toBe("Vous recherchez un poste de Contrôleur de gestion.");
    expect(text(fr(criteria({ targetRole: "", locations: ["Nantes"], minSalary: 50000 })))).toBe("Vous recherchez un poste, à partir de 50 000 € brut par an ; lieu : Nantes.");
    // No salary of zero, and no figure that is not a number.
    expect(text(fr(criteria({ targetRole: "Comptable", locations: [], minSalary: 0 })))).toBe("Vous recherchez un poste de Comptable.");
  });

  it("joins several contracts, places and remote options with « ou » / « or »", () => {
    const profile = criteria({
      targetRole: "Comptable",
      locations: ["Lyon", "Grenoble", "Annecy"],
      contractTypes: ["cdi", "cdd", "interim"],
      remoteWorkOptions: ["on_site", "full_remote"],
    });
    expect(text(fr(profile))).toBe("Vous recherchez un poste de Comptable en CDI, CDD ou intérim, sur site ou en télétravail complet ; lieux : Lyon, Grenoble ou Annecy.");
    expect(text(en(profile))).toBe(
      "You are looking for a position as Comptable on a permanent, fixed-term, or temporary contract, on site or fully remote, in Lyon, Grenoble, or Annecy.",
    );
  });

  it("names the places in French without a preposition, right for a town, a région or a département alike", () => {
    expect(text(fr(criteria({ targetRole: "Comptable", locations: ["Île-de-France"] })))).toBe("Vous recherchez un poste de Comptable ; lieu : Île-de-France.");
    expect(text(fr(criteria({ targetRole: "Comptable", locations: ["Rhône", "Lyon"] })))).toBe("Vous recherchez un poste de Comptable ; lieux : Rhône ou Lyon.");
  });

  it("elides « de » before a vowel in French", () => {
    expect(text(fr(criteria({ targetRole: "Analyste financier", locations: [] })))).toBe("Vous recherchez un poste d'Analyste financier.");
    expect(text(fr(criteria({ targetRole: "Ingénieure qualité", locations: [] })))).toBe("Vous recherchez un poste d'Ingénieure qualité.");
  });

  it("counts the years of experience from the dated jobs, as the Match Score does, in the singular and plural", () => {
    const oneYear = { experience: [job("Assistante", "Acme", "2023 – 2024")], skills: [] };
    expect(text(fr(criteria({}, oneYear)))).toBe("Vous avez 1 an d'expérience. Votre dernier poste : Assistante chez Acme.");
    expect(text(en(criteria({}, oneYear)))).toBe("You have 1 year of experience. Your latest role: Assistante at Acme.");
    // An ongoing job runs to today.
    const ongoing = { experience: [job("Directrice", "Acme", "2016 – aujourd'hui")], skills: [] };
    expect(text(fr(criteria({}, ongoing)))).toContain("Vous avez 10 ans d'expérience.");
  });

  it("leaves the years out when no job is dated, or when they make less than one", () => {
    const undated = { experience: [job("Assistante", "", "")], skills: ["Excel"] };
    expect(text(fr(criteria({}, undated)))).toBe("Vous mettez en avant votre compétence Excel. Votre dernier poste : Assistante.");
    const sameYear = { experience: [job("Stagiaire", "Acme", "2024")], skills: [] };
    expect(text(fr(criteria({}, sameYear)))).toBe("Votre dernier poste : Stagiaire chez Acme.");
  });

  it("names the main skills, the first ones listed, each once", () => {
    const cv = { experience: [], skills: ["SAP", " sap ", "", "IFRS"] };
    expect(text(fr(criteria({}, cv)))).toBe("Vous mettez en avant vos compétences SAP et IFRS.");
    expect(text(en(criteria({}, cv)))).toBe("You highlight your skills in SAP and IFRS.");
    expect(text(en(criteria({}, { experience: [], skills: ["SAP"] })))).toBe("You highlight your skill in SAP.");
  });

  it("names the latest roles, the one ending latest first, those without a title left out", () => {
    const cv = {
      experience: [job("", "Sans titre", "2024 – 2025"), job("Analyste", "Alpha", "2010 – 2014"), job("Directrice", "Beta", "2019 – présent"), job("Contrôleuse", "Gamma", "2014 – 2019")],
      skills: [],
    };
    expect(strong(fr(criteria({}, cv))).slice(1)).toEqual(["Directrice", "Contrôleuse"]);
  });
});
