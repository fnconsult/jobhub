import { describe, expect, it } from "vitest";
import { estimateTokens } from "./conversation";

describe("the estimate of a text's tokens: about 4 characters each", () => {
  it("is the one the AI Coach's context is fitted with", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
