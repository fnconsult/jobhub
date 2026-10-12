/**
 * Tavily: web search only (ADR-0007), `POST https://api.tavily.com/search`.
 * A configured model is Tavily's search depth (basic, advanced, fast, ultra-fast).
 */
import type { AiProvider, SearchOutput } from "../types";
import { postJson } from "./http";
import { searchOutputOfResults } from "./web-results";

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string }[];
}

/** The cheapest full search: 1 credit per request. */
const DEFAULT_DEPTH = "basic";
/** Tavily's maximum per request. */
const MAX_RESULTS = 20;

export interface TavilyProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

export function createTavilyProvider(options: TavilyProviderOptions): AiProvider {
  const client = { provider: "tavily" as const, apiKey: options.apiKey, fetch: options.fetch };
  return {
    id: "tavily",
    endpoint: "api.tavily.com",
    residency: "outside_eu",
    async search(query, { model }): Promise<SearchOutput> {
      const depth = model ?? DEFAULT_DEPTH;
      const response = await postJson<TavilyResponse>(client, "https://api.tavily.com/search", {
        query,
        search_depth: depth,
        max_results: MAX_RESULTS,
      });
      const results = (response?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
      return searchOutputOfResults(results, depth);
    },
  };
}
