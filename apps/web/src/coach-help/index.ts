/**
 * The help side of the Coach Panel's single box (#342, ADR-0035): which Help Articles it shows, found without AI.
 *
 *   helpSuggestions(draft, "fr")     // « Dans l'aide, sans IA »: what matches the words typed so far
 *   helpForUnanswered(question, "fr") // « Voici ce que l'aide propose »: when the AI Coach could not answer
 *   onThisPage(pathname, "fr")        // « Sur cette page »: the page in view's article and its first paragraph
 *   oftenAsked("fr")                  // « Souvent demandé »: three frequent questions
 *
 *   helpCentreAddress(article)        // « Ouvrir dans le centre d'aide »: the article's page in the public Help Centre
 *
 * Its search covers the Candidate's articles and those of the Help Centre's « extension » topic (ADR-0065), never an
 * Administrator's. Runs in the browser: it reads the bundled Help Articles and calls no AI model, so nothing here costs anything.
 */
import { article, articleFor, isPublic, search, type HelpArticle, type HelpLocale } from "@jobhub/help";
import { routes } from "../routes";

export type { HelpArticle, HelpLocale } from "@jobhub/help";

/** Fewer characters typed than this, and nothing is suggested yet. */
export const MIN_SUGGESTION_LENGTH = 3;
const MAX_SUGGESTIONS = 4;
const MAX_FOR_UNANSWERED = 3;
const OFTEN_ASKED = ["faq-quota-renewal", "faq-follow-up-recruiter", "faq-text-size"] as const;

/** The Help Articles matching what the Candidate is typing, best first, 4 at most; none under MIN_SUGGESTION_LENGTH characters. */
export function helpSuggestions(draft: string, locale: HelpLocale): HelpArticle[] {
  const query = draft.trim();
  return query.length < MIN_SUGGESTION_LENGTH ? [] : search(query, locale, { limit: MAX_SUGGESTIONS, scope: "coachPanel" });
}

/** The 3 Help Articles nearest a question the AI Coach could not answer; none when the help has nothing on it. */
export function helpForUnanswered(question: string, locale: HelpLocale): HelpArticle[] {
  return search(question, locale, { limit: MAX_FOR_UNANSWERED, scope: "coachPanel" });
}

/** The page in view's Help Article, with its first paragraph as a teaser; null for a page without one. */
export function onThisPage(pathname: string, locale: HelpLocale): { article: HelpArticle; excerpt: string } | null {
  const found = articleFor(pathname, locale);
  return found ? { article: found, excerpt: found.body.split(/\n\s*\n/)[0]!.trim() } : null;
}

/** The three frequent questions an empty conversation offers. */
export function oftenAsked(locale: HelpLocale): HelpArticle[] {
  return OFTEN_ASKED.map((id) => article(id, locale)).filter((found): found is HelpArticle => found !== null);
}

/** The article's page in the public Help Centre (#549), in its own language (English under /en); null for an Administrator's, never public. */
export function helpCentreAddress(found: HelpArticle): string | null {
  return isPublic(found) ? routes.helpArticle(found.topic, found.id, found.locale) : null;
}

/** The Help Articles' language for an Interface Language: English for English, French otherwise. */
export function helpLocale(language: string | undefined): HelpLocale {
  return language?.startsWith("en") ? "en" : "fr";
}

export { article as helpArticle } from "@jobhub/help";
