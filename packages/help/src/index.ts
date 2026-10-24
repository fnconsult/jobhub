/**
 * The Help Articles (ADR-0035): short texts written by the Jobbbox team, never by an AI, in French and English,
 * and their search. Nothing here calls an AI model or reads a file: it runs in the browser as well as on the server.
 *
 *   articleFor("/candidatures/abc/documents", "fr"); // the article of the Application's page
 *   search("comment relancer le recruteur", "fr");    // [the « Comment relancer un recruteur ? » question, …]
 *   questionKey("Pourquoi suis-je bloqué ?");          // "bloque": the words the search reads, to group a question
 */
import { ARTICLES } from "./articles.generated";
import { indexArticle, queryWords, searchIndex, type IndexedArticle } from "./search";
import type { HelpArticle, HelpLocale } from "./types";

export { HELP_ARTICLE_KINDS, HELP_LOCALES, type HelpArticle, type HelpArticleKind, type HelpLocale } from "./types";

/** Every Help Article in `locale`: the page articles, then the glossary, then the frequent questions, each by title. */
export function articles(locale: HelpLocale): readonly HelpArticle[] {
  return ARTICLES[locale];
}

/**
 * The Help Articles matching a Candidate's words, best first, `limit` (4) at most; none for a question no article
 * answers. Calls no AI model and counts against nothing: accents and case make no difference, stop-words (French
 * and English) and words of 2 letters or fewer are dropped, and each word's stem is looked for in the articles'
 * titles and synonyms (3 points) or bodies (1 point). Only articles scoring 2 or more are returned.
 */
export function search(query: string, locale: HelpLocale, { limit = 4 }: { limit?: number } = {}): HelpArticle[] {
  return searchIndex(indexed(locale), query, limit);
}

/**
 * A question's words as the search reads them, in alphabetical order, joined by spaces: the same question written
 * with other accents, case, punctuation, stop-words or word order gets the same key. What groups Unanswered Questions (#344).
 */
export function questionKey(query: string): string {
  return queryWords(query).sort().join(" ");
}

const indexes = new Map<HelpLocale, IndexedArticle[]>();

function indexed(locale: HelpLocale): IndexedArticle[] {
  let index = indexes.get(locale);
  if (!index) indexes.set(locale, (index = ARTICLES[locale].map(indexArticle)));
  return index;
}

/** The Help Article `id` in `locale`, or null when there is none. */
export function article(id: string, locale: HelpLocale): HelpArticle | null {
  return ARTICLES[locale].find((entry) => entry.id === id) ?? null;
}

/**
 * The page article of `route`: a route pattern (`/candidatures/[id]`) or the address of a page in view
 * (`/candidatures/0b6c…/documents?vue=liste`). A page's Sections get the article of their page; when two
 * patterns match, the one with more segments, then more fixed ones, wins (`/profils/nouveau` over `/profils/[id]`).
 * Null for a page without an article.
 */
export function articleFor(route: string, locale: HelpLocale): HelpArticle | null {
  const path = segments(route.split(/[?#]/)[0]!);
  let best: { entry: HelpArticle; rank: [number, number] } | null = null;
  for (const entry of ARTICLES[locale]) {
    if (!entry.route) continue;
    const pattern = segments(entry.route);
    if (!patternMatches(pattern, path)) continue;
    const rank: [number, number] = [pattern.length, pattern.filter((segment) => !isDynamic(segment)).length];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { entry, rank };
  }
  return best?.entry ?? null;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

const isDynamic = (segment: string) => /^\[.+\]$/.test(segment);

/** `pattern` is the start of `path` (the home page `/` only matches itself). */
function patternMatches(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  return pattern.length <= path.length && pattern.every((segment, index) => isDynamic(segment) || segment === path[index]);
}
