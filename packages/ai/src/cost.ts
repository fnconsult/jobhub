/**
 * What an AI call costs, in €: its tokens at the provider's list price, plus the fee of each billed unit its
 * tools used (a Perplexity Search API call, a Brave request, a Tavily credit). An estimate for measuring Job
 * discovery and AI Usage, not a bill: prices in US dollars, converted at the EUR/USD rate in use.
 *
 *   costInEur(call, prices)            its tokens, in € (and, given `sources`, one search call's fee)
 *   toolCostInEur(call, tool, prices)  a tool's billed units, in €; null when its price is not known (« prix inconnu »)
 *   pricesFromEnv(env)                 the prices in use: each billed unit's list price (PRICE_SETTINGS), unless a
 *                                      Platform Setting of the same name overrides it on the Tool's sheet (#403)
 *
 * Token list prices were looked up 2026-10-12 (the Job Search baseline, #97) and 2026-10-14 for Claude and cached
 * input (#127); they stay in code. The billed units' (docs/research/issue-403.md) and the rate are Platform Settings.
 */
import type { ProviderId, TokenUsage } from "./types";

/** US dollars per million tokens. */
interface TokenPrice {
  input: number;
  output: number;
  /** Cached input's price, as a share of `input`. Default CACHE_READ. */
  cacheRead?: number;
}

/** Most providers bill input read from their prompt cache at 10% of the input price. */
const CACHE_READ = 0.1;
/** Anthropic bills input written to its (5-minute) prompt cache at 125% of the input price. */
const CACHE_WRITE = 1.25;

const NO_TOKENS: TokenPrice = { input: 0, output: 0 };

/** Each provider's token price for its default model, and for the other models it is routed to (matched by name). */
const TOKEN_PRICES: Record<ProviderId, { default: TokenPrice; models?: [RegExp, TokenPrice][] }> = {
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
  // Search-only providers (#138, ADR-0043) report no tokens: they bill per unit (UNIT_PRICES).
  perplexity: { default: NO_TOKENS },
  brave: { default: NO_TOKENS },
  tavily: { default: NO_TOKENS },
};

/** What one billed unit is: a call (of 1 to 5 queries, Perplexity), a request (Brave), a credit (Tavily); `rate`: the EUR/USD rate. */
export type BilledUnit = "call" | "request" | "credit" | "rate";

/**
 * A price as a Platform Setting (#403): the Tool it is for (none for the rate), its billed unit, its list price in US
 * dollars (€ per $ for the rate) as the code's default, and where and when that list price was read.
 */
export interface PriceSetting {
  name: string;
  provider: ProviderId | null;
  unit: BilledUnit;
  default: string;
  /** The page the list price was read on. */
  source: string;
  /** When it was read there (YYYY-MM-DD). */
  listedOn: string;
}

const PERPLEXITY_PRICING = "https://docs.perplexity.ai/docs/getting-started/pricing";

/** The prices of the billed units and the EUR/USD rate, in the order the Tools' sheets show them. */
export const PRICE_SETTINGS: readonly PriceSetting[] = [
  // Perplexity's Search API bills each successful call of 1 to 5 queries: $1 / 1,000 in its "fast" search type (the default), $5 in "web".
  { name: "PERPLEXITY_FAST_SEARCH_PRICE_USD", provider: "perplexity", unit: "call", default: "0.001", source: PERPLEXITY_PRICING, listedOn: "2026-10-27" },
  { name: "PERPLEXITY_SEARCH_PRICE_USD", provider: "perplexity", unit: "call", default: "0.005", source: PERPLEXITY_PRICING, listedOn: "2026-10-27" },
  // Brave Search: $5 per 1,000 requests (read in #384; its public page shows no figure).
  { name: "BRAVE_SEARCH_PRICE_USD", provider: "brave", unit: "request", default: "0.005", source: "https://api-dashboard.search.brave.com/documentation/pricing", listedOn: "2026-10-27" },
  // Tavily: $0.008 per credit, pay as you go (subscriptions are cheaper per credit: override it).
  { name: "TAVILY_CREDIT_PRICE_USD", provider: "tavily", unit: "credit", default: "0.008", source: "https://docs.tavily.com/documentation/api-credits", listedOn: "2026-10-27" },
  // An assumption, not a live rate: the ECB's reference rate about the day it was set.
  {
    name: "EUR_PER_USD",
    provider: null,
    unit: "rate",
    default: "0.86",
    source: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html",
    listedOn: "2026-10-12",
  },
];

