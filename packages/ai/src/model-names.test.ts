import { describeModel, whereItRan } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./providers/anthropic";
import { createMistralProvider, createOpenAiProvider } from "./providers/chat-completions";

const textProviders = [
  createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "key" } }),
  createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1" } }),
  createAnthropicProvider({ endpoint: { kind: "vertex", region: "europe-west1", projectId: "project" } }),
  createMistralProvider({ apiKey: "key" }),
  createOpenAiProvider({ apiKey: "key", dataResidency: "eu" }),
  createOpenAiProvider({ apiKey: "key", dataResidency: "us" }),
];

describe("the model catalogue AI Activity names models by", () => {
  it.each(textProviders.flatMap((provider) => (provider.models ?? []).map((model) => [provider.endpoint, model])))("names %s's %s", (_, model) => {
    expect(describeModel(model).provider).not.toBeNull();
  });

  it.each(textProviders.map((provider) => [provider.endpoint]))("says where %s runs", (endpoint) => {
    expect(whereItRan(endpoint).fr).not.toBe(endpoint);
  });
});
