/**
 * Tavily: web search only (ADR-0007), `POST https://api.tavily.com/search`.
 * A configured model is Tavily's search depth (basic, advanced, fast, ultra-fast).
 */
import type { AiProvider, SearchOutput } from "../types";
import { postJson } from "./http";
import { domainsOf, searchOutputOfResults, sinceDateOf } from "./web-results";

interface TavilyResponse {
  /** `published_date`: asked for with `include_published_date`; ISO or RFC 1123, null when unknown; may be a last update. */
  results?: { title?: string; url?: string; content?: string; published_date?: string | null }[];
}

/** The cheapest full search: 1 credit per request. */
const DEFAULT_DEPTH = "basic";
/** Tavily's maximum per request. */
const MAX_RESULTS = 20;

export interface TavilyProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Today, for freshness windows. */
  now?: () => Date;
}

export function createTavilyProvider(options: TavilyProviderOptions): AiProvider {
  const client = { provider: "tavily" as const, apiKey: options.apiKey, fetch: options.fetch };
  const now = options.now ?? (() => new Date());
  return {
    id: "tavily",
    defaultModel: DEFAULT_DEPTH,
    endpoint: "api.tavily.com",
    residency: "outside_eu",
    async search(query, { model, filters }): Promise<SearchOutput> {
      const depth = model ?? DEFAULT_DEPTH;
      const includeDomains = domainsOf(filters?.includeDomains);
      const excludeDomains = domainsOf(filters?.excludeDomains);
      const since = sinceDateOf(filters, now());
      const response = await postJson<TavilyResponse>(client, "https://api.tavily.com/search", {
        query,
        search_depth: depth,
        max_results: MAX_RESULTS,
        // Each result's date, for the freshness rule (#116). Undated pages stay: never `filter_by_published_date`.
        include_published_date: true,
        ...(includeDomains ? { include_domains: includeDomains } : {}),
        ...(excludeDomains ? { exclude_domains: excludeDomains } : {}),
        ...(since ? { start_date: since } : {}),
      });
      const results = (response?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, published: r.published_date }));
      return searchOutputOfResults(results, depth);
    },
  };
}
