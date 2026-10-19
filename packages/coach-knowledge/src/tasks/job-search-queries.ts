import type { TaskPlaybookSeed } from "./types";

/**
 * A Job Search's queries: the job title variants step (job_titles, on its Playbook Agent, given the
 * Search Criteria title alone), and how each web-search query opens, in French and English, where
 * {{intitulé}} and {{lieu}} are one job title and one location of the Search Criteria, cleaned. The
 * JSON shape, the cap on titles, and the contract, remote-work and salary words stay in code.
 */
export const jobSearchQueries = {
  id: "job-search-queries",
  title: "Préparer les requêtes d'une recherche d'offres",
  aiTask: "job_titles",
  agent: true,
  validatedAtImport: true,
  sections: [
    { key: "intitulés", label: "consigne de l'étape qui trouve les autres intitulés du poste" },
    { key: "requête fr", label: "début de chaque requête en français", slots: ["intitulé", "lieu"] },
    { key: "requête en", label: "début de chaque requête en anglais", slots: ["intitulé", "lieu"] },
  ],
  maxLength: 4000,
  instructions: `## intitulés

Tu aides à chercher des offres d'emploi. On te donne un intitulé de poste. Donne les autres intitulés que les recruteurs emploient pour ce même poste : jusqu'à 2 en français et jusqu'à 3 en anglais, les plus courants d'abord, sans changer de niveau ni de métier.

## requête fr

Offre d'emploi « {{intitulé}} » à {{lieu}}

## requête en

Job offer "{{intitulé}}" in {{lieu}}`,
} as const satisfies TaskPlaybookSeed;
