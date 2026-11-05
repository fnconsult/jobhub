import { describe, expect, it } from "vitest";
import { contextBar, contextBreakdown, estimateTokens } from "./conversation";

describe("the estimate of a text's tokens: about 4 characters each", () => {
  it("is the one the AI Coach's context is fitted with", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("the Context bar's breakdown card (ADR-0078, #732)", () => {
  const split = { messages: 1_200, instructions: 1_500, profile: 800, advice: 300, sources: 200 };

  it("lists each category then the room left, out of the Plan's ceiling, the categories adding up to the bar's jetons", () => {
    const breakdown = contextBreakdown({ messages: 6, tokens: 4_000, limits: { coachContextMessages: 40, coachContextTokens: 10_000 }, split })!;
    expect(breakdown.lines.map(({ category, tokens }) => [category, tokens])).toEqual([
      ["messages", 1_200],
      ["instructions", 1_500],
      ["profile", 800],
      ["advice", 300],
      ["sources", 200],
      ["free", 6_000],
    ]);
    expect(breakdown.lines.filter((line) => line.category !== "free").reduce((sum, line) => sum + line.tokens, 0)).toBe(contextBar({ messages: 6, tokens: 4_000 }).tokens);
    expect(breakdown.lines.map((line) => line.share)).toEqual([0.12, 0.15, 0.08, 0.03, 0.02, 0.6]);
    expect(breakdown).toMatchObject({ total: 10_000, tokens: 4_000, maxTokens: 10_000 });
  });

  it("gives what rounding left to « Instructions du coach », so the sum is the bar's figure", () => {
    const breakdown = contextBreakdown({ messages: 6, tokens: 4_003, split })!;
    expect(breakdown.lines.find((line) => line.category === "instructions")!.tokens).toBe(1_503);
    expect(breakdown.tokens).toBe(4_003);
  });

  it("has no room left when the Plan sets no ceiling: the context itself is the total", () => {
    const breakdown = contextBreakdown({ messages: 6, tokens: 4_000, limits: { coachContextMessages: null, coachContextTokens: null }, split })!;
    expect(breakdown.lines.map((line) => line.category)).not.toContain("free");
    expect(breakdown).toMatchObject({ total: 4_000, maxTokens: null });
  });

  it("is empty before the first reply, after « Effacer », and for a reply saved without a split", () => {
    expect(contextBreakdown(null)).toBeNull();
    expect(contextBreakdown({ messages: 2, tokens: 3_000, split: null })).toBeNull();
    expect(contextBreakdown({ messages: 2, tokens: 3_000 })).toBeNull();
  });
});
