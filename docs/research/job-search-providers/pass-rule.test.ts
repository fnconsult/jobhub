// Run: npx tsx --test docs/research/job-search-providers/pass-rule.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSinglePosting } from "./pass-rule";

describe("isSinglePosting", () => {
  // Real URLs from the Perplexity baseline (#97) and the boards French managers use.
  const singles = [
    "https://www.hellowork.com/fr-fr/emplois/83488983.html",
    "https://candidat.francetravail.fr/offres/recherche/detail/6321650",
    "https://www.meteojob.com/jobs/57045761",
    "https://www.cadremploi.fr/emploi/detail_offre?offreId=156545452231953613",
    "https://emploi.lefigaro.fr/offres-emploi/156547516944938682",
    "https://fr.trabajo.org/offre-3999-b9b524fd30f0b19738125f634a0cfeeb",
    "https://www.roberthalf.com/fr/fr/offres-emploi/courbevoie-ile-de-france/chef-de-projet-transformation-finance-fh",
    "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543210W",
    "https://www.welcometothejungle.com/fr/companies/acme/jobs/directeur-financier_paris",
    "https://www.michaelpage.fr/job-detail/directeur-administratif-et-financier-hf/ref/jn-102026-6812345",
    "https://fr.indeed.com/viewjob?jk=0123456789abcdef",
    "https://www.linkedin.com/jobs/view/4012345678",
    "https://jobs.lever.co/acme/0b1c2d3e-4f50-6789-abcd-ef0123456789",
    "https://boards.greenhouse.io/acme/jobs/7012345",
    "https://acme.wd3.myworkdayjobs.com/fr-FR/careers/job/Paris/Directeur-Financier_R12345",
    "https://careers.acme.com/job/paris/directeur-financier/12345/67890",
  ];
  const listings = [
    "https://www.hellowork.com/fr-fr/emploi/metier_directeur-administratif-et-financier-ville_paris-75000.html",
    "https://emploi.lefigaro.fr/offres-emploi/v/paris-75001/m/directeur-administratif-et-financier",
    "https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles=Directeur%20marketing",
    "https://www.meteojob.com/Lyon-(69)-Emploi-Directeur-Commercial",
    "https://www.michaelpage.fr/jobs/directeur-commercial/rh%C3%B4ne-alpes",
    "https://www.cadremploi.fr/emploi/liste_offres?fct=10600&ville=bordeaux-33",
    "https://www.jobijoba.com/fr/emploi/Directeur+usine/Rouen",
    "https://fr.indeed.com/q-dsi-l-nantes-(44)-emplois.html",
    "https://www.welcometothejungle.com/fr/pages/emploi-finance",
    "https://candidat.francetravail.fr/offres/emploi/directeur-marketing/s32m4",
    "https://www.roberthalf.com/fr/fr/offres-emploi/paris/directeur-administratif-et-financier",
    "https://www.hellowork.com/fr-fr/metiers/directeur-supply-chain.html",
    "https://fr.jooble.org/emploi-dsi/Nantes",
  ];

  for (const url of singles) it(`one posting: ${url}`, () => assert.equal(isSinglePosting(url), true));
  for (const url of listings) it(`listing or search page: ${url}`, () => assert.equal(isSinglePosting(url), false));
});
