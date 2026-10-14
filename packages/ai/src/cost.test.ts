import { describe, expect, it } from "vitest";
import { costInEur } from "./cost";
import { PROVIDER_IDS } from "./types";

const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens });

describe("the cost in € of an AI call", () => {
  it("prices a text call's tokens at its provider's list price", () => {
    // Mistral Large: $0.50 / $1.50 per million tokens, at €0.86 per $.
    expect(costInEur({ provider: "mistral", model: "mistral-large-latest", usage: usage(1_000_000, 1_000_000) })).toBeCloseTo(1.72, 6);
  });

  it("adds the search provider's fee per web search to its tokens", () => {
    // Perplexity: $0.0025 per search, $0.20 / $1.20 per million tokens.
    const search = { provider: "perplexity" as const, model: "openai/gpt-5.6-luna", usage: usage(1_000, 500), sources: [], answer: "" };
    expect(costInEur(search)).toBeCloseTo((0.0025 + 0.0002 + 0.0006) * 0.86, 9);
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
    const search = (provider: "brave" | "tavily" | "linkup", model: string) => costInEur({ provider, model, usage: usage(0, 0), sources: [] });
    // Brave Search: $5 per 1,000 requests.
    expect(search("brave", "web")).toBeCloseTo(0.005 * 0.86, 9);
    // Tavily: $0.008 per credit; a basic search is 1 credit, an advanced one 2.
    expect(search("tavily", "basic")).toBeCloseTo(0.008 * 0.86, 9);
    expect(search("tavily", "advanced")).toBeCloseTo(0.016 * 0.86, 9);
    // Linkup: €5 per 1,000 standard searches, €50 per 1,000 deep ones.
    expect(search("linkup", "standard")).toBeCloseTo(0.005, 9);
    expect(search("linkup", "deep")).toBeCloseTo(0.05, 9);
  });

  it.each(PROVIDER_IDS)("prices a web search by %s without throwing", (provider) => {
    const cost = costInEur({ provider, model: "any-model", usage: usage(1_000, 500), sources: [] });
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});
