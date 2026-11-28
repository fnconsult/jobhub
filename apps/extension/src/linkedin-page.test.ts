import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readLinkedInPage } from "./linkedin-page";
import {
  COMPANY_PAGE_HTML,
  COMPANY_PAGE_URL,
  JOB_PAGE_HTML,
  JOB_PAGE_URL,
  PEOPLE_PAGE_HTML,
  PEOPLE_PAGE_URL,
  PROFILE_PAGE_HTML,
  PROFILE_PAGE_URL,
} from "./linkedin-page.fixtures";

/** A page as the browser would show it at `url`: jsdom's document, its address and markup set. */
function pageAt(url: string, html: string): Document {
  return new JSDOM(html, { url }).window.document;
}

describe("reading a LinkedIn page the Candidate opened, in their own browser (ADR-0119, #1164)", () => {
  it("keeps, of a company's people filtered by department, each person's name, role and company, and nothing else", () => {
    const reading = readLinkedInPage(pageAt(PEOPLE_PAGE_URL, PEOPLE_PAGE_HTML));
    expect(reading).toEqual({
      page: { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie-fictive/people/" },
      company: "Exemple Industrie Fictive",
      department: "Achats",
      people: [
        { name: "Camille Fictive", role: "Responsable achats chez Exemple Industrie Fictive", company: "Exemple Industrie Fictive" },
        { name: "Lou Inventé", role: "Acheteur projets | Métallurgie", company: "Exemple Industrie Fictive" },
        { name: "Sacha Exemple", role: "Directrice des achats", company: "Exemple Industrie Fictive" },
      ],
    });
    // No profile address, photo, place, degree of connection nor screen-reader text is kept.
    const kept = JSON.stringify(reading);
    for (const left of ["/in/", "licdn", "Lyon, Auvergne", "2e", "Voir le profil", "Membre LinkedIn", "Autre Fictive"]) expect(kept).not.toContain(left);
  });

  it("keeps, of a Job Offer, its employer and the recruiter its hiring team card names", () => {
    expect(readLinkedInPage(pageAt(JOB_PAGE_URL, JOB_PAGE_HTML))).toEqual({
      page: { kind: "job_offer", url: "https://www.linkedin.com/jobs/view/4100000099/" },
      company: "Exemple Industrie Fictive",
      people: [{ name: "Dominique Fictif", role: "Talent Acquisition chez Exemple Industrie Fictive", company: "Exemple Industrie Fictive" }],
    });
  });

  it("keeps, of a company page that names no one, the company alone", () => {
    expect(readLinkedInPage(pageAt(COMPANY_PAGE_URL, COMPANY_PAGE_HTML))).toEqual({
      page: { kind: "company", url: COMPANY_PAGE_URL },
      company: "Exemple Industrie Fictive",
      people: [],
    });
  });

  it("never reads a person's profile, nor a page that is not LinkedIn's", () => {
    expect(readLinkedInPage(pageAt(PROFILE_PAGE_URL, PROFILE_PAGE_HTML))).toBeNull();
    expect(readLinkedInPage(pageAt("https://www.example.org/company/exemple-industrie-fictive/people/", PEOPLE_PAGE_HTML))).toBeNull();
  });

  it("reads nothing of a page whose company cannot be told", () => {
    expect(readLinkedInPage(pageAt(PEOPLE_PAGE_URL, "<!doctype html><html><body><main><p>Chargement…</p></main></body></html>"))).toBeNull();
  });
});
