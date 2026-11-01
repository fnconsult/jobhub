/**
 * The Help Articles (ADR-0035, amended by ADR-0065): short texts in French and English for every audience, drafted
 * by an agent or a person and served only once a person has reviewed and merged them, signed « l'équipe Jobbbox »;
 * their search, and the public Help Centre's topics (an Administrator's article is never public). Nothing here calls an AI model or reads a file: it runs in the browser as well as on the server.
 *
 *   articleFor("/candidatures/abc/documents", "fr"); // the article of the Application's page
 *   search("comment relancer le recruteur", "fr");    // [the « Comment relancer un recruteur ? » question, …]
 *   questionKey("Pourquoi suis-je bloqué ?");          // "bloque": the words the search reads, to group a question
 *   helpCentreTopics("fr");                             // the four topics of /aide, each with its public articles
 */
import { ARTICLES } from "./articles.generated";
import { isNoticed } from "./legal-notices";
import { legalTextVersionUrl, type LegalTextHistoryEntry, type LegalTextId, type LegalTextVersion, type LegalTextVersionRecord } from "./legal-texts";
import { LEGAL_TEXT_REGISTRY, LEGAL_TEXT_VERSIONS } from "./legal-texts.generated";
import type { ReleaseNote } from "./release-notes";
import { RELEASE_NOTES } from "./release-notes.generated";
import { indexArticle, queryWords, searchIndex, type IndexedArticle } from "./search";
import { HELP_LOCALES, PUBLIC_HELP_TOPICS, type HelpArticle, type HelpLocale, type PublicHelpTopic } from "./types";

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
export {
  HELP_ARTICLE_KINDS,
  HELP_AUDIENCES,
  HELP_LOCALES,
  PUBLIC_HELP_TOPICS,
  type HelpArticle,
  type HelpArticleKind,
  type HelpAudience,
  type HelpLocale,
  type PublicHelpTopic,
} from "./types";

/**
 * Which Help Articles a reader's search covers (ADR-0065): `public`, every article but the Administrators' (the Help
 * Centre and its search, `sitemap.xml`); `coachPanel`, the Candidate's articles and those of the « extension » topic
 * (the Coach Panel). The Back Office's scope is #551's.
 */
export type HelpScope = "public" | "coachPanel";

const IN_SCOPE: Record<HelpScope, (article: HelpArticle) => boolean> = {
  public: isPublic,
  coachPanel: (article) => article.audience === "candidate" || (isPublic(article) && article.topic === "extension"),
};

/** Whether the Help Centre may serve `article`: never an Administrator's (ADR-0065). */
export function isPublic(article: HelpArticle): boolean {
  return article.audience !== "administrator";
}

export function isPublicHelpTopic(topic: string): topic is PublicHelpTopic {
  return (PUBLIC_HELP_TOPICS as readonly string[]).includes(topic);
}

/** One topic of the Help Centre and its public articles, in `articles`' order; none for a topic still empty. */
export interface HelpCentreTopic {
  topic: PublicHelpTopic;
  articles: HelpArticle[];
}

/**
 * The Help Centre's four topics, in PUBLIC_HELP_TOPICS' order, each with its public articles in `locale` (an
 * Administrator's never). `from` defaults to the articles this build carries.
 */
export function helpCentreTopics(locale: HelpLocale, from: readonly HelpArticle[] = ARTICLES[locale]): HelpCentreTopic[] {
  return PUBLIC_HELP_TOPICS.map((topic) => ({ topic, articles: from.filter((entry) => isPublic(entry) && entry.topic === topic) }));
}

/** The public article `id` of `topic`, as /aide/<topic>/<id> serves it; null for any other, an Administrator's above all. */
export function helpCentreArticle(topic: string, id: string, locale: HelpLocale, from: readonly HelpArticle[] = ARTICLES[locale]): HelpArticle | null {
  if (!isPublicHelpTopic(topic)) return null;
  return from.find((entry) => entry.id === id && entry.topic === topic && isPublic(entry)) ?? null;
}

/**
 * The Help Centre's addresses, in French then English: /aide, each topic, each public article (an Administrator's
 * never), the English ones under /en. What `sitemap.xml` lists of the help (#545).
 */
