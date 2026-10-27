import type { TaskPlaybookSeed } from "./types";

/**
 * A Company Dossier's web facts, in two steps (#405): the web-search query (web_search, `## requête`),
 * where {{entreprise}} is the employer's name, cleaned; then its Playbook Agent (offer_analysis, a small
 * model by default) reads the pages the Search provider returned and writes the facts (`## lecture`).
 * The JSON keys asked for, "name no person" and the pages framed as data stay in code. Its searches go
 * to the web-search provider its version names, else the configured one.
 *
 * Version 1 was the query alone, asking the search itself for the facts JSON, with no Playbook Agent:
 * what production runs until a person validates the version this text is imported as (ADR-0026).
 */
export const companyFactsSearch = {
  id: "company-facts-search",
  title: "Rechercher les faits d'une entreprise (Company Dossier)",
  aiTask: "offer_analysis",
  agent: true,
  search: true,
  validatedAtImport: true,
  sections: [
    { key: "requête", label: "requête envoyée au moteur de recherche", slots: ["entreprise"] },
    { key: "lecture", label: "consigne du Playbook Agent qui lit les pages trouvées", agent: true },
  ],
  maxLength: 4000,
  firstVersion: {
    instructions: `Fiche d'entreprise de {{entreprise}} : pays, adresse du siège, secteur d'activité, effectif, chiffre d'affaires, site web, numéro SIREN si elle est française.`,
    agent: false,
  },
  instructions: `## requête

{{entreprise}} entreprise : siège, secteur d'activité, effectif, chiffre d'affaires, site officiel, SIREN

## lecture

Tu lis les pages qu'une recherche web a trouvées sur une entreprise, et tu en tires sa fiche :
- le pays de son siège, en français (ex. « Allemagne ») ;
- la ville de son siège, sans rue ni numéro ;
- son secteur d'activité en quelques mots, en français ;
- son effectif, tel que les pages le donnent (ex. « 1 200 salariés ») ;
- son chiffre d'affaires, avec sa devise et son année quand les pages la donnent (ex. « 300 M€ (2024) ») ;
- l'adresse de son site officiel ;
- son numéro SIREN, si elle est française et que les pages le donnent.
Ne retiens que ce que les pages disent de cette entreprise-là, pas d'un homonyme ni d'une filiale. N'invente rien : laisse vide ce que les pages ne disent pas.`,
} as const satisfies TaskPlaybookSeed;
