/**
 * The help of a Coach Conversation's single box (#342, ADR-0035), found without AI: which Help Articles it shows. The
 * web's Coach Panel and conversations (apps/web/src/coach-help) and the native app's (#690) read the same.
 *
 *   helpSuggestions(draft, "fr")     // « Dans l'aide, sans IA »: what matches the words typed so far
 *   helpForUnanswered(question, "fr") // « Voici ce que l'aide propose »: when the AI Coach could not answer
 *   onThisPage(pathname, "fr")        // « Sur cette page »: the page in view's article and its first paragraph
 *   oftenAsked("fr")                  // « Souvent demandé »: three frequent questions
 *
 * Each takes the help's `audience`: `candidate` (the default), whose search covers the Candidate's articles and those
 * of the Help Centre's « extension » topic, never an Administrator's; or `administrator` (the Back Office Assistant,
 * #551), whose search covers the Administrators' articles only (ADR-0065). And the `settings` of the reader's request
 * (#867): « Espace coach v2 » off unless `{ coachSpaceV2: true }`, its articles then served (`articlesFor`).
 */
import { article, articleFor, articlesFor, search, type HelpScope } from "./index";
import type { HelpSettings } from "./requirements";
import type { HelpArticle, HelpLocale } from "./types";

/** Fewer characters typed than this, and nothing is suggested yet. */
export const MIN_SUGGESTION_LENGTH = 3;
const MAX_SUGGESTIONS = 4;
const MAX_FOR_UNANSWERED = 3;
const OFTEN_ASKED = ["faq-quota-renewal", "faq-follow-up-recruiter", "faq-text-size"] as const;
/** The Help Articles the Back Office Assistant is given with a question (#551), at most. */
const MAX_FOR_ASSISTANT = 3;

/** Whose help it is: the Candidate's, in the Coach Panel, or the Administrators', in the Back Office Assistant (#551). */
export type HelpAudience = "candidate" | "administrator";

const SCOPE: Record<HelpAudience, HelpScope> = { candidate: "coachPanel", administrator: "backOffice" };

/** The Help Articles matching what is being typed, best first, 4 at most; none under MIN_SUGGESTION_LENGTH characters. */
export function helpSuggestions(draft: string, locale: HelpLocale, audience: HelpAudience = "candidate", settings: HelpSettings = {}): HelpArticle[] {
  const query = draft.trim();
  return query.length < MIN_SUGGESTION_LENGTH ? [] : search(query, locale, { limit: MAX_SUGGESTIONS, scope: SCOPE[audience], from: articlesFor(locale, settings) });
}

/** The 3 Help Articles nearest a question the AI could not answer; none when the help has nothing on it. */
export function helpForUnanswered(question: string, locale: HelpLocale, audience: HelpAudience = "candidate", settings: HelpSettings = {}): HelpArticle[] {
  return search(question, locale, { limit: MAX_FOR_UNANSWERED, scope: SCOPE[audience], from: articlesFor(locale, settings) });
}

/**
 * The Administrators' articles the Back Office Assistant is given with `question` (#551), to answer from and cite, 3 at
 * most; none when no article answers it, and the assistant then offers « Demander un tutoriel ». Never another audience's.
 */
export function backOfficeHelpFor(question: string, locale: HelpLocale, settings: HelpSettings = {}): HelpArticle[] {
  return search(question, locale, { limit: MAX_FOR_ASSISTANT, scope: "backOffice", from: articlesFor(locale, settings) });
}

/** The page in view's Help Article of `audience`, with its first paragraph as a teaser; null for a page without one. */
export function onThisPage(
  pathname: string,
  locale: HelpLocale,
  audience: HelpAudience = "candidate",
  settings: HelpSettings = {},
): { article: HelpArticle; excerpt: string } | null {
  const found = articleFor(pathname, locale, { scope: audience === "administrator" ? "backOffice" : "public", from: articlesFor(locale, settings) });
  return found ? { article: found, excerpt: found.body.split(/\n\s*\n/)[0]!.trim() } : null;
}

/** The three frequent questions an empty conversation offers the Candidate; none for an Administrator. */
export function oftenAsked(locale: HelpLocale, audience: HelpAudience = "candidate", settings: HelpSettings = {}): HelpArticle[] {
  if (audience !== "candidate") return [];
  return OFTEN_ASKED.map((id) => article(id, locale, settings)).filter((found): found is HelpArticle => found !== null);
}

/** The Help Articles' language for an Interface Language: English for English, French otherwise. */
export function helpLocale(language: string | undefined): HelpLocale {
  return language?.startsWith("en") ? "en" : "fr";
}
