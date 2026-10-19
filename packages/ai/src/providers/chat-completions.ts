/**
 * Mistral and OpenAI both speak the chat-completions wire format,
 * so one small fetch client serves the two adapters.
 */
import { effortHandling } from "../effort";
import { AiProviderError } from "../errors";
import type { AiProvider, ProviderId, TextInput, TextOutput, TokenUsage } from "../types";
import { postJson } from "./http";

/**
 * A part of the answer when a model thinks first: Mistral then sends `content` as a list of chunks,
 * "thinking" chunks (a list of text chunks) before the answer's "text" chunks (docs.mistral.ai/capabilities/reasoning).
 */
type ContentChunk = { type: "text"; text: string } | { type: "thinking"; thinking: unknown } | { type: string };

interface ChatCompletion {
  model: string;
  choices: { message: { content: string | ContentChunk[] | null } }[];
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

/** The answer only: the text chunks of a chunked content, never the model's thinking. */
function answerText(completion: ChatCompletion): string {
  const content = completion.choices[0]!.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((chunk) => (chunk.type === "text" && "text" in chunk && typeof chunk.text === "string" ? chunk.text : "")).join("");
}

/**
 * Room for thinking on top of the answer's tokens. A model's thinking counts against max_tokens
 * (Mistral) or max_completion_tokens (OpenAI), so without it a reply that thinks first is cut off,
 * or left empty, before its answer. Callers' maxTokens stays the answer's budget.
 */
const REASONING_ROOM_TOKENS = 8000;

function chatMessages(input: TextInput) {
  return [...(input.system ? [{ role: "system", content: input.system }] : []), ...input.messages];
}

/**
 * `reasoning_effort` as the model takes it (see effort.ts), nothing for a model that has none, and
 * the token limit that leaves room for the thinking it asks for ("none" does not think).
 */
function withReasoning(provider: ProviderId, model: string, input: TextInput): { reasoning_effort?: string; maxTokens: number } {
  const reasoning = reasoningEffort(provider, model, input);
  const thinks = reasoning.reasoning_effort !== undefined && reasoning.reasoning_effort !== "none";
  return { ...reasoning, maxTokens: input.maxTokens + (thinks ? REASONING_ROOM_TOKENS : 0) };
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
      const { maxTokens, ...reasoning } = withReasoning("mistral", model, input);
      const completion = await postChat(client, { model, max_tokens: maxTokens, messages: chatMessages(input), ...reasoning });
      return { text: answerText(completion), model: completion.model, usage: usageOf(completion) };
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
      const { maxTokens, ...reasoning } = withReasoning("openai", model, input);
      const completion = await postChat(client, { model, max_completion_tokens: maxTokens, messages: chatMessages(input), ...reasoning });
      return { text: answerText(completion), model: completion.model, usage: usageOf(completion) };
    },
  };
}
