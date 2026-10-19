/**
 * Mistral and OpenAI both speak the chat-completions wire format,
 * so one small fetch client serves the two adapters.
 */
import { effortHandling } from "../effort";
import { AiProviderError } from "../errors";
import type { AiProvider, ProviderId, TextInput, TextOutput, TokenUsage } from "../types";
import { postJson } from "./http";

interface ChatCompletion {
  model: string;
  choices: { message: { content: string | null } }[];
  /** `prompt_tokens` include the cached ones, when the provider reports them (OpenAI; Mistral not documented, #127). */
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

interface ChatClientOptions {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

async function postChat(options: ChatClientOptions, body: Record<string, unknown>): Promise<ChatCompletion> {
  const completion = await postJson<ChatCompletion>(options, `${options.baseUrl}/chat/completions`, body);
  if (!completion?.choices?.[0]) throw new AiProviderError(options.provider, "response has no choices", 200);
  return completion;
}

function usageOf(completion: ChatCompletion): TokenUsage {
  const cachedInputTokens = completion.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (completion.usage?.prompt_tokens ?? 0) - cachedInputTokens),
    outputTokens: completion.usage?.completion_tokens ?? 0,
    ...(cachedInputTokens ? { cachedInputTokens } : {}),
  };
}

function chatMessages(input: TextInput) {
  return [...(input.system ? [{ role: "system", content: input.system }] : []), ...input.messages];
}

/** `reasoning_effort`, as the model takes it (see effort.ts); nothing for a model that has none. */
function reasoningEffort(provider: ProviderId, model: string, input: TextInput): { reasoning_effort?: string } {
  if (!input.effort) return {};
  switch (effortHandling(provider, model)) {
    case "native":
      return { reasoning_effort: input.effort };
    case "medium_as_high":
      return { reasoning_effort: input.effort === "low" ? "none" : "high" };
    case "ignored":
      return {};
  }
}

interface TextProviderOptions {
  apiKey: string;
  defaultModel?: string;
  fetch?: typeof globalThis.fetch;
}

/** Mistral AI's API is hosted in the EU. */
export function createMistralProvider(options: TextProviderOptions): AiProvider {
  const client = { provider: "mistral" as const, baseUrl: "https://api.mistral.ai/v1", apiKey: options.apiKey, fetch: options.fetch };
  const defaultModel = options.defaultModel ?? "mistral-large-latest";
  return {
    id: "mistral",
    defaultModel,
    models: [...new Set([defaultModel, "mistral-medium-3-5", "mistral-small-latest"])],
    endpoint: "api.mistral.ai",
    residency: "eu",
    async generate(input): Promise<TextOutput> {
      const model = input.model ?? defaultModel;
      const completion = await postChat(client, {
        model,
        max_tokens: input.maxTokens,
        messages: chatMessages(input),
        ...reasoningEffort("mistral", model, input),
      });
      return { text: completion.choices[0]!.message.content ?? "", model: completion.model, usage: usageOf(completion) };
    },
  };
}

export interface OpenAiProviderOptions extends TextProviderOptions {
  /** "eu" uses OpenAI's EU data-residency endpoint (requires an EU-residency project). */
  dataResidency: "eu" | "us";
}

export function createOpenAiProvider(options: OpenAiProviderOptions): AiProvider {
  const host = options.dataResidency === "eu" ? "eu.api.openai.com" : "api.openai.com";
  const client = { provider: "openai" as const, baseUrl: `https://${host}/v1`, apiKey: options.apiKey, fetch: options.fetch };
  const defaultModel = options.defaultModel ?? "gpt-5";
  return {
    id: "openai",
    defaultModel,
    models: [...new Set([defaultModel, "gpt-5-mini"])],
    endpoint: host,
    residency: options.dataResidency === "eu" ? "eu" : "outside_eu",
    async generate(input): Promise<TextOutput> {
      const model = input.model ?? defaultModel;
      const completion = await postChat(client, {
        model,
        max_completion_tokens: input.maxTokens,
        messages: chatMessages(input),
        ...reasoningEffort("openai", model, input),
      });
      return { text: completion.choices[0]!.message.content ?? "", model: completion.model, usage: usageOf(completion) };
    },
  };
}
