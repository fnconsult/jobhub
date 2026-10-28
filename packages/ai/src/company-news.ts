/**
 * Company News: up to five articles about a Company Dossier's employer from the last twelve months,
 * found by a web search when the dossier is built. Each one's title, outlet, date and link, never its
 * text, and none whose title names a private person.
 *
 *  - `buildCompanyNewsQuery`: the only text sent to the web-search provider for it, built from the
 *    employer's name, registered name and website alone (a company, never a person), cleaned like
 *    Search Criteria, in the "company-news-search" task Playbook's words (ADR-0026). It always asks
 *    for articles as JSON, for none of their text and for none naming a person.
 *  - `companyNewsIn`: the articles kept from the answer. Only items of the expected shape: an http(s)
 *    link that is not a social network's, a title, an outlet, a date within the last twelve months.
 *    Any whose title or outlet may name a person is dropped (when in doubt, dropped): the model must
 *    say it names none, and no role or honorific, no known first name before a capitalised word and,
 *    in a sentence-case title, no run of capitalised words but the employer's may be in it.
 *    Deduplicated by link, newest first, at most five.
 */
import { builtInInstructions, fillSlots, slotsIn } from "@jobhub/coach-knowledge/tasks";
import type { Route } from "./ai-layer";
import { clean, taskQueryText } from "./search-query";
import { FIRST_NAMES } from "./identity-scan";
import type { AiWarning } from "./types";

export interface CompanyNewsRequest {
  candidateId: string | null;
  /** The employer's name, as the Job Offer or the Candidate gives it. Never a person. */
  employer: string;
  /** Its registered name, when the French register gives it: tells it apart from namesakes. */
  registeredName?: string;
  /** Its website, when known: only its host name is sent. */
  website?: string;
  /**
   * The "company-news-search" task Playbook's served text, `{{entreprise}}` standing for the employer's
   * names and website; default: its built-in text.
   */
  instructions?: string;
  /** The web-search provider and model instead of the configured one: the task Playbook's (ADR-0026). */
  route?: Route;
  /** The degraded paths its feature took (a task Playbook's fallback), recorded with the search (#260). */
  warnings?: AiWarning[];
  /** Stops the search (#325): it then rejects, as the only failure that is not "no article". */
  signal?: AbortSignal;
}

/** One article about the employer: never its text. */
export interface CompanyNewsArticle {
  title: string;
  /** The newspaper, magazine or site that published it. */
  outlet: string;
  /** When it was published: a calendar date, YYYY-MM-DD. */
  publishedAt: string;
  url: string;
}

export const MAX_COMPANY_NEWS = 5;
/** How far back an article may date: twelve months. */
export const COMPANY_NEWS_MAX_AGE_DAYS = 365;
/** The keys each article is asked with (see buildCompanyNewsQuery). */
const ARTICLE_KEYS = ["title", "outlet", "date", "url", "namesPerson"] as const;

/** A website's host name, without "www.", or null when it is not a link. */
function hostOf(website: string | undefined): string | null {
  if (!website) return null;
  const link = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  if (!URL.canParse(link)) return null;
  return new URL(link).hostname.toLowerCase().replace(/^www\./, "") || null;
}

export function buildCompanyNewsQuery(request: Omit<CompanyNewsRequest, "candidateId">): string {
  const registered = request.registeredName ? clean(request.registeredName) : "";
  // An employer named by its SIREN alone cleans to nothing: the registered name is its name then.
  const employer = clean(request.employer) || registered;
  const host = hostOf(request.website);
  const known = [
    registered && registered.toLowerCase() !== employer.toLowerCase() ? `raison sociale « ${registered} »` : "",
    host ? `site web ${host}` : "",
  ].filter(Boolean);
  const words = request.instructions !== undefined && slotsIn(request.instructions).includes("entreprise") ? request.instructions : builtInInstructions("company-news-search");
  const company = `« ${employer} »${known.length > 0 ? ` (${known.join(", ")})` : ""}`;
  return (
    `${taskQueryText(fillSlots(words, { entreprise: company }), "company-news-search")} ` +
    `Réponds uniquement par un objet JSON {"articles": [{${ARTICLE_KEYS.map((key) => `"${key}"`).join(", ")}}]} : ` +
    `title le titre de l'article, outlet le média, date sa date de publication (AAAA-MM-JJ), url son lien, ` +
    `namesPerson true si le titre nomme une personne. Ne recopie pas le texte des articles. ` +
    `N'inclus aucun article dont le titre nomme une personne.`
  );
}

/** Social networks and their kin: a post there is a person's, not a news article. */
const SOCIAL_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "threads.net", "viadeo.com", "youtube.com", "reddit.com"];

/** An article's link: http(s), not on a social network, without its fragment. Null when it is not one. */
function articleUrl(value: unknown): string | null {
  if (typeof value !== "string" || !URL.canParse(value.trim())) return null;
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (SOCIAL_HOSTS.some((social) => host === social || host.endsWith(`.${social}`))) return null;
  url.hash = "";
  return url.toString();
}

