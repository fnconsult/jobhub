import { describe, expect, it } from "vitest";
import { LINKEDIN_READING_LIMITS, linkedInPageOf, linkedInReadingOf } from "./linkedin-reading";

describe("the LinkedIn page a Reading may be of (ADR-0119, #1164)", () => {
  it("is a Job Offer by its own address or the search view's posting, kept as the posting's address", () => {
    expect(linkedInPageOf("https://www.linkedin.com/jobs/view/4012345678/?trk=abc")).toEqual({ kind: "job_offer", url: "https://www.linkedin.com/jobs/view/4012345678/" });
    expect(linkedInPageOf("https://fr.linkedin.com/jobs/search/?keywords=achats&currentJobId=4012345678")).toEqual({
      kind: "job_offer",
      url: "https://www.linkedin.com/jobs/view/4012345678/",
    });
  });

  it("is a company page, or its people, without the query that filters them", () => {
    expect(linkedInPageOf("https://www.linkedin.com/company/exemple-industrie/")).toEqual({ kind: "company", url: "https://www.linkedin.com/company/exemple-industrie/" });
    expect(linkedInPageOf("https://www.linkedin.com/company/exemple-industrie/about/")).toEqual({ kind: "company", url: "https://www.linkedin.com/company/exemple-industrie/" });
    expect(linkedInPageOf("https://www.linkedin.com/company/exemple-industrie/people/?facetCurrentFunction=8")).toEqual({
      kind: "people",
      url: "https://www.linkedin.com/company/exemple-industrie/people/",
    });
  });

  it("is never a person's profile, a feed, a search for people or another site", () => {
    for (const url of [
      "https://www.linkedin.com/in/camille-exemple/",
      "https://www.linkedin.com/feed/",
      "https://www.linkedin.com/search/results/people/?keywords=achats",
      "https://www.linkedin.com.example.org/company/exemple-industrie/",
      "http://www.linkedin.com/company/exemple-industrie/",
      "https://www.indeed.fr/viewjob?jk=1",
      "not a url",
    ]) {
      expect(linkedInPageOf(url), url).toBeNull();
    }
  });
});

describe("a LinkedIn Reading, as the extension sends it and Jobbbox keeps it (ADR-0119, #1164)", () => {
  const page = { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie/people/?facetCurrentFunction=8" };

  it("keeps of each person their name, role and company only, whatever else is sent", () => {
    const reading = linkedInReadingOf({
      page,
      company: "Exemple Industrie",
      department: "Achats",
      people: [
        { name: "Camille Exemple", role: "Responsable achats", company: "Exemple Industrie", profileUrl: "https://www.linkedin.com/in/camille-exemple/", photo: "x.jpg", location: "Lyon" },
      ],
      cookies: "li_at=secret",
    });
    expect(reading).toEqual({
      page: { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie/people/" },
      company: "Exemple Industrie",
      department: "Achats",
      people: [{ name: "Camille Exemple", role: "Responsable achats", company: "Exemple Industrie" }],
    });
  });

  it("gives a person with no company the page's, trims and caps each field, and leaves out a role it does not know", () => {
    const reading = linkedInReadingOf({
      page,
      company: "  Exemple   Industrie ",
      people: [
        { name: "  Lou   Fictif ", role: `${"r".repeat(LINKEDIN_READING_LIMITS.role + 50)}` },
        { name: "Sacha Inventé" },
      ],
    });
    expect(reading?.company).toBe("Exemple Industrie");
    expect(reading?.people[0]).toEqual({ name: "Lou Fictif", role: "r".repeat(LINKEDIN_READING_LIMITS.role), company: "Exemple Industrie" });
    expect(reading?.people[1]).toEqual({ name: "Sacha Inventé", role: "", company: "Exemple Industrie" });
    expect(reading).not.toHaveProperty("department");
  });

  it("drops LinkedIn's anonymous members, nameless entries and repeats, and keeps at most the limit of people", () => {
    const many = Array.from({ length: LINKEDIN_READING_LIMITS.people + 10 }, (_, index) => ({ name: `Personne ${index}`, role: "Acheteur" }));
    const reading = linkedInReadingOf({
      page,
      company: "Exemple Industrie",
      people: [{ name: "Membre LinkedIn", role: "Acheteur" }, { name: "LinkedIn Member" }, { name: "" }, { name: "Personne 0", role: "Acheteur" }, ...many],
    });
    expect(reading?.people).toHaveLength(LINKEDIN_READING_LIMITS.people);
    expect(reading?.people.map((person) => person.name).slice(0, 2)).toEqual(["Personne 0", "Personne 1"]);
  });

  it("is refused for a profile's page, a page that is not LinkedIn's, no company, or what is not a Reading", () => {
    expect(linkedInReadingOf({ page: { kind: "people", url: "https://www.linkedin.com/in/camille-exemple/" }, company: "Exemple", people: [] })).toBeNull();
    expect(linkedInReadingOf({ page: { kind: "company", url: "https://example.org/company/x/" }, company: "Exemple", people: [] })).toBeNull();
    expect(linkedInReadingOf({ page, company: "  ", people: [] })).toBeNull();
    expect(linkedInReadingOf({ page, company: "Exemple", people: "Camille" })).toBeNull();
    expect(linkedInReadingOf(null)).toBeNull();
    expect(linkedInReadingOf("Camille Exemple")).toBeNull();
  });

  it("takes the page's kind from its address, not from what is sent", () => {
    const reading = linkedInReadingOf({ page: { kind: "people", url: "https://www.linkedin.com/jobs/view/4012345678/" }, company: "Exemple Industrie", people: [] });
    expect(reading?.page).toEqual({ kind: "job_offer", url: "https://www.linkedin.com/jobs/view/4012345678/" });
  });
});
