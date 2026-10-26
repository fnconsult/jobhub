/**
 * What an AI call costs, in €: its tokens at the provider's list price, plus
 * the search provider's fee for each web search. An estimate for measuring
 * Job discovery (cost per Job Search), not a bill: list prices in US dollars,
 * looked up 2026-10-12 (the Job Search baseline, #97) and 2026-10-14 for Claude
 * and cached input (#127), converted at EUR_PER_USD.
 */
import type { ProviderId, TokenUsage } from "./types";

/** US dollars per million tokens, and per web search for a search provider. */
interface Price {
  input: number;
  output: number;
  perSearch?: number;
  /** Cached input's price, as a share of `input`. Default CACHE_READ. */
  cacheRead?: number;
}

/** Most providers bill input read from their prompt cache at 10% of the input price. */
const CACHE_READ = 0.1;
/** Anthropic bills input written to its (5-minute) prompt cache at 125% of the input price. */
const CACHE_WRITE = 1.25;

/** An assumption, not a live rate. */
export const EUR_PER_USD = 0.86;

/** Each provider's price for its default model, and for the other models it is routed to (matched by name). */
const PRICES: Record<ProviderId, { default: Price; models?: [RegExp, Price][] }> = {
  // Search API (no tokens): $0.001 a call of 1 to 5 queries in its "fast" search type (the default), $0.005 in "web".
  perplexity: { default: { input: 0, output: 0, perSearch: 0.001 }, models: [[/^web$/, { input: 0, output: 0, perSearch: 0.005 }]] },
  mistral: {
    default: { input: 0.5, output: 1.5 },
    models: [
      [/mistral-small/, { input: 0.1, output: 0.3 }],
      [/mistral-medium/, { input: 0.4, output: 2 }],
    ],
  },
  // Default: Opus 5. The 5.5 models read their cache at 5% of the input price.
  anthropic: {
    default: { input: 5, output: 25 },
    models: [
      [/haiku/, { input: 1, output: 5 }],
      [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.05 }],
      [/sonnet-5-5/, { input: 2, output: 10, cacheRead: 0.05 }],
      [/sonnet/, { input: 3, output: 15 }],
    ],
  },
  openai: {
    default: { input: 1.25, output: 10 },
    models: [
      [/gpt-5[\w.-]*-nano/, { input: 0.05, output: 0.4 }],
      [/gpt-5[\w.-]*-mini/, { input: 0.25, output: 2 }],
    ],
  },
  // Search-only providers (#138) report no tokens: they bill per request, and their model is the search depth.
  // Brave Search: $5 per 1,000 requests.
  brave: { default: { input: 0, output: 0, perSearch: 0.005 } },
  // Tavily: $0.008 per credit; basic (the default), fast and ultra-fast cost 1 credit, advanced 2.
  tavily: {
    default: { input: 0, output: 0, perSearch: 0.008 },
    models: [[/advanced/, { input: 0, output: 0, perSearch: 0.016 }]],
  },
};

function priceOf(provider: ProviderId, model: string): Price {
  const prices = PRICES[provider];
  return prices.models?.find(([pattern]) => pattern.test(model))?.[1] ?? prices.default;
}

/** One AI call as the AI layer returns it: a text result, or a web search's (it has `sources`). */
export interface PricedCall {
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
  sources?: unknown[];
}

/** The estimated cost in € of one AI call (a `generate`, `searchWeb` or `searchCompany` result). */
export function costInEur(call: PricedCall): number {
  const price = priceOf(call.provider, call.model);
  const { inputTokens, outputTokens, cachedInputTokens = 0, cacheWriteTokens = 0 } = call.usage;
  const input = (inputTokens + cacheWriteTokens * (CACHE_WRITE - 1) + cachedInputTokens * (price.cacheRead ?? CACHE_READ)) * price.input;
  const tokens = (input + outputTokens * price.output) / 1_000_000;
  const search = call.sources ? (price.perSearch ?? 0) : 0;
  return (tokens + search) * EUR_PER_USD;
}

/**
 * The estimated fee in € of a tool the model used, when its provider bills it apart from tokens:
 * a web search, per search. Null when the fee is not known.
 */
export function toolCostInEur(call: { provider: ProviderId; model: string }, tool: { name: string; count: number }): number | null {
  if (tool.name !== "web_search") return null;
  const perSearch = priceOf(call.provider, call.model).perSearch;
  return perSearch === undefined ? null : perSearch * tool.count * EUR_PER_USD;
}

/**
 * Contact enrichment (#23): US dollars per credit, and the credits each operation spends when it
 * answers 2xx (matched on the end of its path). An estimate: none of the three publishes an API
 * per-credit price, so these are effective list rates as third-party trackers read them, looked up
 * 2026-10-18 (#218): Lusha's Pro plan, about $0.115 a credit (emelia.io/software/lusha/pricing);
 * Kaspr's add-on credit, about $0.36 (fullenrich.com/content/kaspr-pricing); Apollo's overage
 * credit, $0.20 (salesgear.io/blog/apollo-pricing). Credits per call from docs/research/issue-23.md:
 * a Lusha search spends 1 credit per page of up to 25 results, a reveal 1; Apollo's people search
 * spends none, a match 1; Kaspr's LinkedIn profile 1. Nothing found (404) or refused costs nothing.
 */
const ENRICHMENT_PRICES: Record<string, { perCredit: number; operations: [RegExp, number][] }> = {
  lusha: { perCredit: 0.115, operations: [[/\/contacts\/prospecting$/, 1], [/\/contacts\/enrich$/, 1]] },
  kaspr: { perCredit: 0.36, operations: [[/\/profile\/linkedin$/, 1]] },
  apollo: { perCredit: 0.2, operations: [[/\/mixed_people\/api_search$/, 0], [/\/people\/match$/, 1]] },
};

/** The estimated cost in € of a contact enrichment call to `operation` ("POST /v3/contacts/enrich") that answered `status`; null when not known. */
export function enrichmentCostInEur(provider: string, operation: string, status: number | null): number | null {
  const prices = ENRICHMENT_PRICES[provider];
  const credits = prices?.operations.find(([path]) => path.test(operation))?.[1];
  if (credits === undefined) return null;
  const answered = status !== null && status >= 200 && status < 300;
  return answered ? credits * prices!.perCredit * EUR_PER_USD : 0;
}
