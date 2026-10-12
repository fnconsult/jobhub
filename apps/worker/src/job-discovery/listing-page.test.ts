import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listingPageLinks } from "./listing-page";

/** A page saved under ./fixtures, as the crawler would read it from `url`. */
const saved = (file: string, url: string) => ({ url, html: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8") });

describe("Listing pages", () => {
  it("follows the first 5 postings a job board's search results link to on its own site, once each", () => {
    const page = saved("job-board-search-results.html", "https://www.emplois-exemple.fr/offres-emploi?q=directeur+financier&l=Lyon");

    expect(listingPageLinks(page)).toEqual([
      "https://www.emplois-exemple.fr/offres-emploi/5481237-directeur-administratif-et-financier-h-f?from=search",
      "https://www.emplois-exemple.fr/offres-emploi/5479920-daf-groupe-pme-h-f",
      "https://www.emplois-exemple.fr/offres-emploi/5478001-directeur-financier-filiale-france",
      "https://www.emplois-exemple.fr/offres-emploi/5476544-cfo-start-up-saas",
      "https://www.emplois-exemple.fr/offres-emploi/5475002-directeur-financier-groupe",
    ]);
  });

  it("follows the postings a careers site lists in its ItemList structured data, on its own site only", () => {
    const page = saved("careers-site-openings.html", "https://carrieres.acme-industrie.example/fr/offres");

    expect(listingPageLinks(page)).toEqual([
      "https://carrieres.acme-industrie.example/o/controleur-de-gestion-industriel-h-f",
      "https://carrieres.acme-industrie.example/o/directeur-financier-adjoint",
      "https://carrieres.acme-industrie.example/o/responsable-tresorerie-groupe",
    ]);
  });

  it("follows the pages of the several JobPostings a page lists", () => {
    const page = saved("aggregator-several-jobpostings.html", "https://agregateur.example.org/recherche?q=directeur+financier&l=lyon");

    expect(listingPageLinks(page)).toEqual([
      "https://agregateur.example.org/fiche/a81f3c",
      "https://agregateur.example.org/fiche/b72e19",
      "https://agregateur.example.org/fiche/c55d02",
    ]);
  });

  it("follows nothing from a listing page whose robots meta tag says nofollow (ADR-0002)", () => {
    const page = saved("job-board-search-results.html", "https://www.emplois-exemple.fr/offres-emploi?q=directeur+financier&l=Lyon");
    const html = page.html.replace('content="index, follow"', 'content="index, nofollow"');

    expect(listingPageLinks({ ...page, html })).toEqual([]);
  });

  it("is not a posting page that links to similar offers", () => {
    const page = saved(
      "posting-with-similar-offers.html",
      "https://www.emplois-exemple.fr/offres-emploi/5481237-directeur-administratif-et-financier-h-f",
    );

    expect(listingPageLinks(page)).toEqual([]);
  });

  it("is not an article that mentions a couple of offers", () => {
    const page = saved("career-advice-article.html", "https://www.emplois-exemple.fr/conseils/devenir-daf-apres-50-ans");

    expect(listingPageLinks(page)).toEqual([]);
  });
});
