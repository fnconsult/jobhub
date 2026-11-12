/**
 * The help side of the Coach Panel's single box (#342, ADR-0035): which Help Articles it shows, found without AI.
 *
 *   helpSuggestions(draft, "fr")     // « Dans l'aide, sans IA »: what matches the words typed so far
 *   helpForUnanswered(question, "fr") // « Voici ce que l'aide propose »: when the AI Coach could not answer
 *   onThisPage(pathname, "fr")        // « Sur cette page »: the page in view's article and its first paragraph
 *   oftenAsked("fr")                  // « Souvent demandé »: three frequent questions
 *
 *   helpCentreAddress(article)        // « Ouvrir dans le centre d'aide »: the article's page in the public Help Centre
 *   backOfficeHelpAddress(article)    // « Ouvrir dans l'aide du back office »: an Administrator's article in /admin/aide
 *
 * Each takes the help's `audience`: `candidate` (the default, the Coach Panel), whose search covers the Candidate's
 * articles and those of the Help Centre's « extension » topic, never an Administrator's; or `administrator` (the Back
 * Office Assistant, #551), whose search covers the Administrators' articles only (ADR-0065). Runs in the browser and on
 * the server: it reads the bundled Help Articles and calls no AI model, so nothing here costs anything.
 *
 * Each also takes the Help Articles' `settings` (#867, ADR-0106): « Espace coach v2 » off unless `{ coachSpaceV2: true }`,
 * main's articles while it is off. On the server, `helpSettings()` (./server) reads it for the request; in the browser,
 * `useHelpSettings()` (./settings), as the server read it for the page.
 */
import { isPublic, type HelpArticle } from "@jobhub/help";
import { routes } from "../routes";

export type { HelpArticle, HelpLocale, HelpSettings } from "@jobhub/help";
// Found without AI, shared with the native app (#690): what the box suggests, what the help offers when the AI Coach
// could not answer, the page's article and the frequent questions.
export {
  backOfficeHelpFor,
  helpForUnanswered,
  helpLocale,
  helpSuggestions,
  MIN_SUGGESTION_LENGTH,
  oftenAsked,
  onThisPage,
  type HelpAudience,
} from "@jobhub/help/coach-help";

/** The article's page in the public Help Centre (#549), in its own language (English under /en); null for an Administrator's, never public. */
export function helpCentreAddress(found: HelpArticle): string | null {
  return isPublic(found) ? routes.helpArticle(found.topic, found.id, found.locale) : null;
}

/** An Administrator's article's page in /admin/aide (#551); null for any other, which the Back Office's help never shows. */
export function backOfficeHelpAddress(found: HelpArticle): string | null {
  return found.audience === "administrator" ? routes.adminHelpArticle(found.topic, found.id) : null;
}

export { article as helpArticle } from "@jobhub/help";
