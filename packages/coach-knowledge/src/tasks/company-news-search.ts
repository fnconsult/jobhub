import type { TaskPlaybookSeed } from "./types";

/**
 * The web-search query of Company News (web_search): {{entreprise}} is the employer's names and website,
 * cleaned. The JSON shape, "no article text" and "no article naming a person" stay in code. No Playbook
 * Agent: it goes to the web-search provider its version names, else the configured one.
 */
export const companyNewsSearch = {
  id: "company-news-search",
  title: "Rechercher l'actualité d'une entreprise (Company News)",
  aiTask: "web_search",
  agent: false,
  search: true,
  validatedAtImport: true,
  slots: ["entreprise"],
  maxLength: 600,
  instructions: `Articles de presse récents (moins de 12 mois) sur l'entreprise {{entreprise}} : au plus 5, les plus récents d'abord.`,
} as const satisfies TaskPlaybookSeed;
