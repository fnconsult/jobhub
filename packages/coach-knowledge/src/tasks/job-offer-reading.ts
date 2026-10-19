import type { TaskPlaybookSeed } from "./types";

/** The Job Offer Summary, sector and sub-sector (offer_analysis). Not validated at import: nothing is asked until a person validates it. */
export const jobOfferReading = {
  id: "job-offer-reading",
  title: "Lire une offre d'emploi : résumé et secteur",
  aiTask: "offer_analysis",
  agent: true,
  validatedAtImport: false,
  instructions: `- "summary" : deux ou trois phrases (400 caractères au plus) sur le poste, son périmètre et ce qui est attendu,
  écrites dans la langue de l'offre (en anglais pour une offre en anglais). Uniquement ce que l'offre dit, sans rien inventer
  ni juger, et sans nom de personne (recruteur, manager).
- "sector" : le secteur d'activité de l'employeur en quelques mots (ex. « Conseil », « Industrie automobile »), et
  "subsector" : son sous-secteur ou domaine, plus précis (ex. « Stratégie et transformation »), dans la langue de l'offre,
  d'après ce que l'offre dit de l'employeur et du poste. Omets-les si l'offre n'en dit rien.`,
} as const satisfies TaskPlaybookSeed;