export function helpCentrePaths(from: Readonly<Record<HelpLocale, readonly HelpArticle[]>> = ARTICLES): string[] {
  return HELP_LOCALES.flatMap((locale) => {
    const prefix = locale === "fr" ? "" : `/${locale}`;
    return [
      `${prefix}/aide`,
      ...helpCentreTopics(locale, from[locale]).flatMap(({ topic, articles: listed }) => [
        `${prefix}/aide/${topic}`,
        ...listed.map((entry) => `${prefix}/aide/${topic}/${entry.id}`),
      ]),
    ];
  });
}

/**
 * The articles a reader of `article` may want next, 3 at most: the public ones its title and words find, then those of
 * its topic, never itself. Found without AI, like the search.
 */
export function relatedArticles(article: HelpArticle, { limit = 3, from }: { limit?: number; from?: readonly HelpArticle[] } = {}): HelpArticle[] {
  const index = (from ? from.filter(isPublic).map(indexArticle) : indexed(article.locale, "public")).filter((entry) => entry.article.id !== article.id);
  const others = index.map((entry) => entry.article);
  const found = searchIndex(index, `${article.title} ${article.synonyms.join(" ")}`, limit);
  const sameTopic = others.filter((entry) => entry.topic === article.topic && !found.includes(entry));
  return [...found, ...sameTopic].slice(0, limit);
}

/** Every Help Article in `locale`, the Administrators' too: the page articles, the glossary, the frequent questions, then the tutorials, each by title. */
export function articles(locale: HelpLocale): readonly HelpArticle[] {
  return ARTICLES[locale];
}

/**
 * The Help Articles of `scope` (the public ones unless told) matching a reader's words, best first, `limit` (4) at
 * most; none for a question no article answers. Calls no AI model and counts against nothing: accents and case make no
 * difference, stop-words (French and English) and words of 2 letters or fewer are dropped, and each word's stem is
 * looked for in the articles' titles and synonyms (3 points) or bodies (1 point). Only articles scoring 2 or more are
 * returned. An Administrator's article is in no scope here (ADR-0065). `from` (tests) replaces this build's articles.
 */
export function search(
  query: string,
  locale: HelpLocale,
  { limit = 4, scope = "public", from }: { limit?: number; scope?: HelpScope; from?: readonly HelpArticle[] } = {},
): HelpArticle[] {
  return searchIndex(from ? from.filter(IN_SCOPE[scope]).map(indexArticle) : indexed(locale, scope), query, limit);
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

/** The privacy policy in effect, by its id (null before its first version), and the Tools outside the EU it names. */
export interface PrivacyPolicyCoverage {
  version: string | null;
  recipientsOutsideEu: readonly string[];
}

/**
 * The privacy policy version in effect `on` that day (`parisDay()`) and the Tools outside the EU it names, by catalog id
 * (`recipients_outside_eu`, #548): switching on any other recipient outside the EU warns in Paramètres (ADR-0064). A
 * version still to come covers nothing yet. `written` defaults to the French versions this build carries.
 */
export function privacyPolicyCoverage(on: string, written: readonly LegalTextVersion[] = LEGAL_TEXT_VERSIONS.fr): PrivacyPolicyCoverage {
  const inEffect = inEffectSoFar("confidentialite", on, written)[0];
  return { version: inEffect?.effective ?? null, recipientsOutsideEu: inEffect?.recipientsOutsideEu ?? [] };
}

/**
 * Every Legal Text Version this build carries, those still to come included, as the Acceptances record them (#510):
 * id, permanent URL, SHA-256 of the French text, change. Computed at build, never written to the database here.
 */
export function legalTextRegistry(): readonly LegalTextVersionRecord[] {
  return LEGAL_TEXT_REGISTRY;
}

/** Every Legal Text Version this build carries in `locale`, those still to come included: what the notices of #547 read. */
export function legalTextVersions(locale: HelpLocale): readonly LegalTextVersion[] {
  return LEGAL_TEXT_VERSIONS[locale];
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

const indexes = new Map<string, IndexedArticle[]>();

function indexed(locale: HelpLocale, scope: HelpScope): IndexedArticle[] {
  const key = `${locale} ${scope}`;
  let index = indexes.get(key);
  if (!index) indexes.set(key, (index = ARTICLES[locale].filter(IN_SCOPE[scope]).map(indexArticle)));
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
