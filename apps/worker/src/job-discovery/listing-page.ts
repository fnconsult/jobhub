/**
 * Listing pages: a page listing several postings (a job board's search results,
 * a careers site's openings) rather than describing one. Job discovery follows
 * a few of its links to the individual postings on the same site; each followed
 * link is then read like any result page (ADR-0002).
 */
import { decodeEntities } from "./html";

/** How many postings of one listing page are followed. */
export const MAX_FOLLOWED_LINKS = 5;

/** A link to postings in general (a path segment such as "/offres-emploi/" or "/jobs/"). */
const JOB_SEGMENT =
  /^(offres?|offres?-(d-)?emplois?|emplois?|jobs?|job-offers?|postes?|annonces?|vacanc(y|ies)|careers?|carrieres?|positions?|openings?|recrutements?|detail-offre)$/i;

/** Fewer links to postings than this is a page mentioning offers (an article), not a listing page. */
const MIN_LISTED = 3;

/** A page of results, not a posting ("/page-2", "/p2"). */
const PAGINATION = /^(page|p)[-_]?\d+$/i;

/** The page's links (resolved, without fragment), in document order, leaving out those marked nofollow. */
function followableLinks(page: { url: string; html: string }): URL[] {
  const links: URL[] = [];
  for (const match of page.html.matchAll(/<a\b([^>]*)>/gi)) {
    const attributes = match[1]!;
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1] ?? "";
    if (/\b(nofollow|sponsored|ugc)\b/i.test(rel)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!value) continue;
    try {
      const url = new URL(decodeEntities(value.trim()), page.url);
      url.hash = "";
      links.push(url);
    } catch {
      // Not a URL: not a posting either.
    }
  }
  return links;
}

const site = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");

/** Whether the URL points at one posting: a slug or reference under a job segment ("/offres-emploi/5481237-daf-h-f"). */
function isPostingUrl(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment).replace(/\.(html?|php|aspx?)$/i, ""));
  const last = segments.at(-1);
  if (!last || JOB_SEGMENT.test(last) || PAGINATION.test(last)) return false;
  if (!segments.slice(0, -1).some((segment) => JOB_SEGMENT.test(segment))) return false;
  return /\d/.test(last) || /[-_]/.test(last);
}

/**
 * The links to individual postings to follow from this page, at most
 * MAX_FOLLOWED_LINKS, when it is a listing page; none otherwise. Only links on
 * the page's own site, each once, in the page's order.
 */
export function listingPageLinks(page: { url: string; html: string }): string[] {
  const from = new URL(page.url);
  // A posting's own page often links to similar offers: it is still one posting.
  if (isPostingUrl(from)) return [];
  const found = new Set<string>();
  for (const link of followableLinks(page)) {
    if (site(link) === site(from) && isPostingUrl(link)) found.add(link.toString());
  }
  return found.size < MIN_LISTED ? [] : [...found].slice(0, MAX_FOLLOWED_LINKS);
}
