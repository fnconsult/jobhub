import type { JobOffer, MatchScore } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { jobDigestFicheLinks, jobSearchFicheLinks, profileFicheLinks } from "./index";

const fr = createI18n("fr").t;
const en = createI18n("en").t;

function score(value: number, known = true): MatchScore {
  const unknown = { status: "unknown" } as const;
  return {
    score: value,
    breakdown: {
      skills: known ? { status: "match", covered: ["WMS"], missing: [] } : unknown,
      seniority: known ? { status: "match", cvYears: 14, requiredYears: 5 } : unknown,
      location: known ? { status: "match", offer: "Lyon", wanted: ["Lyon"] } : unknown,
      salary: unknown,
      contractType: known ? { status: "match", offer: "cdi", wanted: ["cdi"] } : unknown,
    },
  } as MatchScore;
}

const offer = (id: string, title: string, employer?: string) => ({ id, title, ...(employer ? { employer } : {}) }) as JobOffer;
const RESULTS = [
  { jobOffer: offer("o1", "Responsable logistique", "Acme Industrie"), matchScore: score(86), applicationId: null },
  { jobOffer: offer("o2", "Chef d'entrepôt"), matchScore: score(40, false), applicationId: "a1" },
];

describe("a Profile's Fiche (#605)", () => {
  const versions = [
    { version: 3, savedAt: new Date("2026-10-30T09:00:00Z") },
    { version: 2, savedAt: new Date("2026-10-20T09:00:00Z") },
    { version: 1, savedAt: new Date("2026-10-01T09:00:00Z") },
  ];

  it("lists its Sections, each at its own address, in the order the Profile has them", () => {
    const { sections } = profileFicheLinks({ id: "p1", sections: ["cv-de-reference", "ats-score", "gerer"], currentVersion: 3, versions }, fr, "fr");
    expect(sections).toEqual([
      { href: "/profils/p1/cv-de-reference", label: "CV de référence" },
      { href: "/profils/p1/ats-score", label: "ATS Score" },
      { href: "/profils/p1/gerer", label: "Gérer" },
    ]);
  });

  it("lists as its Results the Master CV Versions, newest first, the current one said so, then the CV export", () => {
    const { results } = profileFicheLinks({ id: "p1", sections: ["cv-de-reference"], currentVersion: 2, versions }, fr, "fr");
    expect(results).toEqual([
      { href: "/profils/p1/versions/3", label: "Version 3", detail: "Enregistrée le 30 octobre 2026" },
      { href: "/profils/p1/versions/2", label: "Version 2", detail: "Version actuelle · Enregistrée le 20 octobre 2026" },
      { href: "/profils/p1/versions/1", label: "Version 1", detail: "Enregistrée le 1 octobre 2026" },
      { href: "/profils/p1/telecharger", label: "Télécharger mon CV de référence", detail: "PDF ou Word, version 2" },
    ]);
  });

  it("speaks the Candidate's language", () => {
    const { results } = profileFicheLinks({ id: "p1", sections: [], currentVersion: 1, versions: versions.slice(2) }, en, "en");
    expect(results[0]).toEqual({ href: "/profils/p1/versions/1", label: "Version 1", detail: "Current version · Saved on October 1, 2026" });
  });
});

describe("a Job Search's Fiche (#605)", () => {
  it("has the list of its Job Offers as its Section", () => {
    expect(jobSearchFicheLinks({ id: "s1", results: RESULTS }, fr).sections).toEqual([{ href: "/recherches/s1/offres", label: "Offres trouvées" }]);
  });

  it("lists each Job Offer found as a Result with its Match Score, best first as given, opened at its own address", () => {
    expect(jobSearchFicheLinks({ id: "s1", results: RESULTS }, fr).results).toEqual([
      { href: "/recherches/s1/offres/o1", label: "Responsable logistique", detail: "Acme Industrie · Match Score : 86 / 100" },
      { href: "/recherches/s1/offres/o2", label: "Chef d'entrepôt", detail: "Match Score : Non calculable" },
    ]);
  });

  it("has no Result before it finds a Job Offer", () => {
    expect(jobSearchFicheLinks({ id: "s1", results: [] }, fr).results).toEqual([]);
  });
});

describe("a Job Digest's Fiche (#605)", () => {
  it("has the list of its Job Offers and its settings as Sections", () => {
    expect(jobDigestFicheLinks({ id: "d1", results: RESULTS }, fr).sections).toEqual([
      { href: "/job-digests/d1/offres", label: "Offres trouvées" },
      { href: "/job-digests/d1/reglages", label: "Réglages" },
    ]);
  });

  it("lists each of its Job Offers as a Result with its Match Score", () => {
    expect(jobDigestFicheLinks({ id: "d1", results: RESULTS.slice(0, 1) }, en).results).toEqual([
      { href: "/job-digests/d1/offres/o1", label: "Responsable logistique", detail: "Acme Industrie · Match Score: 86 / 100" },
    ]);
  });
});
