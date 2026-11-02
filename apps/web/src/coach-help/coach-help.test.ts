import { describe, expect, it } from "vitest";
import { backOfficeHelpAddress, backOfficeHelpFor, helpArticle, helpCentreAddress, helpForUnanswered, helpLocale, helpSuggestions, oftenAsked, onThisPage } from "./index";

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

describe("the Coach Panel and the Help Centre (#549, ADR-0065)", () => {
  it("finds the « extension » topic's articles, and never a Visitor's", () => {
    expect(ids(helpSuggestions("enregistrer une offre avec l'extension", "fr"))).toContain("tutorial-extension-save-job-offer");
    expect(ids(helpSuggestions("save a job offer with the extension", "en"))).toContain("tutorial-extension-save-job-offer");
    expect(ids(helpSuggestions("où trouver l'aide de Jobbbox", "fr"))).not.toContain("faq-where-to-find-help");
  });

  it("leads a card to its article in the Help Centre, the English one under /en", () => {
    expect(helpCentreAddress(helpArticle("tutorial-extension-save-job-offer", "fr")!)).toBe("/aide/extension/tutorial-extension-save-job-offer");
    expect(helpCentreAddress(helpArticle("faq-text-size", "en")!)).toBe("/en/aide/utiliser/faq-text-size");
    expect(helpCentreAddress({ ...helpArticle("faq-text-size", "fr")!, audience: "administrator", topic: "parametres" })).toBeNull();
  });
});

describe("the Back Office's help (#551, ADR-0065)", () => {
  it("suggests and gives the Back Office Assistant the Administrators' articles only", () => {
    expect(backOfficeHelpFor("filtrer les questions sans réponse par public", "fr").map((found) => found.id)).toEqual(["page-admin-unanswered-questions"]);
    expect(helpSuggestions("questions sans réponse", "fr", "administrator").map((found) => found.audience)).toEqual(["administrator"]);
    // A Candidate's question finds nothing there, and the Candidate's box never finds an Administrator's article.
    expect(backOfficeHelpFor("Comment relancer un recruteur ?", "fr")).toEqual([]);
    expect(helpSuggestions("questions sans réponse tutoriel demandé", "fr").map((found) => found.audience)).not.toContain("administrator");
    expect(helpForUnanswered("filtrer les questions sans réponse par public", "fr", "administrator").map((found) => found.id)).toEqual(["page-admin-unanswered-questions"]);
  });

  it("shows a Back Office section's Administrator article « Sur cette page », and only there", () => {
    expect(onThisPage("/admin/questions-sans-reponse?public=administrator", "fr", "administrator")?.article.id).toBe("page-admin-unanswered-questions");
    expect(onThisPage("/admin/questions-sans-reponse", "fr")).toBeNull();
    expect(onThisPage("/candidatures", "fr", "administrator")).toBeNull();
    expect(oftenAsked("fr", "administrator")).toEqual([]);
  });

  it("links an Administrator's article to /admin/aide, never to the public Help Centre", () => {
    const admin = helpArticle("page-admin-unanswered-questions", "fr")!;
    expect(backOfficeHelpAddress(admin)).toBe("/admin/aide/contenu/page-admin-unanswered-questions");
    expect(helpCentreAddress(admin)).toBeNull();
    expect(backOfficeHelpAddress(helpArticle("faq-text-size", "fr")!)).toBeNull();
  });
});
