import { describe, expect, it } from "vitest";
import { careersSiteOf, isForTheJob } from "./careers-site";

describe("a Target Company's careers site, from a web search's result (#406)", () => {
  it("is its board on Greenhouse, Lever or Ashby when the board bears its name", () => {
    expect(careersSiteOf("https://job-boards.greenhouse.io/acmeindustrie/jobs/1001", "ACME INDUSTRIE")).toBe("https://job-boards.greenhouse.io/acmeindustrie");
    expect(careersSiteOf("https://jobs.lever.co/acme-fr/00000000-0000-4000-8000-000000000001", "Acme SAS")).toBe("https://jobs.lever.co/acme-fr");
    expect(careersSiteOf("https://jobs.ashbyhq.com/acme", "ACME")).toBe("https://jobs.ashbyhq.com/acme");
  });

  it("is not another company's board, found by the same search", () => {
    expect(careersSiteOf("https://job-boards.greenhouse.io/gitlab/jobs/1", "ACME INDUSTRIE")).toBeNull();
    // A common word of its name is not enough.
    expect(careersSiteOf("https://jobs.lever.co/industrie-services/x", "ACME INDUSTRIE")).toBeNull();
  });

  it("is its Welcome to the Jungle page, or the careers section of its own site", () => {
    expect(careersSiteOf("https://www.welcometothejungle.com/fr/companies/acme/jobs/daf_lyon", "ACME")).toBe("https://www.welcometothejungle.com/fr/companies/acme/jobs");
    expect(careersSiteOf("https://www.acme-industrie.fr/carrieres/daf-lyon", "ACME INDUSTRIE")).toBe("https://www.acme-industrie.fr/carrieres");
    expect(careersSiteOf("https://acme.com/en/careers", "Acme")).toBe("https://acme.com/en/careers");
  });

  it("is none for a job board's posting or another site's page", () => {
    expect(careersSiteOf("https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/1", "ACME")).toBeNull();
    expect(careersSiteOf("https://www.acme.fr/actualites/2026", "ACME")).toBeNull();
    expect(careersSiteOf("https://www.cadremploi.fr/emploi/acme", "ACME")).toBeNull();
    expect(careersSiteOf("not a url", "ACME")).toBeNull();
  });
});

describe("a posting for the Profile's job (#406)", () => {
  it("is one of the same ROME job, whatever its wording or gender", () => {
    expect(isForTheJob("Directrice administrative et financière (H/F)", ["Directeur financier"])).toBe(true);
    expect(isForTheJob("CFO Europe", ["Directeur financier"])).toBe(true);
  });

  it("is one naming every word of a title searched", () => {
    expect(isForTheJob("Head of Treasury Operations", ["Head of Treasury"])).toBe(true);
    expect(isForTheJob("Commercial terrain", ["Directeur financier", "Head of Treasury"])).toBe(false);
  });
});
