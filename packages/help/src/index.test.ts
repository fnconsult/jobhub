import { describe, expect, it } from "vitest";
import { article, articles } from "./index";

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
