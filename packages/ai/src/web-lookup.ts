/**
 * The AI Coach's Web lookup (ADR-0119 « A web lookup », #1159): the one web search whose query is not built from Search
 * Criteria nor an employer's name, but worded by the AI Coach to answer what no object of the Candidate holds (a company's
 * competitors, its funding, a salary). So it is checked here, before it leaves (ADR-0007):
 *  - a query naming a person is refused: a first name of the register (identity-scan's FIRST_NAMES) before a capitalised
 *    word, or an honorific before one (« Mme Durand »), as `personNamesIn` finds them;
 *  - a query aimed at LinkedIn is refused, and LinkedIn's pages are excluded from the search;
 *  - its contact details are taken out, as from any free text, and the Candidate's identity redacted by the AI layer.
 * The pages it finds (`webPagesIn`) keep their title, link and extract, at most WEB_LOOKUP_MAX_RESULTS, and never one on
 * LinkedIn nor one whose title or extract names a person: none is told to the AI Coach, none reaches a Provenance.
 *
 *   webLookupRefusal("qui sont les concurrents d'Exemple Industrie")   // null: it may be sent
 *   webLookupRefusal("Jean Dupont Exemple Industrie")                  // "names_person"
 *   await ai.lookUpWeb({ candidateId, query })                         // { pages, call }
 */
import { personNamesIn } from "./identity-scan";
import { clean } from "./search-query";
import type { SearchFilters } from "./types";

/** The most pages one Web lookup gives the AI Coach. */
export const WEB_LOOKUP_MAX_RESULTS = 5;

/** The longest query the AI Coach may send, in characters, once cleaned. */
export const WEB_LOOKUP_QUERY_MAX_LENGTH = 200;

/** LinkedIn's sites: never searched, never read (ADR-0001, ADR-0119). */
const LINKEDIN_SITES = ["linkedin.com", "lnkd.in"];
const LINKEDIN = /linked[\s._-]*in|lnkd\.in/i;

/** What a Web lookup's search is narrowed by: LinkedIn's pages left out, a few results. */
export const WEB_LOOKUP_FILTERS: SearchFilters = { excludeDomains: ["linkedin.com"], maxResults: WEB_LOOKUP_MAX_RESULTS };

/** Why a Web lookup's query is not sent: it names a person, it is aimed at LinkedIn, or nothing is left of it. */
export type WebLookupRefusal = "names_person" | "linkedin" | "empty";

/** The query as it is sent: its contact details taken out, its whitespace collapsed, within WEB_LOOKUP_QUERY_MAX_LENGTH. */
export const webLookupQuery = (query: string): string => clean(query, WEB_LOOKUP_QUERY_MAX_LENGTH);

/** Why `query` must not be sent, or null when it may. */
export function webLookupRefusal(query: string): WebLookupRefusal | null {
  const sent = webLookupQuery(query);
  if (!/\p{L}/u.test(sent)) return "empty";
  if (LINKEDIN.test(sent)) return "linkedin";
  if (personNamesIn(sent).length > 0) return "names_person";
  return null;
}

/** One page a Web lookup found: its title, its link and its extract, as the Search provider gave them. */
export interface WebPage {
  title: string;
  url: string;
  snippet: string;
}

const onLinkedIn = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LINKEDIN_SITES.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return true;
  }
};

const oneLine = (lines: readonly string[]) => lines.join(" ").replace(/\s+/g, " ").trim();

/**
 * The pages in a search's `answer`, as every Search provider lists them (web-results.ts: title, link and extract, a blank
 * line between two pages), each link one of `sources`: at most WEB_LOOKUP_MAX_RESULTS, none on LinkedIn, none whose title
 * or extract names a person.
 */
export function webPagesIn(answer: string, sources: readonly string[]): WebPage[] {
  const links = new Set(sources.map((source) => source.trim()));
  const pages: WebPage[] = [];
  for (const block of answer.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const at = lines.findIndex((line) => links.has(line));
    const last = pages.at(-1);
    // A blank line inside an extract: the rest of the page before it.
    if (at < 0) {
      if (last) last.snippet = oneLine([last.snippet, ...lines]);
      continue;
    }
    pages.push({ title: oneLine(lines.slice(0, at)), url: lines[at]!, snippet: oneLine(lines.slice(at + 1)) });
  }
  return pages.filter((page) => !onLinkedIn(page.url) && personNamesIn(`${page.title}\n${page.snippet}`).length === 0).slice(0, WEB_LOOKUP_MAX_RESULTS);
}
