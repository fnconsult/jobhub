import { describe, expect, it } from "vitest";
import { describeModel, whereItRan } from "./ai-models";

describe("a model, named for people", () => {
  it.each([
    ["claude-opus-5", "Claude Opus 5", "Anthropic"],
    ["claude-opus-5-5", "Claude Opus 5.5", "Anthropic"],
    ["claude-sonnet-5-5-20261001", "Claude Sonnet 5.5", "Anthropic"],
    ["anthropic.claude-opus-5", "Claude Opus 5", "Anthropic"],
    ["eu.anthropic.claude-haiku-4-5-v1:0", "Claude Haiku 4.5", "Anthropic"],
    ["claude-sonnet-5@20260901", "Claude Sonnet 5", "Anthropic"],
    ["mistral-large-latest", "Mistral Large", "Mistral AI"],
    ["mistral-medium-2508", "Mistral Medium", "Mistral AI"],
    ["mistral-medium-3-5", "Mistral Medium 3.5", "Mistral AI"],
    ["mistral-small-latest", "Mistral Small", "Mistral AI"],
    ["gpt-5", "GPT-5", "OpenAI"],
    ["gpt-5-mini", "GPT-5 mini", "OpenAI"],
    ["gpt-5-nano-2025-08-07", "GPT-5 nano", "OpenAI"],
  ])("%s is « %s » by %s", (model, name, provider) => {
    expect(describeModel(model)).toEqual({ name, provider });
  });

  it.each([
    ["perplexity", "fast", "Perplexity"],
    ["brave", "web", "Brave Search"],
    ["tavily", "advanced", "Tavily"],
  ])("a web search on %s (%s) is named for its provider", (provider, model, name) => {
    expect(describeModel(model, provider)).toEqual({ name, provider: name });
  });

  it("shows an unknown model raw, with no provider", () => {
    expect(describeModel("claude-opus-7-preview")).toEqual({ name: "claude-opus-7-preview", provider: null });
  });
});

describe("where a model ran, in words", () => {
  it.each([
    ["bedrock eu-north-1", "AWS Bedrock · UE (Stockholm)", "AWS Bedrock · EU (Stockholm)"],
    ["bedrock eu-west-3", "AWS Bedrock · UE (Paris)", "AWS Bedrock · EU (Paris)"],
    ["bedrock eu-central-1", "AWS Bedrock · UE (Francfort)", "AWS Bedrock · EU (Frankfurt)"],
    ["bedrock eu-west-2", "AWS Bedrock · hors UE (Londres)", "AWS Bedrock · outside the EU (London)"],
    ["bedrock us-east-1", "AWS Bedrock · hors UE (Virginie)", "AWS Bedrock · outside the EU (Virginia)"],
    ["vertex europe-west1", "Google Vertex AI · UE (Belgique)", "Google Vertex AI · EU (Belgium)"],
    ["vertex eu", "Google Vertex AI · UE", "Google Vertex AI · EU"],
    ["api.anthropic.com", "API Anthropic · hors UE", "Anthropic API · outside the EU"],
    ["api.eu.mistral.ai", "Mistral AI · UE", "Mistral AI · EU"],
    ["api.mistral.ai", "Mistral AI · hors UE", "Mistral AI · outside the EU"],
    ["eu.api.openai.com", "OpenAI · UE", "OpenAI · EU"],
    ["api.openai.com", "OpenAI · hors UE", "OpenAI · outside the EU"],
    ["api.perplexity.ai", "Perplexity · hors UE", "Perplexity · outside the EU"],
    ["api.search.brave.com", "Brave Search · hors UE", "Brave Search · outside the EU"],
    ["api.tavily.com", "Tavily · hors UE", "Tavily · outside the EU"],
  ])("%s ran at « %s »", (endpoint, fr, en) => {
    expect(whereItRan(endpoint)).toEqual({ fr, en });
  });

  it("names a platform's unknown region raw, without claiming the EU", () => {
    expect(whereItRan("bedrock eu-east-9")).toEqual({ fr: "AWS Bedrock · eu-east-9", en: "AWS Bedrock · eu-east-9" });
  });

  it("shows an unknown endpoint raw", () => {
    expect(whereItRan("llm.example.com")).toEqual({ fr: "llm.example.com", en: "llm.example.com" });
  });
});