/** The calendar date an article was published on, if it is one within the last twelve months; else null. */
function publishedOn(value: unknown, now: Date): string | null {
  const text = value instanceof Date ? value.toISOString() : typeof value === "string" ? value.trim() : "";
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!day) return null;
  const date = new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00Z`);
  // "2026-02-31" is no date.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day[0]) return null;
  const oldest = now.getTime() - COMPANY_NEWS_MAX_AGE_DAYS * 86_400_000;
  // A day's slack for time zones: an article dated today somewhere else is not from the future.
  if (date.getTime() < oldest || date.getTime() > now.getTime() + 86_400_000) return null;
  return day[0];
}

/** Roles, honorifics and words that tell a title is about a person, in French or English. */
const PERSON_WORDS = new RegExp(
  "(?<![\\p{L}])(" +
    [
      "co-?founders?|founders?|fondat(eur|rice)s?|cofondat(eur|rice)s?",
      "ceo|cfo|coo|cto|pdg|dg|drh|chairman|chairwoman|owner|propri[ée]taire|pr[ée]sidente?|directeur|directrice|g[ée]rante?|patron(ne)?|boss",
      "head of|chief|executive|vice-?pr[ée]sidente?|vp",
      "nomm[ée]e?s?|appoint(s|ed|ment)|names|rejoint|joins|interview|entretien|portrait|t[ée]moigne|selon|says",
      "mr|mrs|ms|mme|mlle|m\\.|dr|sir|lady|madame|monsieur",
    ].join("|") +
    ")(?![\\p{L}])",
  "iu",
);

/** A text's words; a hyphenated name (Clermont-Ferrand) is one word. */
const words = (text: string) => text.split(/[\s"«»“”‘’'(),:;!?|/–—]+/u).filter((word) => /\p{L}/u.test(word));
const capitalised = (word: string) => /^\p{Lu}/u.test(word);
const parts = (text: string) => text.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Is this word the employer's own: each of its parts a word of the employer's names? */
const ownWord = (own: Set<string>, word: string) => parts(word).length > 0 && parts(word).every((part) => own.has(part));

/** Is this title written with every word capitalised, as English headlines often are? Then capitals tell nothing. */
function isTitleCase(text: string): boolean {
  const long = words(text).slice(1).filter((word) => /^\p{L}{4,}$/u.test(word));
  return long.length >= 3 && long.filter(capitalised).length / long.length >= 0.7;
}

/**
 * May this text name a person? When in doubt, yes. Not when the capitalised words are the employer's
 * own (its name, registered name or website): "Acme Industrie" is the company. `name`: the text is a
 * name itself (an outlet's, "The New York Times"), whose capitals tell nothing.
 */
export function mayNamePerson(text: string, companyNames: string[], { name = false }: { name?: boolean } = {}): boolean {
  if (PERSON_WORDS.test(text)) return true;
  const own = new Set(companyNames.flatMap(parts));
  const all = words(text.normalize("NFC"));
  for (let index = 0; index + 1 < all.length; index++) {
    const [word, next] = [all[index]!, all[index + 1]!];
    if (capitalised(word) && capitalised(next) && FIRST_NAMES.has(word.toLowerCase()) && !ownWord(own, word)) return true;
  }
  if (name || isTitleCase(text)) return false;
  // In a sentence-case title, two capitalised words in a row past the first word, not the employer's, may be a name.
  for (let index = 1; index + 1 < all.length; index++) {
    const pair = [all[index]!, all[index + 1]!];
    if (pair.every((word) => capitalised(word) && /\p{Ll}/u.test(word) && !ownWord(own, word))) return true;
  }
  return false;
}

/** The first JSON value in the answer that is an object or an array, or null. */
function jsonIn(answer: string): unknown {
  const start = answer.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(answer.lastIndexOf("}"), answer.lastIndexOf("]"));
  try {
    return end > start ? JSON.parse(answer.slice(start, end + 1)) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) => {
  const trimmed = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return trimmed && trimmed.length <= max && !/^(null|inconnu|unknown|n\/a)$/i.test(trimmed) ? trimmed : null;
};

/**
 * The articles kept from a news search's answer (see the module doc). `sourceDates` stands for an
 * article's date when the answer gives none. `companyNames`: the employer's names, never a person's.
 */
export function companyNewsIn(
  answer: string,
  { now, companyNames, sourceDates = {} }: { now: Date; companyNames: string[]; sourceDates?: Record<string, Date> },
): CompanyNewsArticle[] {
  const parsed = jsonIn(answer);
  const items: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { articles?: unknown } | null)?.articles) ? (parsed as { articles: unknown[] }).articles : [];
  const kept = new Map<string, CompanyNewsArticle>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const fields = item as Record<string, unknown>;
    // The model must say the title names no one: an answer that does not say is in doubt.
    if (fields.namesPerson !== false) continue;
    const url = articleUrl(fields.url);
    const outlet = text(fields.outlet, 80);
    let title = text(fields.title, 300);
    if (!url || !outlet || !title || kept.has(url)) continue;
    // "Acme ouvre une usine - Les Echos": the outlet is shown apart.
    const suffix = new RegExp(`\\s+[-|–—]\\s+${outlet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    title = title.replace(suffix, "").trim();
    const publishedAt = publishedOn(fields.date, now) ?? (fields.date === undefined || fields.date === null ? publishedOn(sourceDates[url] ?? sourceDates[String(fields.url)], now) : null);
    if (!title || !publishedAt) continue;
    if (mayNamePerson(title, companyNames) || mayNamePerson(outlet, companyNames, { name: true })) continue;
    kept.set(url, { title, outlet, publishedAt, url });
  }
  return [...kept.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, MAX_COMPANY_NEWS);
}
