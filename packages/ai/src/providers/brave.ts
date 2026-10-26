/**
 * Brave Search: a Search provider (ADR-0043), `GET https://api.search.brave.com/res/v1/web/search`.
 * Brave has no domain parameter: included domains become `site:` operators in the query. It has no
 * exclusion either: excluded domains are emulated, dropped from the pages it returns.
 * A country is favoured with `country`; a further page of results is its `offset` (0-9).
 * A result's `page_age` is its date, for the freshness rule (#116).
 */
import type { AiProvider, SearchContract, SearchOutput } from "../types";
import { getJson } from "./http";
import { domainsOf, emulatedIn, isoDay, oneQuery, resultsAsked, searchOutputOfResults, sinceDateOf } from "./web-results";

interface BraveResponse {
  /** `page_age`: when Brave says the page was published, ISO 8601 without an offset (read as UTC). */
  web?: { results?: { title?: string; url?: string; description?: string; page_age?: string }[] };
}

/** Brave's maximum per request. */
const MAX_RESULTS = 20;
/** Brave's offsets go from 0 to 9. */
export const BRAVE_MAX_PAGES = 10;

export interface BraveProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Today, for freshness windows. */
  now?: () => Date;
  /** The most pages one query is given, 1 to 10. Default: 10. */
  maxPages?: number;
}

export function createBraveProvider(options: BraveProviderOptions): AiProvider {
  const now = options.now ?? (() => new Date());
  const maxPages = Math.min(Math.max(Math.floor(options.maxPages ?? BRAVE_MAX_PAGES), 1), BRAVE_MAX_PAGES);
  const contract: SearchContract = {
    queriesPerCall: 1,
    maxPages,
    filters: { includeDomains: "handled", excludeDomains: "emulated", country: "handled", maxAgeDays: "handled", maxResults: "handled" },
  };
  return {
    id: "brave",
    defaultModel: "web",
    // Brave has one web search: nothing else to choose.
    models: ["web"],
    endpoint: "api.search.brave.com",
    residency: "outside_eu",
    searchContract: contract,
    async search(asked, { filters, page = 1, signal }): Promise<SearchOutput> {
      const query = oneQuery(asked, "Brave");
      const today = now();
      const sites = domainsOf(filters?.includeDomains);
      const since = sinceDateOf(filters, today);
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", sites ? `${query} ${sites.map((site) => `site:${site}`).join(" OR ")}` : query);
      url.searchParams.set("count", String(resultsAsked(filters, MAX_RESULTS)));
      if (since) url.searchParams.set("freshness", `${since}to${isoDay(today)}`);
      const country = filters?.country?.trim().toUpperCase();
      if (country) url.searchParams.set("country", country);
      if (page > 1) url.searchParams.set("offset", String(Math.min(page, maxPages) - 1));

      const response = await getJson<BraveResponse>({ provider: "brave", fetch: options.fetch }, url, {
        "x-subscription-token": options.apiKey,
      }, signal);
      const results = (response?.web?.results ?? []).map((r) => ({
        title: plainText(r.title),
        url: r.url,
        snippet: plainText(r.description),
        published: r.page_age,
      }));
      return searchOutputOfResults(results, "web", { filters, emulated: emulatedIn(contract), now: today });
    },
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Brave highlights matches with HTML (`<strong>`); keep the text only. */
function plainText(html: string | undefined): string | undefined {
  return html?.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name]!);
}
