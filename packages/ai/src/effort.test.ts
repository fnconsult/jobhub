import { describe, expect, it } from "vitest";
import { EFFORTS, effortHandling } from "./effort";

describe("how a model handles the effort a Playbook Agent asks for (low, medium, high)", () => {
  it("offers three levels", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high"]);
  });

  it.each([
    ["anthropic", "claude-opus-5-5"],
    ["anthropic", "anthropic.claude-opus-5-5"],
    ["anthropic", "claude-sonnet-5-5"],
    ["anthropic", "claude-sonnet-4-6"],
    ["anthropic", "claude-haiku-5-5"],
    ["anthropic", "claude-opus-4-5"],
    ["openai", "gpt-5"],
    ["openai", "gpt-5-mini"],
    ["openai", "o4-mini"],
  ] as const)("%s %s takes low, medium and high as they are", (provider, model) => {
    expect(effortHandling(provider, model)).toBe("native");
  });

  it.each([
    ["mistral", "mistral-medium-3-5"],
    ["mistral", "mistral-small-latest"],
    ["mistral", "mistral-large-4-0"],
  ] as const)("Mistral's %s %s only has none and high: low is none, medium is high", (provider, model) => {
    expect(effortHandling(provider, model)).toBe("medium_as_high");
  });

  it.each([
    ["anthropic", "claude-haiku-4-5"],
    ["anthropic", "claude-sonnet-4-5"],
    ["mistral", "mistral-large-latest"],
    ["mistral", "ministral-8b-latest"],
    ["openai", "gpt-4.1"],
    ["perplexity", "sonar"],
  ] as const)("%s %s ignores it", (provider, model) => {
    expect(effortHandling(provider, model)).toBe("ignored");
  });
});
