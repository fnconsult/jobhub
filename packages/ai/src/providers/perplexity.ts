/**
 * Perplexity: a Search provider (ADR-0043), through its Search API (`POST https://api.perplexity.ai/search`):
 * pages for up to 5 queries a call, billed as one search, no LLM and no tokens. Its filters
 * (docs/research/issue-398.md): a domain allowlist or denylist (never both: with both, the allowlist is
 * sent and the excluded domains are dropped from the pages returned), a recency window, a country code
 * and a result count. It has no offset: one page per query.
 */
import { AiConfigError } from "../errors";
import type { AiProvider, SearchContract, SearchFilters, SearchOutput } from "../types";
import { postJson } from "./http";
import { domainsOf, resultsAsked, searchOutputOfResults, type WebResult } from "./web-results";

/** One page of results. `date`: when it was published; `last_updated`: when it last changed (YYYY-MM-DD, either may be null). */
interface SearchApiResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string | null;
  last_updated?: string | null;
}

/** The parts of a Search API response a search needs: flat, or grouped per query (several queries' shape is not documented). */
interface SearchApiResponse {
  results?: (SearchApiResult | SearchApiResult[])[];
}

/** Perplexity's search types, the cheapest first: what a route's model names. */
export const PERPLEXITY_SEARCH_TYPES = ["fast", "web"] as const;
export type PerplexitySearchType = (typeof PERPLEXITY_SEARCH_TYPES)[number];
/** The most queries one call takes. */
export const PERPLEXITY_MAX_QUERIES = 5;
/** Its most results per query (more only for people searches). */
const MAX_RESULTS = 20;
/** Its most entries in a domain filter. */
const MAX_DOMAINS = 20;
/** Its recency windows, narrowest first, with their length in days. */
const RECENCY: [days: number, window: string][] = [
  [1, "day"],
  [7, "week"],
  [31, "month"],
  [366, "year"],
];

export interface PerplexityProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** The search type a route naming none gets. Default: fast. */
  searchType?: PerplexitySearchType;
  /** Queries per call, 1 to 5. Default: 5. */
  queriesPerCall?: number;
  /** Today. Default: the clock. */
  now?: () => Date;
}

export function createPerplexityProvider(options: PerplexityProviderOptions): AiProvider {
  const client = { provider: "perplexity" as const, apiKey: options.apiKey, fetch: options.fetch };
  const searchType = options.searchType ?? "fast";
  const queriesPerCall = Math.min(Math.max(Math.floor(options.queriesPerCall ?? PERPLEXITY_MAX_QUERIES), 1), PERPLEXITY_MAX_QUERIES);
  const now = options.now ?? (() => new Date());
  const contract: SearchContract = {
    queriesPerCall,
    maxPages: 1,
    filters: { includeDomains: "handled", excludeDomains: "handled", country: "handled", maxAgeDays: "handled", maxResults: "handled" },
  };
  return {
    id: "perplexity",
    defaultModel: searchType,
    models: [searchType, ...PERPLEXITY_SEARCH_TYPES.filter((type) => type !== searchType)],
    endpoint: "api.perplexity.ai",
    residency: "outside_eu",
    searchContract: contract,
    async search(query, { model, filters, signal }): Promise<SearchOutput> {
      const queries = [query].flat();
      if (queries.length > queriesPerCall) throw new AiConfigError(`Perplexity takes at most ${queriesPerCall} queries per call (got ${queries.length})`);
      const type = model ?? searchType;
      const included = domainsOf(filters?.includeDomains);
      const response = await postJson<SearchApiResponse>(client, "https://api.perplexity.ai/search", {
        query: queries.length === 1 ? queries[0] : queries,
        search_type: type,
        max_results: resultsAsked(filters, MAX_RESULTS),
        ...filterFields(filters),
      }, signal);
      const results: WebResult[] = (response?.results ?? []).flat().map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        // The last update is a weaker date (CONTEXT.md, Posting date): a page cannot have been published after it.
        published: r.date ?? r.last_updated,
      }));
      // With included domains sent, the excluded ones could not be: they are dropped here.
      const emulation = included && domainsOf(filters?.excludeDomains) ? { filters, emulated: ["excludeDomains" as const], now: now() } : undefined;
      return { ...searchOutputOfResults(results, type, emulation), tools: [{ name: "web_search", count: 1 }] };
    },
  };
}

/** The Search API's own filter fields for `filters`. */
function filterFields(filters: SearchFilters | undefined): Record<string, unknown> {
  // An allowlist or a denylist, never both: the narrower allowlist wins.
  const domains = domainsOf(filters?.includeDomains) ?? domainsOf(filters?.excludeDomains)?.map((domain) => `-${domain}`);
  const days = filters?.maxAgeDays;
  const recency = typeof days === "number" && days > 0 ? RECENCY.find(([within]) => days <= within)?.[1] : undefined;
  const country = filters?.country?.trim().toUpperCase();
  return {
    ...(domains ? { search_domain_filter: domains.slice(0, MAX_DOMAINS) } : {}),
    ...(recency ? { search_recency_filter: recency } : {}),
    ...(country ? { country } : {}),
  };
}
