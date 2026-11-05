import { describe, expect, it } from "vitest";
import { contextBar, contextBreakdown, estimateTokens } from "./conversation";

describe("the Context bar (#607): how much of a Coach Conversation the AI Coach reads", () => {
  it("counts its messages out of the 40 the AI Coach reads, and the jetons of its context out of the 12k ceiling", () => {
    expect(contextBar({ messages: 12, tokens: 3_100 })).toEqual({ messages: 12, maxMessages: 40, tokens: 3_100, maxTokens: 12_000, share: 0.3, nearlyFull: false });
  });

  it("fills to whichever is nearer its limit", () => {
    expect(contextBar({ messages: 4, tokens: 9_000 }).share).toBe(0.75);
    expect(contextBar({ messages: 30, tokens: 1_000 }).share).toBe(0.75);
  });

  it("is nearly full from 80 %: then the AI Coach reads only the latest messages", () => {
    expect(contextBar({ messages: 31, tokens: 0 }).nearlyFull).toBe(false);
    expect(contextBar({ messages: 32, tokens: 0 }).nearlyFull).toBe(true);
    expect(contextBar({ messages: 2, tokens: 9_600 }).nearlyFull).toBe(true);
  });

  it("never fills past full, though the conversation has gone on past its limits", () => {
    expect(contextBar({ messages: 52, tokens: 15_000 })).toMatchObject({ messages: 52, tokens: 15_000, share: 1, nearlyFull: true });
  });

  it("counts them out of the Coach context limits of the Candidate's Plan when the server says them (ADR-0078, #731)", () => {
    expect(contextBar({ messages: 12, tokens: 3_000, limits: { coachContextMessages: 20, coachContextTokens: 6_000 } })).toEqual({
      messages: 12,
      maxMessages: 20,
      tokens: 3_000,
      maxTokens: 6_000,
      share: 0.6,
      nearlyFull: false,
    });
  });

  it("fills only to a limit there is: an unlimited one has no maximum and never fills it", () => {
    expect(contextBar({ messages: 300, tokens: 3_000, limits: { coachContextMessages: null, coachContextTokens: 12_000 } })).toMatchObject({ maxMessages: null, share: 0.25 });
    expect(contextBar({ messages: 300, tokens: 90_000, limits: { coachContextMessages: null, coachContextTokens: null } })).toMatchObject({ maxMessages: null, maxTokens: null, share: 0, nearlyFull: false });
  });

  it("is empty for a conversation not yet started", () => {
    expect(contextBar(null)).toMatchObject({ messages: 0, tokens: 0, share: 0, nearlyFull: false });
  });
});

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
