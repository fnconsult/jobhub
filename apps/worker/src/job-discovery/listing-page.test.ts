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
