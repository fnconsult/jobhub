/**
 * Tavily: a Search provider (ADR-0043), `POST https://api.tavily.com/search`.
 * A route's model, else its depth setting, is Tavily's search depth (basic, advanced, fast, ultra-fast).
 * Every filter is its own: domains to include and exclude, a start date, a result count, and a country
 * it favours (a boost, not a restriction) by its lowercase English name, for general searches only.
 */
import type { AiProvider, SearchContract, SearchOutput } from "../types";
import { postJson } from "./http";
import { domainsOf, oneQuery, resultsAsked, searchOutputOfResults, sinceDateOf } from "./web-results";

interface TavilyResponse {
  /** `published_date`: asked for with `include_published_date`; ISO or RFC 1123, null when unknown; may be a last update. */
  results?: { title?: string; url?: string; content?: string; published_date?: string | null }[];
}

/** The cheapest full search: 1 credit per request. */
const DEFAULT_DEPTH = "basic";
/** The depths a route or its setting may choose (ADR-0026), the default first. */
export const TAVILY_DEPTHS = [DEFAULT_DEPTH, "advanced", "fast", "ultra-fast"] as const;
export type TavilyDepth = (typeof TAVILY_DEPTHS)[number];
/** Tavily's maximum per request. */
const MAX_RESULTS = 20;

/**
 * Tavily's names (from its fixed list) of the countries a search may favour, by ISO 3166-1 alpha-2 code.
 * A country missing here is not sent: Tavily refuses a name outside its list.
 */
const COUNTRY_NAMES: Record<string, string> = {
  AT: "austria",
  BE: "belgium",
  BG: "bulgaria",
  CA: "canada",
  CH: "switzerland",
  CY: "cyprus",
  CZ: "czech republic",
  DE: "germany",
  DK: "denmark",
  DZ: "algeria",
  EE: "estonia",
  ES: "spain",
  FI: "finland",
  FR: "france",
  GB: "united kingdom",
  GR: "greece",
  HR: "croatia",
  HU: "hungary",
  IE: "ireland",
  IT: "italy",
  LT: "lithuania",
  LU: "luxembourg",
  LV: "latvia",
  MA: "morocco",
  MC: "monaco",
  MT: "malta",
  NL: "netherlands",
  NO: "norway",
  PL: "poland",
  PT: "portugal",
  RO: "romania",
  SE: "sweden",
  SI: "slovenia",
  SK: "slovakia",
  SN: "senegal",
  TN: "tunisia",
  US: "united states",
};

export interface TavilyProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Today, for freshness windows. */
  now?: () => Date;
  /** The depth a route naming none gets. Default: basic. */
  depth?: TavilyDepth;
}

export function createTavilyProvider(options: TavilyProviderOptions): AiProvider {
  const client = { provider: "tavily" as const, apiKey: options.apiKey, fetch: options.fetch };
  const now = options.now ?? (() => new Date());
  const defaultDepth = options.depth ?? DEFAULT_DEPTH;
  const contract: SearchContract = {
    queriesPerCall: 1,
    maxPages: 1,
    filters: { includeDomains: "handled", excludeDomains: "handled", country: "handled", maxAgeDays: "handled", maxResults: "handled" },
  };
  return {
    id: "tavily",
    defaultModel: defaultDepth,
    models: [defaultDepth, ...TAVILY_DEPTHS.filter((depth) => depth !== defaultDepth)],
    endpoint: "api.tavily.com",
    residency: "outside_eu",
    searchContract: contract,
    async search(asked, { model, filters, signal }): Promise<SearchOutput> {
      const query = oneQuery(asked, "Tavily");
      const depth = model ?? defaultDepth;
      const includeDomains = domainsOf(filters?.includeDomains);
      const excludeDomains = domainsOf(filters?.excludeDomains);
      const since = sinceDateOf(filters, now());
      const country = COUNTRY_NAMES[filters?.country?.trim().toUpperCase() ?? ""];
      const response = await postJson<TavilyResponse>(client, "https://api.tavily.com/search", {
        query,
        search_depth: depth,
        max_results: resultsAsked(filters, MAX_RESULTS),
        // Each result's date, for the freshness rule (#116). Undated pages stay: never `filter_by_published_date`.
        include_published_date: true,
        ...(includeDomains ? { include_domains: includeDomains } : {}),
        ...(excludeDomains ? { exclude_domains: excludeDomains } : {}),
        ...(since ? { start_date: since } : {}),
        // Tavily favours a country only in its general topic.
        ...(country ? { topic: "general", country } : {}),
      }, signal);
      const results = (response?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, published: r.published_date }));
      return searchOutputOfResults(results, depth);
    },
  };
}
