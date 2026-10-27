import { describe, expect, it } from "vitest";
import { costInEur, enrichmentCostInEur, LIST_PRICES, PRICE_SETTINGS, pricesFromEnv, toolCostInEur } from "./cost";
import { PROVIDER_IDS } from "./types";

const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens });

describe("the cost in € of an AI call", () => {
  it("prices a text call's tokens at its provider's list price", () => {
    // Mistral Large: $0.50 / $1.50 per million tokens, at €0.86 per $.
    expect(costInEur({ provider: "mistral", model: "mistral-large-latest", usage: usage(1_000_000, 1_000_000) })).toBeCloseTo(1.72, 6);
  });

  it("prices a Perplexity search by its search type, with no tokens: $0.001 fast, $0.005 web, a call of 1 to 5 queries", () => {
    const search = (model: string) => costInEur({ provider: "perplexity", model, usage: usage(0, 0), sources: [] });
    expect(search("fast")).toBeCloseTo(0.001 * 0.86, 9);
    expect(search("web")).toBeCloseTo(0.005 * 0.86, 9);
  });

  it("prices a known model at its own rate, any other at its provider's default", () => {
    // Opus 5.5: $4 / $20 per million tokens; Sonnet 5.5: $2 / $10 (list prices checked 2026-10-14, #127).
    expect(costInEur({ provider: "anthropic", model: "anthropic.claude-opus-5-5", usage: usage(1_000_000, 1_000_000) })).toBeCloseTo(24 * 0.86, 6);
    expect(costInEur({ provider: "anthropic", model: "claude-sonnet-5-5", usage: usage(1_000_000, 1_000_000) })).toBeCloseTo(12 * 0.86, 6);
    expect(costInEur({ provider: "anthropic", model: "claude-sonnet-4-6", usage: usage(1_000_000, 1_000_000) })).toBeCloseTo(18 * 0.86, 6);
    expect(costInEur({ provider: "anthropic", model: "claude-haiku-4-5", usage: usage(1_000_000, 0) })).toBeCloseTo(0.86, 6);
    expect(costInEur({ provider: "anthropic", model: "fake-anthropic", usage: usage(1_000_000, 0) })).toBeCloseTo(4.3, 6);
  });

  it("prices input read from the provider's cache at its cache-read rate, and input written to it at the cache-write rate", () => {
    // Opus 5 ($5 input): cache reads at 0.1x, 5-minute cache writes at 1.25x.
    const opus5 = { provider: "anthropic" as const, model: "claude-opus-5" };
    expect(costInEur({ ...opus5, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 1_000_000 } })).toBeCloseTo(0.5 * 0.86, 6);
    // 1M input tokens, all of them written to the cache: $5 x 1.25.
    expect(costInEur({ ...opus5, usage: { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000 } })).toBeCloseTo(6.25 * 0.86, 6);
    // Opus 5.5 and Sonnet 5.5 read the cache at 0.05x.
    expect(costInEur({ provider: "anthropic", model: "claude-opus-5-5", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 1_000_000 } })).toBeCloseTo(
      0.2 * 0.86,
      6,
    );
    // Mistral bills cached input at 10% of its input price.
    expect(costInEur({ provider: "mistral", model: "mistral-large-latest", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 1_000_000 } })).toBeCloseTo(
      0.05 * 0.86,
      6,
    );
  });

  it("costs nothing without tokens or searches", () => {
    expect(costInEur({ provider: "openai", model: "gpt-5", usage: usage(0, 0) })).toBe(0);
  });

  it("prices a search-only provider's web search at its fee per request, whatever its depth", () => {
    // Search-only providers report no tokens: they bill per request.
    const search = (provider: "brave" | "tavily", model: string) => costInEur({ provider, model, usage: usage(0, 0), sources: [] });
    // Brave Search: $5 per 1,000 requests.
    expect(search("brave", "web")).toBeCloseTo(0.005 * 0.86, 9);
    // Tavily: $0.008 per credit; a basic search is 1 credit, an advanced one 2.
    expect(search("tavily", "basic")).toBeCloseTo(0.008 * 0.86, 9);
    expect(search("tavily", "advanced")).toBeCloseTo(0.016 * 0.86, 9);
  });

  it.each(PROVIDER_IDS)("prices a web search by %s without throwing", (provider) => {
    const cost = costInEur({ provider, model: "any-model", usage: usage(1_000, 500), sources: [] });
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});

