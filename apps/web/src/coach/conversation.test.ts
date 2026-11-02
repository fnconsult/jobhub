import { describe, expect, it } from "vitest";
import { contextBar, estimateTokens } from "./conversation";

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
