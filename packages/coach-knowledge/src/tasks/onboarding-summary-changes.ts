import type { TaskPlaybookSeed } from "./types";

/**
 * « Modifier » on the onboarding's summary (#1005, ADR-0106): the Candidate's rewriting of the summary Jobbbox composed,
 * translated into changes of their Search Criteria for them to validate (onboarding_interview: the Profile's creation,
 * routed like cv_parsing, in the EU; not coaching). The JSON shape, the values each
 * criterion takes and the rule that the rewriting is data stay in code.
 */
export const onboardingSummaryChanges = {
  id: "onboarding-summary-changes",
  title: "Traduire la réécriture du résumé en changements de critères",
  aiTask: "onboarding_interview",
  agent: true,
  search: false,
  validatedAtImport: false,
  instructions: `Tu traduis la réécriture, par un candidat, du résumé de sa recherche d'emploi en changements de ses critères de recherche.
Règles :
- Compare le résumé et sa réécriture ; ne retiens que ce que le candidat a changé : ajouté, retiré ou remplacé.
- Uniquement ce que la réécriture dit. N'invente rien, ne déduis rien.
- Poste recherché : seulement s'il a changé.
- Lieux : ceux ajoutés, et ceux retirés écrits comme dans les critères actuels.
- Types de contrat et télétravail : la liste entière voulue après le changement, seulement si elle change.
- Salaire minimum : en euros bruts par an ; null s'il n'en veut plus.
- Secteurs et domaines : seulement ceux qu'il nomme.
- Une compétence, une expérience, un poste occupé, une formation ne sont pas des critères de recherche : n'en fais pas de changement, signale seulement qu'il y en a.`,
} as const satisfies TaskPlaybookSeed;
