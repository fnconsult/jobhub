/**
 * Brave Search: web search only (ADR-0007), `GET https://api.search.brave.com/res/v1/web/search`.
 * Brave has no domain parameter: included domains become `site:` operators in the query.
 * It has no exclusion either, so excluded domains are not applied (callers check results anyway).
 * A country is favoured with `country`; a further page of results is its `offset` (0-9).
 */
import type { AiProvider, SearchOutput } from "../types";
import { getJson } from "./http";
import { domainsOf, isoDay, searchOutputOfResults, sinceDateOf } from "./web-results";

interface BraveResponse {
  web?: { results?: { title?: string; url?: string; description?: string }[] };
}

/** Brave's maximum per request. */
const MAX_RESULTS = 20;
/** Brave's offsets go from 0 to 9. */
const PAGES = 10;

export interface BraveProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Today, for freshness windows. */
  now?: () => Date;
}

export function createBraveProvider(options: BraveProviderOptions): AiProvider {
  const now = options.now ?? (() => new Date());
  return {
    id: "brave",
    endpoint: "api.search.brave.com",
    residency: "outside_eu",
    searchPages: PAGES,
    async search(query, { filters, page = 1 }): Promise<SearchOutput> {
      const today = now();
      const sites = domainsOf(filters?.includeDomains);
      const since = sinceDateOf(filters, today);
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", sites ? `${query} ${sites.map((site) => `site:${site}`).join(" OR ")}` : query);
      url.searchParams.set("count", String(MAX_RESULTS));
      if (since) url.searchParams.set("freshness", `${since}to${isoDay(today)}`);
      const country = filters?.country?.trim().toUpperCase();
      if (country) url.searchParams.set("country", country);
      if (page > 1) url.searchParams.set("offset", String(Math.min(page, PAGES) - 1));

      const response = await getJson<BraveResponse>({ provider: "brave", fetch: options.fetch }, url, {
        "x-subscription-token": options.apiKey,
      });
      const results = (response?.web?.results ?? []).map((r) => ({ title: plainText(r.title), url: r.url, snippet: plainText(r.description) }));
      return searchOutputOfResults(results, "web");
    },
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Brave highlights matches with HTML (`<strong>`); keep the text only. */
function plainText(html: string | undefined): string | undefined {
  return html?.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name]!);
}
