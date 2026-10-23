import { describe, expect, it } from "vitest";
import { isPersonPage, provenanceLink } from "./provenance-link";

describe("the link filter for Provenance sites", () => {
  describe("allows", () => {
    it.each([
      ["an offer page", "https://www.apec.fr/candidat/offre/178456W", "https://www.apec.fr/candidat/offre/178456W"],
      ["an http page", "http://careers.example.com/jobs/dev", "http://careers.example.com/jobs/dev"],
      ["a page, its query string dropped", "https://www.apec.fr/offre/178456W?xtor=AL-123&utm_source=x", "https://www.apec.fr/offre/178456W"],
      ["a page, its fragment dropped", "https://careers.example.com/jobs/dev#apply", "https://careers.example.com/jobs/dev"],
      ["a France Travail offer", "https://candidat.francetravail.fr/offres/recherche/detail/123ABCD", "https://candidat.francetravail.fr/offres/recherche/detail/123ABCD"],
      ["a Greenhouse posting", "https://boards.greenhouse.io/acme/jobs/4567890", "https://boards.greenhouse.io/acme/jobs/4567890"],
      ["a Lever posting, whose id is a public uuid", "https://jobs.lever.co/acme/8f3a1c2e-1d2b-4c3d-9e8f-0a1b2c3d4e5f", "https://jobs.lever.co/acme/8f3a1c2e-1d2b-4c3d-9e8f-0a1b2c3d4e5f"],
      ["a long slug", "https://www.welcometothejungle.com/fr/companies/acme/jobs/developpeur-fullstack-javascript-react-node-h-f_paris", "https://www.welcometothejungle.com/fr/companies/acme/jobs/developpeur-fullstack-javascript-react-node-h-f_paris"],
      ["the company register's page", "https://annuaire-entreprises.data.gouv.fr/entreprise/552100554", "https://annuaire-entreprises.data.gouv.fr/entreprise/552100554"],
      ["a LinkedIn company page", "https://www.linkedin.com/company/acme/", "https://www.linkedin.com/company/acme/"],
      ["a LinkedIn offer the Candidate captured", "https://www.linkedin.com/jobs/view/3912345678/", "https://www.linkedin.com/jobs/view/3912345678/"],
      ["the Candidate's Application", "/candidatures/5d2a", "/candidatures/5d2a"],
      ["the Candidate's Profile", "/profils/4b1c", "/profils/4b1c"],
      ["the Candidate's Job Search", "/recherches/77", "/recherches/77"],
      ["the Candidate's Job Offer", "/offres/12", "/offres/12"],
      ["the Candidate's Job Digest", "/job-digests/9", "/job-digests/9"],
      ["the Candidate's page at Jobbbox's address, made relative", "https://app.jobbbox.fr/profils/4b1c?onglet=cv", "/profils/4b1c"],
    ])("%s", (_, link, kept) => {
      expect(provenanceLink(link)).toBe(kept);
    });
  });

  describe("refuses", () => {
    it.each([
      ["another scheme", "ftp://example.com/offre"],
      ["a script", "javascript:alert(1)"],
      ["an email address", "mailto:jean.dupont@example.com"],
      ["a phone number", "tel:+33612345678"],
      ["a data address", "data:text/html,<p>hi</p>"],
      ["a local file", "file:///Users/jean/cv.pdf"],
      ["a browser blob", "blob:https://app.jobbbox.fr/0f8fad5b"],
      ["no address", "offre 178456"],
      ["an address relative to the page", "candidatures/5d2a"],
      ["an address with no scheme", "//evil.example/profils/1"],
      ["a LinkedIn profile", "https://www.linkedin.com/in/jean-dupont"],
      ["a LinkedIn profile on a country host", "https://fr.linkedin.com/in/jean-dupont"],
      ["an old LinkedIn profile", "https://fr.linkedin.com/pub/jane-doe/1/2/3"],
      ["any other LinkedIn page", "https://www.linkedin.com/feed/"],
      ["a Facebook page", "https://www.facebook.com/jean.dupont"],
      ["an X profile", "https://x.com/jdupont"],
      ["an Instagram profile", "https://www.instagram.com/jdupont/"],
      ["a Viadeo profile", "https://www.viadeo.com/p/jean-dupont"],
      ["an Enriched Contact at Lusha", "https://dashboard.lusha.com/contacts/12345"],
      ["an Enriched Contact at Kaspr", "https://app.kaspr.io/lead/abc"],
      ["an Enriched Contact at Apollo", "https://app.apollo.io/people/abc"],
      ["the Back Office", "/admin/outils"],
      ["the Back Office at Jobbbox's address", "https://jobbbox.ai/admin/journaux-ia"],
      ["a Human Coach's pages", "https://app.jobbbox.fr/espace-coach/candidats/1"],
      ["the Candidate's account", "/compte"],
      ["the sign-in page", "/connexion"],
      ["an unsubscribe link", "/desabonnement/abc"],
      ["Jobbbox's home", "/"],
      ["the Candidate's files", "/api/cv/4b1c/file"],
      ["the Candidate's files at Jobbbox's address", "https://app.jobbbox.fr/api/profiles/4b1c/master-cv/download"],
      ["a signed address", "https://bucket.s3.eu-west-3.amazonaws.com/cv.pdf?X-Amz-Signature=abc&X-Amz-Expires=300"],
      ["a Google-signed address", "https://storage.googleapis.com/b/cv.pdf?X-Goog-Signature=abc"],
      ["an address with a token", "https://careers.example.com/apply?token=abc"],
      ["an address with an access key", "https://careers.example.com/offer/1?access_key=abc"],
      ["a token in the path", "https://careers.example.com/share/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"],
      ["a signed JSON Web Token in the path", "https://careers.example.com/magic/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
      ["an address with a user and password", "https://jean:secret@careers.example.com/offer/1"],
      ["an address too long", `https://careers.example.com/${"a/".repeat(1100)}`],
    ])("%s", (_, link) => {
      expect(provenanceLink(link)).toBeNull();
    });
  });
});

describe("a person page", () => {
  it.each([
    ["https://www.linkedin.com/in/jean-dupont", true],
    ["https://twitter.com/jdupont", true],
    ["https://www.tiktok.com/@jdupont", true],
    ["https://www.threads.net/@jdupont", true],
    ["https://www.linkedin.com/company/acme", false],
    ["https://www.apec.fr/offre/1", false],
  ])("%s: %s", (link, person) => {
    expect(isPersonPage(new URL(link))).toBe(person);
  });
});
