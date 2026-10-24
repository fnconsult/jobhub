/**
 * The Help Articles (ADR-0035): short texts written by the Jobbbox team, never by an AI, in French and English,
 * and their search. Nothing here calls an AI model or reads a file: it runs in the browser as well as on the server.
 *
 *   articleFor("/candidatures/abc/documents", "fr"); // the article of the Application's page
 *   search("comment relancer le recruteur", "fr");    // [the « Comment relancer un recruteur ? » question, …]
 */
import { ARTICLES } from "./articles.generated";
import type { HelpArticle, HelpLocale } from "./types";

export { HELP_ARTICLE_KINDS, HELP_LOCALES, type HelpArticle, type HelpArticleKind, type HelpLocale } from "./types";

/** Every Help Article in `locale`: the page articles, then the glossary, then the frequent questions, each by title. */
export function articles(locale: HelpLocale): readonly HelpArticle[] {
  return ARTICLES[locale];
}

/** The Help Article `id` in `locale`, or null when there is none. */
export function article(id: string, locale: HelpLocale): HelpArticle | null {
  return ARTICLES[locale].find((entry) => entry.id === id) ?? null;
}
