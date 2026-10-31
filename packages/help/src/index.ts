/**
 * The Help Articles (ADR-0035): short texts written by the Jobbbox team, never by an AI, in French and English,
 * and their search. Nothing here calls an AI model or reads a file: it runs in the browser as well as on the server.
 *
 *   articleFor("/candidatures/abc/documents", "fr"); // the article of the Application's page
 *   search("comment relancer le recruteur", "fr");    // [the « Comment relancer un recruteur ? » question, …]
 *   questionKey("Pourquoi suis-je bloqué ?");          // "bloque": the words the search reads, to group a question
 */
import { ARTICLES } from "./articles.generated";
import { isNoticed } from "./legal-notices";
import { legalTextVersionUrl, type LegalTextHistoryEntry, type LegalTextId, type LegalTextVersion, type LegalTextVersionRecord } from "./legal-texts";
import { LEGAL_TEXT_REGISTRY, LEGAL_TEXT_VERSIONS } from "./legal-texts.generated";
import type { ReleaseNote } from "./release-notes";
import { RELEASE_NOTES } from "./release-notes.generated";
import { indexArticle, queryWords, searchIndex, type IndexedArticle } from "./search";
import type { HelpArticle, HelpLocale } from "./types";

export {
  isLegalTextId,
  LEGAL_TEXT_ANCHORS,
  LEGAL_TEXT_CHANGES,
  LEGAL_TEXT_DAY,
  LEGAL_TEXTS,
  legalTextVersionUrl,
  parisDay,
  type LegalTextChange,
  type LegalTextHistoryEntry,
  type LegalTextId,
  type LegalTextVersion,
  type LegalTextVersionRecord,
} from "./legal-texts";
export { addDays, earliestNoticedEffective, isNoticed, LEGAL_NOTICE_DAYS, legalNoticesDue, NOTICED_LEGAL_TEXTS, privacyChangeInEffect } from "./legal-notices";
export {
  nouveautes,
  RELEASE_NOTE_CHANGE_KINDS,
  RELEASE_NOTE_TAGS,
  type Nouveautes,
  type ReleaseNote,
  type ReleaseNoteChangeKind,
  type ReleaseNoteTag,
} from "./release-notes";
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

/**
 * The Release Notes this build carries (ADR-0063), in `locale`, newest first: what Nouveautés reads, through
 * `nouveautes`, which sets the Beta's next Version apart. Written by the team, never by an AI.
 */
export function releaseNotes(locale: HelpLocale): readonly ReleaseNote[] {
  return RELEASE_NOTES[locale];
}

/**
 * What /legal shows of one Legal Text: a version, whether it is the one in effect, whether it is a substantial version
 * still to come (its notice links to it, #547), and the version history.
 */
export interface ShownLegalText {
  version: LegalTextVersion;
  inEffect: boolean;
  upcoming?: true;
  history: LegalTextHistoryEntry[];
}

/**
 * A Legal Text as /legal shows it (ADR-0062): the version in effect `on` that day (`parisDay()`), or the dated
 * `version` when asked, with the version history. A version is never served as the one in effect before its
 * effective date; a substantial version of the CGU, the CGV or the privacy policy still to come is served at its dated
 * address, marked upcoming, since the email telling Candidates of it links there (#547). Null while the team has
 * written no version in effect, for a date that is no version, or a minor version still to come. `written` defaults
 * to the versions this build carries.
 */
export function legalText(
  text: LegalTextId,
  locale: HelpLocale,
  { on, version }: { on: string; version?: string },
  written: readonly LegalTextVersion[] = LEGAL_TEXT_VERSIONS[locale],
): ShownLegalText | null {
  const served = inEffectSoFar(text, on, written);
  const history = () => legalTextHistory(text, locale, on, written);
  const coming = version ? written.find((entry) => entry.text === text && entry.effective === version && entry.effective > on && isNoticed(entry)) : undefined;
  if (coming) return { version: coming, inEffect: false, upcoming: true, history: history() };
  const shown = version ? served.find((entry) => entry.effective === version) : served[0];
  if (!shown) return null;
  return { version: shown, inEffect: shown === served[0], history: history() };
}

/** The version history of a Legal Text (/legal/<text>/versions): each version in effect `on` that day or before, newest first. */
export function legalTextHistory(text: LegalTextId, locale: HelpLocale, on: string, written: readonly LegalTextVersion[] = LEGAL_TEXT_VERSIONS[locale]): LegalTextHistoryEntry[] {
  return inEffectSoFar(text, on, written).map(({ effective, change, summary }) => ({ effective, change, summary, url: legalTextVersionUrl(text, effective) }));
}

function inEffectSoFar(text: LegalTextId, on: string, written: readonly LegalTextVersion[]): LegalTextVersion[] {
  return written.filter((entry) => entry.text === text && entry.effective <= on).sort((a, b) => b.effective.localeCompare(a.effective));
}

/**
 * Every Legal Text Version this build carries, those still to come included, as the Acceptances record them (#510):
 * id, permanent URL, SHA-256 of the French text, change. Computed at build, never written to the database here.
 */
export function legalTextRegistry(): readonly LegalTextVersionRecord[] {
  return LEGAL_TEXT_REGISTRY;
}

/** The registry's record of one Legal Text Version, by its id (its effective date); null for no such version. */
export function legalTextVersionRecord(text: LegalTextId, version: string, registry: readonly LegalTextVersionRecord[] = LEGAL_TEXT_REGISTRY): LegalTextVersionRecord | null {
  return registry.find((entry) => entry.text === text && entry.version === version) ?? null;
}

/** The registry's record of the version of `text` in effect `on` that day: the one to accept; null before its first version. */
export function legalTextVersionInEffect(text: LegalTextId, on: string, registry: readonly LegalTextVersionRecord[] = LEGAL_TEXT_REGISTRY): LegalTextVersionRecord | null {
  return (
    registry
      .filter((entry) => entry.text === text && entry.version <= on)
      .sort((a, b) => b.version.localeCompare(a.version))[0] ?? null
  );
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
