/**
 * Linkup: web search only (ADR-0007), `POST https://api.linkup.so/v1/search` for search results
 * (no written answer). A configured model is Linkup's depth (fast, standard, deep, flash).
 */
import type { AiProvider, SearchOutput } from "../types";
import { postJson } from "./http";
import { domainsOf, searchOutputOfResults, sinceDateOf } from "./web-results";

interface LinkupResponse {
  results?: { type?: string; name?: string; url?: string; content?: string }[];
}

const DEFAULT_DEPTH = "standard";
/** The depths a task Playbook may choose (ADR-0026), the default first. */
const DEPTHS = [DEFAULT_DEPTH, "fast", "deep", "flash"];
const MAX_RESULTS = 20;

export interface LinkupProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Today, for freshness windows. */
  now?: () => Date;
}

export function createLinkupProvider(options: LinkupProviderOptions): AiProvider {
  const client = { provider: "linkup" as const, apiKey: options.apiKey, fetch: options.fetch };
  const now = options.now ?? (() => new Date());
  return {
    id: "linkup",
    defaultModel: DEFAULT_DEPTH,
    models: DEPTHS,
    endpoint: "api.linkup.so",
    residency: "outside_eu",
    async search(query, { model, filters }): Promise<SearchOutput> {
      const depth = model ?? DEFAULT_DEPTH;
      const includeDomains = domainsOf(filters?.includeDomains);
      const excludeDomains = domainsOf(filters?.excludeDomains);
      const since = sinceDateOf(filters, now());
      const response = await postJson<LinkupResponse>(client, "https://api.linkup.so/v1/search", {
        q: query,
        depth,
        outputType: "searchResults",
        maxResults: MAX_RESULTS,
        ...(includeDomains ? { includeDomains } : {}),
        ...(excludeDomains ? { excludeDomains } : {}),
        ...(since ? { fromDate: since } : {}),
      });
      const results = (response?.results ?? [])
        .filter((r) => r.type === "text")
        .map((r) => ({ title: r.name, url: r.url, snippet: r.content }));
      return searchOutputOfResults(results, depth);
    },
  };
}
