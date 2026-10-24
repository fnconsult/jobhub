import { describe, expect, it } from "vitest";
import { article, articleFor, articles } from "./index";

describe("articles — every Help Article in one language", () => {
  it("returns the page articles, then the glossary, then the frequent questions, all in that language", () => {
    const french = articles("fr");

    expect(french.length).toBeGreaterThanOrEqual(25);
    expect(french.every((entry) => entry.locale === "fr")).toBe(true);
    const kinds = french.map((entry) => entry.kind);
    expect(kinds.indexOf("glossary")).toBeGreaterThan(kinds.lastIndexOf("page"));
    expect(kinds.indexOf("faq")).toBeGreaterThan(kinds.lastIndexOf("glossary"));
    expect(articles("en").map((entry) => entry.id).sort()).toEqual(french.map((entry) => entry.id).sort());
  });

  it("has a glossary entry for each term the Candidate meets, and the frequent questions", () => {
    const ids = articles("fr").map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "glossary-match-score",
        "glossary-ats-score",
        "glossary-proposals",
        "glossary-master-cv",
        "glossary-tailored-cv",
        "glossary-follow-up",
        "glossary-job-search",
        "glossary-job-digest",
        "glossary-plan-quota",
        "faq-quota-renewal",
        "faq-follow-up-recruiter",
        "faq-text-size",
        "faq-help-and-ai",
        "faq-data-export-deletion",
        "faq-signalement",
      ]),
    );
  });
});

describe("article — one Help Article by id", () => {
  it("returns it in the language asked for", () => {
    expect(article("glossary-ats-score", "fr")).toMatchObject({ kind: "glossary", title: "ATS Score", locale: "fr" });
    expect(article("faq-text-size", "en")).toMatchObject({ kind: "faq", title: "How do I make the text larger?", locale: "en" });
  });

  it("returns null for an id no article has", () => {
    expect(article("faq-salary-negotiation", "fr")).toBeNull();
  });
});

describe("articleFor — the Help Article of the page in view", () => {
  it("returns the page article of a route pattern, in the language asked for", () => {
    expect(articleFor("/candidatures/[id]", "fr")).toMatchObject({ id: "page-application", kind: "page", locale: "fr" });
    expect(articleFor("/agenda", "en")).toMatchObject({ id: "page-agenda", title: "Interviews and appointments" });
  });

  it("finds it from the page's address, its query and a trailing slash aside", () => {
    expect(articleFor("/candidatures/0b6c1f2e", "fr")?.id).toBe("page-application");
    expect(articleFor("/agenda?vue=semaine&date=2026-10-20", "fr")?.id).toBe("page-agenda");
    expect(articleFor("/candidatures/", "fr")?.id).toBe("page-applications");
  });

  it("gives a page's Sections the article of their page", () => {
    expect(articleFor("/candidatures/0b6c1f2e/documents", "fr")?.id).toBe("page-application");
    expect(articleFor("/profils/42/ats-score", "fr")?.id).toBe("page-profile");
    expect(articleFor("/compte/preferences", "fr")?.id).toBe("page-account");
  });

  it("prefers a page of its own over a pattern that would also match", () => {
    expect(articleFor("/profils/nouveau", "fr")?.id).toBe("page-new-profile");
    expect(articleFor("/profils/42", "fr")?.id).toBe("page-profile");
  });

  it("returns null for a page without an article", () => {
    expect(articleFor("/admin/quotas", "fr")).toBeNull();
    expect(articleFor("/connexion", "fr")).toBeNull();
  });
});
