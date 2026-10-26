/**
 * What the Search providers (Perplexity's Search API, Brave, Tavily) have in common: they return
 * a ranked list of pages, not a written answer. Each page becomes a source, and the answer lists
 * them (title, URL, snippet) so callers reading the answer see the same pages. The filters a
 * provider's contract leaves `emulated` are applied here, to the pages it returned (ADR-0043).
 */
import { isOnDomain, parseStatedDate } from "@jobhub/shared";
import { AiConfigError } from "../errors";
import type { SearchContract, SearchFilterName, SearchFilters, SearchOutput } from "../types";

export interface WebResult {
  title?: string;
  url?: string;
  snippet?: string;
  /** When the provider says the page was published, as it writes it (unread when it cannot be). */
  published?: string | null;
}

/** The filters to apply to the pages returned, as the provider's contract leaves them to the adapter. */
export interface Emulation {
  filters: SearchFilters | undefined;
  /** The filters applied here; the others the provider was sent. */
  emulated: readonly SearchFilterName[];
  /** Today, for a maximum age. */
  now: Date;
  /** How many queries the call carried: a result count is per query. Default 1. */
  queries?: number;
}

/** The filters `contract` declares emulated. */
export const emulatedIn = (contract: SearchContract): SearchFilterName[] =>
  (Object.entries(contract.filters) as [SearchFilterName, string][]).filter(([, handling]) => handling === "emulated").map(([name]) => name);

/** Search providers bill per request, not per token. */
const NO_TOKENS = { inputTokens: 0, outputTokens: 0 };

/** The pages of `results` (each once, web addresses only) as a search's output, `emulation`'s filters applied. */
export function searchOutputOfResults(results: WebResult[], model: string, emulation?: Emulation): SearchOutput {
  const seen = new Set<string>();
  const kept: Required<Omit<WebResult, "published">>[] = [];
  const sourceDates: Record<string, Date> = {};
  const keeps = emulation ? keeper(emulation) : () => true;
  const most = emulation?.emulated.includes("maxResults") ? resultCountOf(emulation) : undefined;
  for (const result of results) {
    if (most !== undefined && kept.length >= most) break;
    const url = result.url?.trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    const published = parseStatedDate(result.published);
    if (!keeps(url, published)) continue;
    seen.add(url);
    kept.push({ title: result.title?.trim() ?? "", url, snippet: result.snippet?.trim() ?? "" });
    if (published) sourceDates[url] = published;
  }
  return {
    answer: kept.map((r) => [r.title, r.url, r.snippet].filter(Boolean).join("\n")).join("\n\n"),
    sources: kept.map((r) => r.url),
    ...(Object.keys(sourceDates).length ? { sourceDates } : {}),
    model,
    usage: NO_TOKENS,
  };
}

/** Whether a page at `url`, dated `published` when known, keeps to the filters `emulation` applies. */
function keeper({ filters, emulated, now }: Emulation): (url: string, published: Date | undefined) => boolean {
  const included = emulated.includes("includeDomains") ? domainsOf(filters?.includeDomains)?.map(siteOf) : undefined;
  const excluded = emulated.includes("excludeDomains") ? domainsOf(filters?.excludeDomains)?.map(siteOf) : undefined;
  const since = emulated.includes("maxAgeDays") ? sinceDateOf(filters, now) : undefined;
  return (url, published) => {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return false;
    }
    if (included && !included.some((site) => isOnDomain(hostname, site))) return false;
    if (excluded?.some((site) => isOnDomain(hostname, site))) return false;
    // A page with no known date is kept: the freshness rule reads its posting's own date later.
    if (since && published && isoDay(published) < since) return false;
    return true;
  };
}

/** The most results `emulation` keeps: its count per query, times the queries. */
function resultCountOf({ filters, queries = 1 }: Emulation): number | undefined {
  const most = filters?.maxResults;
  return typeof most === "number" && Number.isFinite(most) && most > 0 ? Math.floor(most) * queries : undefined;
}

/** A domain filter's site, as a host name: lower case, without scheme, "www." or path. */
const siteOf = (domain: string) =>
  domain
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!;

/** The non-empty domain list of a filter, or undefined when there is none. */
export function domainsOf(domains: string[] | undefined): string[] | undefined {
  const kept = (domains ?? []).map((d) => d.trim()).filter(Boolean);
  return kept.length ? kept : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first day (YYYY-MM-DD, UTC) of the freshness window, or undefined when there is none. */
export function sinceDateOf(filters: SearchFilters | undefined, now: Date): string | undefined {
  const days = filters?.maxAgeDays;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return undefined;
  return isoDay(new Date(now.getTime() - days * DAY_MS));
}

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The one query of a call to a provider that takes one a call (its contract's `queriesPerCall` of 1). */
export function oneQuery(query: string | readonly string[], provider: string): string {
  const queries = [query].flat();
  if (queries.length !== 1) throw new AiConfigError(`${provider} takes one query a call (got ${queries.length})`);
  return queries[0]!;
}

/** The results to ask for per query: the filter's count, within the provider's `most`. */
export function resultsAsked(filters: SearchFilters | undefined, most: number): number {
  const asked = filters?.maxResults;
  return typeof asked === "number" && Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), most) : most;
}
