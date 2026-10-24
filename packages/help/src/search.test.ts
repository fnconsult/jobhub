import { describe, expect, it } from "vitest";
import { articles, search } from "./index";

const ids = (query: string, locale: "fr" | "en" = "fr", options?: { limit?: number }) => search(query, locale, options).map((entry) => entry.id);

describe("search — Help Articles matching a Candidate's words, without AI", () => {
  it("finds « comment relancer le recruteur » → the question on following up with a recruiter, first", () => {
    expect(ids("comment relancer le recruteur")[0]).toBe("faq-follow-up-recruiter");
  });

  it("finds nothing for « négocier mon salaire », which no article answers", () => {
    expect(ids("négocier mon salaire")).toEqual([]);
  });

  it("is the same whatever the accents or the case", () => {
    const expected = ids("comment relancer le recruteur");
    expect(ids("COMMENT RELANCER LE RECRUTEUR")).toEqual(expected);
    expect(ids("Comment rélancer le récruteur")).toEqual(expected);
    expect(ids("supprimer mes données")).toEqual(ids("SUPPRIMER MES DONNEES"));
    expect(ids("supprimer mes données")[0]).toBe("faq-data-export-deletion");
  });

  it("searches the articles of the language asked for", () => {
    expect(ids("how do I follow up with the recruiter", "en")[0]).toBe("faq-follow-up-recruiter");
    expect(search("make the text bigger", "en")[0]).toMatchObject({ id: "faq-text-size", locale: "en" });
  });

  it("finds an article by one of its synonyms", () => {
    expect(ids("gros caractères")[0]).toBe("faq-text-size");
    expect(ids("rgpd")).toContain("faq-data-export-deletion");
  });

  it("matches a word's stem: other forms of it find the same article", () => {
    expect(ids("quand se renouvelle mon quota")[0]).toBe("faq-quota-renewal");
    expect(ids("renouvellement du quota")[0]).toBe("faq-quota-renewal");
  });

  it("ranks a word in the title or synonyms above the same word in the body", () => {
    // « ATS » is the ATS Score's title; the Profile page only mentions it in its body.
    const found = ids("score ats");
    expect(found[0]).toBe("glossary-ats-score");
  });

  it("drops stop-words and words of two letters or fewer, so they find nothing on their own", () => {
    expect(ids("comment le la de un je")).toEqual([]);
    expect(ids("how do I the")).toEqual([]);
    expect(ids("cv")).toEqual([]);
  });

  it("only returns articles scoring 2 or more: a single word found in a body is not enough", () => {
    // « télétravail » appears only in the body of the job offer's page article.
    expect(ids("télétravail")).toEqual([]);
  });

  it("returns 4 articles at most, or the limit asked for", () => {
    expect(ids("candidature profil offre recherche coach").length).toBe(4);
    expect(ids("candidature profil offre recherche coach", "fr", { limit: 2 }).length).toBe(2);
  });

  it("finds nothing for an empty query", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ?! ")).toEqual([]);
  });

  it("searches all the articles in under 5 ms", () => {
    const queries = ["comment relancer le recruteur", "négocier mon salaire", "quand se renouvelle mon quota", "score de correspondance", "supprimer mon compte"];
    search("warm up", "fr");
    const runs = 200;
    const start = performance.now();
    for (let run = 0; run < runs; run++) search(queries[run % queries.length]!, "fr");
    const perSearch = (performance.now() - start) / runs;

    expect(articles("fr").length).toBeGreaterThanOrEqual(25);
    expect(perSearch).toBeLessThan(5);
  });
});
