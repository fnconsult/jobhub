import type { TaskPlaybookSeed } from "./types";

/**
 * The web-search query of a Company Dossier's web facts (web_search): {{entreprise}} is the employer's
 * name, cleaned. The JSON keys asked for and "name no person" stay in code. No Playbook Agent: it goes
 * to the configured web-search provider.
 */
export const companyFactsSearch = {
  id: "company-facts-search",
  title: "Rechercher les faits d'une entreprise (Company Dossier)",
  aiTask: "web_search",
  agent: false,
  validatedAtImport: true,
  slots: ["entreprise"],
  maxLength: 600,
  instructions: `Fiche d'entreprise de {{entreprise}} : pays, adresse du siège, secteur d'activité, effectif, chiffre d'affaires, site web, numéro SIREN si elle est française.`,
} as const satisfies TaskPlaybookSeed;
