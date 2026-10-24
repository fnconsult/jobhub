import { describe, expect, it } from "vitest";
import { helpForUnanswered, helpLocale, helpSuggestions, oftenAsked, onThisPage } from "./index";

const ids = (articles: { id: string }[]) => articles.map((article) => article.id);

describe("the Coach Panel's single box: Help Articles first, without AI (#342)", () => {
  it("suggests the matching Help Articles while the Candidate types, from 3 characters on", () => {
    expect(helpSuggestions("qu", "fr")).toEqual([]);
    expect(helpSuggestions("  q ", "fr")).toEqual([]);
    expect(ids(helpSuggestions("quota", "fr"))).toContain("faq-quota-renewal");
  });

  it("suggests 4 articles at most, in the Interface Language", () => {
    const found = helpSuggestions("score candidature offre profil CV", "en");

    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(4);
    expect(found.every((article) => article.locale === "en")).toBe(true);
  });

  it("suggests nothing for a question the help does not answer", () => {
    expect(helpSuggestions("négocier mon salaire", "fr")).toEqual([]);
  });

  it("offers the 3 nearest articles for a question the AI Coach could not answer", () => {
    const found = helpForUnanswered("comment relancer le recruteur", "fr");

    expect(found[0]?.id).toBe("faq-follow-up-recruiter");
    expect(found.length).toBeLessThanOrEqual(3);
    expect(helpForUnanswered("négocier mon salaire", "fr")).toEqual([]);
  });

  it("asks three frequent questions in an empty conversation: the quota, relaunching a recruiter, the text size", () => {
    expect(ids(oftenAsked("fr"))).toEqual(["faq-quota-renewal", "faq-follow-up-recruiter", "faq-text-size"]);
    expect(oftenAsked("en").map((article) => article.title)).toEqual(["When does my quota renew?", expect.any(String), expect.any(String)]);
  });

  it("gives the page in view's article with its first paragraph, or nothing for a page without one", () => {
    const here = onThisPage("/candidatures/0b6c5a4e-1d2f-4c3b-9a8e-7f6d5c4b3a21?vue=liste", "fr");

    expect(here?.article.id).toBe("page-application");
    expect(here?.excerpt).toBe(here?.article.body.split(/\n\s*\n/)[0]);
    expect(onThisPage("/nulle-part/ici", "fr")).toBeNull();
  });

  it("reads the help in English for an English interface, and in French otherwise", () => {
    expect(helpLocale("en")).toBe("en");
    expect(helpLocale("en-GB")).toBe("en");
    expect(helpLocale("fr")).toBe("fr");
    expect(helpLocale(undefined)).toBe("fr");
  });
});
