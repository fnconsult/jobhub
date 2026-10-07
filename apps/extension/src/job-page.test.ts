import { describe, expect, it } from "vitest";
import { MatchPattern } from "wxt/utils/match-patterns";
import { JOB_SITES, readJobPage, type PageSnapshot } from "./job-page";

/** A page as the content script sees it. */
function page(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://careers.example-industrie.fr/postes/daf",
    title: "Nos offres – Example Industrie",
    heading: "Directeur administratif et financier H/F",
    structuredData: [],
    text: "Directeur administratif et financier H/F\nRattaché au DG, vous pilotez la finance.",
    ...overrides,
  };
}

const jobPosting = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Directeur administratif et financier H/F",
  description: "<p>Rattaché au <b>Directeur général</b>, vous pilotez la finance du groupe.</p><ul><li>IFRS</li><li>Consolidation</li></ul><p>15 ans d&#39;expérience &amp; plus.</p>",
  datePosted: "2026-09-30",
  hiringOrganization: { "@type": "Organization", name: "Groupe Seb" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Écully", postalCode: "69130", addressCountry: "FR" } },
  employmentType: "FULL_TIME",
  baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 110000, maxValue: "130000", unitText: "YEAR" } },
  skills: "IFRS, Consolidation",
  experienceRequirements: { "@type": "OccupationalExperienceRequirements", monthsOfExperience: 180 },
};

describe("reading a job page", () => {
  it("detects a page that publishes a schema.org JobPosting and captures the posting it describes", () => {
    const read = readJobPage(page({ structuredData: [JSON.stringify(jobPosting)], siteName: "Example Industrie" }));

    expect(read.detected).toBe(true);
    expect(read.jobOffer).toEqual({
      source: { url: "https://careers.example-industrie.fr/postes/daf", name: "Example Industrie" },
      title: "Directeur administratif et financier H/F",
      content: "Rattaché au Directeur général, vous pilotez la finance du groupe.\n- IFRS\n- Consolidation\n15 ans d'expérience & plus.",
      employer: "Groupe Seb",
      location: "Écully",
      salary: { min: 110000, max: 130000 },
      skills: ["IFRS", "Consolidation"],
      requiredExperienceYears: 15,
    });
  });

  it("finds the JobPosting inside a list or an @graph, and reads remote work, a monthly salary and the contract type", () => {
    const posting = {
      ...jobPosting,
      "@type": ["JobPosting"],
      jobLocation: undefined,
      jobLocationType: "TELECOMMUTE",
      employmentType: ["CONTRACTOR"],
      hiringOrganization: "Groupe Seb",
      baseSalary: { currency: "EUR", value: { value: 5000, unitText: "MONTH" } },
      skills: [{ "@type": "DefinedTerm", name: "SAP" }, "IFRS"],
    };
    const read = readJobPage(page({ structuredData: [JSON.stringify([{ "@type": "Organization", name: "Seb" }, { "@graph": [posting] }])] }));

    expect(read.detected).toBe(true);
    expect(read.jobOffer).toMatchObject({
      employer: "Groupe Seb",
      remoteWork: "full_remote",
      contractType: "freelance",
      salary: { min: 60000, max: 60000 },
      skills: ["SAP", "IFRS"],
    });
    expect(read.jobOffer).not.toHaveProperty("location");
  });

  it("does not take a list of postings for one Job Offer, nor trip over broken structured data", () => {
    const read = readJobPage(
      page({
        structuredData: ["{ not json", JSON.stringify([jobPosting, { ...jobPosting, title: "Contrôleur de gestion" }])],
      }),
    );

    expect(read.detected).toBe(false);
    // Captured by hand, the page is taken as it reads.
    expect(read.jobOffer).toEqual({
      source: { url: "https://careers.example-industrie.fr/postes/daf" },
      title: "Directeur administratif et financier H/F",
      content: "Directeur administratif et financier H/F\nRattaché au DG, vous pilotez la finance.",
    });
  });

  it.each([
    "https://www.linkedin.com/jobs/view/4012345678/",
    "https://fr.indeed.com/viewjob?jk=0123abcd",
    "https://uk.indeed.com/viewjob?jk=0123abcd",
    "https://www.indeed.co.uk/viewjob?jk=0123abcd",
    "https://de.indeed.com/viewjob?jk=0123abcd",
    "https://www.glassdoor.fr/job-listing/daf-groupe-seb-JV_IC2908_KO0,3_KE4,14.htm?jl=1009876543",
    "https://www.glassdoor.co.uk/job-listing/finance-director-acme-JV_IC2671300_KO0,16_KE17,21.htm?jl=1009876543",
    "https://www.glassdoor.de/job-listing/cfo-acme-JV_IC4990924_KO0,3_KE4,8.htm?jl=1009876543",
    "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-h-f_ecully",
    "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543210W",
    "https://candidat.francetravail.fr/offres/recherche/detail/123ABCD",
    "https://www.hellowork.com/fr-fr/emplois/45678901.html",
    "https://www.cadremploi.fr/emploi/detail_offre?offreId=123456",
    "https://jobs.lever.co/example/0f4e5c9a-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
    "https://job-boards.greenhouse.io/example/jobs/4567890",
    "https://example.teamtailor.com/jobs/1234567-directeur-financier",
    "https://jobs.smartrecruiters.com/Example/743999912345678-daf",
    "https://example.wd3.myworkdayjobs.com/fr-FR/careers/job/Lyon/DAF_R-01234",
    "https://apply.workable.com/example/j/1A2B3C4D5E/",
  ])("detects a job posting on a major job board or career site without structured data: %s", (url) => {
    expect(readJobPage(page({ url })).detected).toBe(true);
    // ...where the extension watches for postings, to show the badge.
    expect(JOB_SITES.some((pattern) => new MatchPattern(pattern).includes(url))).toBe(true);
  });

  it("recognises a posting by its address only where the extension watches for postings", () => {
    // Indeed's and Glassdoor's address patterns, on a domain outside JOB_SITES: the badge could never show there.
    for (const url of ["https://www.indeed.example/viewjob?jk=0123abcd", "https://www.glassdoor.example/job-listing/daf-JV_KO0,3.htm"]) {
      expect(JOB_SITES.some((pattern) => new MatchPattern(pattern).includes(url))).toBe(false);
      expect(readJobPage(page({ url })).detected, url).toBe(false);
    }
  });

  it.each(["https://www.linkedin.com/feed/", "https://fr.indeed.com/jobs?q=daf&l=Lyon", "https://www.lemonde.fr/economie/"])(
    "does not detect a job posting on a page that is not one: %s",
    (url) => {
      expect(readJobPage(page({ url })).detected).toBe(false);
    },
  );

  it("captures a page by hand from its title when it has no heading, and keeps within what a Job Offer can hold", () => {
    const read = readJobPage(page({ heading: "", title: "  DAF – Lyon  ", text: "x".repeat(150_000) }));

    expect(read.jobOffer?.title).toBe("DAF – Lyon");
    expect(read.jobOffer?.content).toHaveLength(100_000);
  });

  it("has nothing to capture on an empty page", () => {
    expect(readJobPage(page({ heading: "", title: "", text: "  " })).jobOffer).toBeNull();
  });
});