/** The prices' names: a change to one rebuilds the AI layer, so the next call is recorded at it. */
export const PRICE_SETTING_NAMES: readonly string[] = PRICE_SETTINGS.map((setting) => setting.name);

/**
 * Which price each tool use is billed at, by provider and model (a search type or depth), and how many units
 * one use bills. Perplexity's "web" search type at its own price, any other at the fast one.
 */
const UNIT_PRICES: { provider: ProviderId; tool: string; model?: RegExp; price: string; unitsPerUse?: (model: string) => number }[] = [
  { provider: "perplexity", tool: "web_search", model: /^web$/, price: "PERPLEXITY_SEARCH_PRICE_USD" },
  { provider: "perplexity", tool: "web_search", price: "PERPLEXITY_FAST_SEARCH_PRICE_USD" },
  { provider: "brave", tool: "web_search", price: "BRAVE_SEARCH_PRICE_USD" },
  { provider: "tavily", tool: "web_search", price: "TAVILY_CREDIT_PRICE_USD", unitsPerUse: (depth) => (depth === "advanced" ? 2 : 1) },
];

/** The prices in use: US dollars per billed unit, by price name, and € per US dollar. */
export interface Prices {
  eurPerUsd: number;
  perUnit: Readonly<Record<string, number>>;
}

/** A price as env (or the Back Office over it) holds it: a number of 0 or more, else its list price. */
function priceOf(env: Record<string, string | undefined>, setting: PriceSetting): number {
  const raw = env[setting.name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : Number(setting.default);
}

/** The prices in use: each Platform Setting's value in `env`, else its list price. */
export function pricesFromEnv(env: Record<string, string | undefined>): Prices {
  const perUnit: Record<string, number> = {};
  let eurPerUsd = 0;
  for (const setting of PRICE_SETTINGS) {
    if (setting.unit === "rate") eurPerUsd = priceOf(env, setting);
    else perUnit[setting.name] = priceOf(env, setting);
  }
  return { eurPerUsd, perUnit };
}

/** The list prices: the code's defaults. */
export const LIST_PRICES: Prices = pricesFromEnv({});

/** The default EUR/USD rate, an assumption, not a live rate. */
export const EUR_PER_USD = LIST_PRICES.eurPerUsd;

function tokenPriceOf(provider: ProviderId, model: string): TokenPrice {
  const prices = TOKEN_PRICES[provider];
  return prices.models?.find(([pattern]) => pattern.test(model))?.[1] ?? prices.default;
}

/** One AI call as the AI layer returns it: a text result, or a web search's (it has `sources`). */
export interface PricedCall {
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
  sources?: unknown[];
}

/** The cost in € of one AI call's tokens (a `generate`, `searchWeb` or `searchCompany` result); a web search's adds one call's fee. */
export function costInEur(call: PricedCall, prices: Prices = LIST_PRICES): number {
  const price = tokenPriceOf(call.provider, call.model);
  const { inputTokens, outputTokens, cachedInputTokens = 0, cacheWriteTokens = 0 } = call.usage;
  const input = (inputTokens + cacheWriteTokens * (CACHE_WRITE - 1) + cachedInputTokens * (price.cacheRead ?? CACHE_READ)) * price.input;
  const tokens = ((input + outputTokens * price.output) / 1_000_000) * prices.eurPerUsd;
  const search = call.sources ? (toolCostInEur(call, { name: "web_search", count: 1 }, prices) ?? 0) : 0;
  return tokens + search;
}

/**
 * The fee in € of a tool the model or Search provider used, when its provider bills it apart from tokens: its
 * billed units at the price in use. Null when its price is not known (« prix inconnu »).
 */
export function toolCostInEur(call: { provider: ProviderId; model: string }, tool: { name: string; count: number }, prices: Prices = LIST_PRICES): number | null {
  const unit = UNIT_PRICES.find((candidate) => candidate.provider === call.provider && candidate.tool === tool.name && (candidate.model?.test(call.model) ?? true));
  const perUnit = unit ? prices.perUnit[unit.price] : undefined;
  if (!unit || perUnit === undefined) return null;
  return tool.count * (unit.unitsPerUse?.(call.model) ?? 1) * perUnit * prices.eurPerUsd;
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
