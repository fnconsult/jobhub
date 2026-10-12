/**
 * What an AI call costs, in €: its tokens at the provider's list price, plus
 * the search provider's fee for each web search. An estimate for measuring
 * Job discovery (cost per Job Search), not a bill: list prices in US dollars,
 * looked up 2026-10-12 (the Job Search baseline, #97), converted at EUR_PER_USD.
 */
import type { ProviderId, TokenUsage } from "./types";

/** US dollars per million tokens, and per web search for a search provider. */
interface Price {
  input: number;
  output: number;
  perSearch?: number;
}

/** An assumption, not a live rate. */
export const EUR_PER_USD = 0.86;

/** Each provider's price for its default model, and for the other models it is routed to (matched by name). */
const PRICES: Record<ProviderId, { default: Price; models?: [RegExp, Price][] }> = {
  // Agent API preset "fast" with the web_search tool.
  perplexity: { default: { input: 0.2, output: 1.2, perSearch: 0.0025 } },
  mistral: {
    default: { input: 0.5, output: 1.5 },
    models: [
      [/mistral-small/, { input: 0.1, output: 0.3 }],
      [/mistral-medium/, { input: 0.4, output: 2 }],
    ],
  },
  anthropic: {
    default: { input: 5, output: 25 },
    models: [
      [/haiku/, { input: 1, output: 5 }],
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
  // Linkup prices in €: €5 per 1,000 standard (the default), fast or flash searches, €50 per 1,000 deep ones.
  linkup: {
    default: { input: 0, output: 0, perSearch: 0.005 / EUR_PER_USD },
    models: [[/deep/, { input: 0, output: 0, perSearch: 0.05 / EUR_PER_USD }]],
  },
};

/** One AI call as the AI layer returns it: a text result, or a web search's (it has `sources`). */
export interface PricedCall {
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
  sources?: unknown[];
}

/** The estimated cost in € of one AI call (a `generate`, `searchWeb` or `searchCompany` result). */
export function costInEur(call: PricedCall): number {
  const prices = PRICES[call.provider];
  const price = prices.models?.find(([model]) => model.test(call.model))?.[1] ?? prices.default;
  const tokens = (call.usage.inputTokens * price.input + call.usage.outputTokens * price.output) / 1_000_000;
  const search = call.sources ? (price.perSearch ?? 0) : 0;
  return (tokens + search) * EUR_PER_USD;
}