describe("one recorded cost per billed unit, at the price in use (#403)", () => {
  const webSearch = (count = 1) => ({ name: "web_search", count });

  it("prices each billed unit at its list price by default: a Perplexity call, a Brave request, a Tavily credit", () => {
    expect(toolCostInEur({ provider: "perplexity", model: "fast" }, webSearch())).toBeCloseTo(0.001 * 0.86, 12);
    expect(toolCostInEur({ provider: "perplexity", model: "web" }, webSearch())).toBeCloseTo(0.005 * 0.86, 12);
    expect(toolCostInEur({ provider: "brave", model: "web" }, webSearch(3))).toBeCloseTo(3 * 0.005 * 0.86, 12);
    // Tavily bills credits: basic, fast and ultra-fast 1 a search, advanced 2.
    expect(toolCostInEur({ provider: "tavily", model: "basic" }, webSearch())).toBeCloseTo(0.008 * 0.86, 12);
    expect(toolCostInEur({ provider: "tavily", model: "advanced" }, webSearch(2))).toBeCloseTo(2 * 2 * 0.008 * 0.86, 12);
  });

  it("prices a unit at the price overriding its list price, converted at the EUR/USD rate in use", () => {
    const prices = pricesFromEnv({ PERPLEXITY_FAST_SEARCH_PRICE_USD: "0.004", EUR_PER_USD: "0.9" });

    expect(toolCostInEur({ provider: "perplexity", model: "fast" }, webSearch(), prices)).toBeCloseTo(0.004 * 0.9, 12);
    // The other prices keep their list price, at the rate in use.
    expect(toolCostInEur({ provider: "perplexity", model: "web" }, webSearch(), prices)).toBeCloseTo(0.005 * 0.9, 12);
    expect(costInEur({ provider: "mistral", model: "mistral-large-latest", usage: usage(1_000_000, 0) }, prices)).toBeCloseTo(0.5 * 0.9, 9);
  });

  it("keeps the list price for a value that is not a price (empty, not a number, negative)", () => {
    for (const value of ["", "abc", "-1"]) {
      expect(toolCostInEur({ provider: "brave", model: "web" }, webSearch(), pricesFromEnv({ BRAVE_SEARCH_PRICE_USD: value }))).toBeCloseTo(0.005 * 0.86, 12);
    }
  });

  it("has no price for a billed tool it does not know: null, « prix inconnu »", () => {
    expect(toolCostInEur({ provider: "anthropic", model: "claude-opus-5" }, webSearch())).toBeNull();
    expect(toolCostInEur({ provider: "perplexity", model: "fast" }, { name: "fetch_url", count: 1 })).toBeNull();
  });

  it("says each price's Tool, billed unit, list price, source and date", () => {
    expect(PRICE_SETTINGS.map(({ name, provider, unit, default: value }) => [name, provider, unit, value])).toEqual([
      ["PERPLEXITY_FAST_SEARCH_PRICE_USD", "perplexity", "call", "0.001"],
      ["PERPLEXITY_SEARCH_PRICE_USD", "perplexity", "call", "0.005"],
      ["BRAVE_SEARCH_PRICE_USD", "brave", "request", "0.005"],
      ["TAVILY_CREDIT_PRICE_USD", "tavily", "credit", "0.008"],
      ["EUR_PER_USD", null, "rate", "0.86"],
    ]);
    for (const setting of PRICE_SETTINGS) {
      expect(setting.source).toMatch(/^https:\/\//);
      expect(setting.listedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(pricesFromEnv({})).toEqual(LIST_PRICES);
  });
});

describe("what a contact enrichment call costs (#218)", () => {
  it("prices a call that spends credits at the provider's credit price, in €", () => {
    // Lusha: 1 credit at $0.115; Kaspr: 1 credit at $0.36; Apollo: 1 credit at $0.20.
    expect(enrichmentCostInEur("lusha", "POST /v3/contacts/prospecting", 200)).toBeCloseTo(0.115 * 0.86, 9);
    expect(enrichmentCostInEur("lusha", "POST /v3/contacts/enrich", 201)).toBeCloseTo(0.115 * 0.86, 9);
    expect(enrichmentCostInEur("kaspr", "POST /profile/linkedin", 200)).toBeCloseTo(0.36 * 0.86, 9);
    expect(enrichmentCostInEur("apollo", "POST /api/v1/people/match", 200)).toBeCloseTo(0.2 * 0.86, 9);
  });

  it("costs nothing for a search that spends no credit, nothing found, or a refused call", () => {
    expect(enrichmentCostInEur("apollo", "POST /api/v1/mixed_people/api_search", 200)).toBe(0);
    expect(enrichmentCostInEur("lusha", "POST /v3/contacts/enrich", 404)).toBe(0);
    expect(enrichmentCostInEur("kaspr", "POST /profile/linkedin", 402)).toBe(0);
    expect(enrichmentCostInEur("apollo", "POST /api/v1/people/match", null)).toBe(0);
  });

  it("does not know the cost of another provider or operation", () => {
    expect(enrichmentCostInEur("apollo", "GET /api/v1/auth/health", 200)).toBeNull();
    expect(enrichmentCostInEur("clearbit", "POST /v2/people", 200)).toBeNull();
  });
});
