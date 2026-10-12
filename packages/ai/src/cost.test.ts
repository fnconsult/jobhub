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
    expect(costInEur({ provider: "anthropic", model: "anthropic.claude-opus-5-5", usage: usage(1_000_000, 0) })).toBeCloseTo(4.3, 6);
    expect(costInEur({ provider: "anthropic", model: "claude-haiku-4-5", usage: usage(1_000_000, 0) })).toBeCloseTo(0.86, 6);
    expect(costInEur({ provider: "anthropic", model: "fake-anthropic", usage: usage(1_000_000, 0) })).toBeCloseTo(4.3, 6);
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
