/**
 * Mistral, OpenAI and Perplexity all speak the chat-completions wire format,
 * so one small fetch client serves the three adapters.
 */
import { AiProviderError } from "../errors";
import type { AiProvider, ProviderId, SearchOutput, TextInput, TextOutput, TokenUsage } from "../types";

interface ChatCompletion {
  model: string;
  choices: { message: { content: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** Perplexity: current shape. */
  search_results?: { url: string }[];
  /** Perplexity: older shape. */
  citations?: string[];
}

interface ChatClientOptions {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

async function postChat(options: ChatClientOptions, body: Record<string, unknown>): Promise<ChatCompletion> {
  const fetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AiProviderError(options.provider, "network error", undefined, { cause: error });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new AiProviderError(options.provider, `HTTP ${response.status} ${detail}`.trim(), response.status);
  }
  const completion = (await response.json()) as ChatCompletion;
  if (!completion.choices?.[0]) throw new AiProviderError(options.provider, "response has no choices", response.status);
  return completion;
}

const usageOf = (completion: ChatCompletion): TokenUsage => ({
  inputTokens: completion.usage?.prompt_tokens ?? 0,
  outputTokens: completion.usage?.completion_tokens ?? 0,
});

function chatMessages(input: TextInput) {
  return [...(input.system ? [{ role: "system", content: input.system }] : []), ...input.messages];
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
    endpoint: "api.mistral.ai",
    residency: "eu",
    async generate(input): Promise<TextOutput> {
      const completion = await postChat(client, {
        model: input.model ?? defaultModel,
        max_tokens: input.maxTokens,
        messages: chatMessages(input),
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
    endpoint: host,
    residency: options.dataResidency === "eu" ? "eu" : "outside_eu",
    async generate(input): Promise<TextOutput> {
      const completion = await postChat(client, {
        model: input.model ?? defaultModel,
        max_completion_tokens: input.maxTokens,
        messages: chatMessages(input),
      });
      return { text: completion.choices[0]!.message.content ?? "", model: completion.model, usage: usageOf(completion) };
    },
  };
}

/** Perplexity: web search only (ADR-0002, ADR-0007). It has no text generation on purpose. */
export function createPerplexityProvider(options: TextProviderOptions): AiProvider {
  const client = { provider: "perplexity" as const, baseUrl: "https://api.perplexity.ai", apiKey: options.apiKey, fetch: options.fetch };
  const defaultModel = options.defaultModel ?? "sonar";
  return {
    id: "perplexity",
    endpoint: "api.perplexity.ai",
    residency: "outside_eu",
    async search(query, { model }): Promise<SearchOutput> {
      const completion = await postChat(client, { model: model ?? defaultModel, messages: [{ role: "user", content: query }] });
      const sources = completion.search_results?.map((result) => result.url) ?? completion.citations ?? [];
      return { answer: completion.choices[0]!.message.content ?? "", sources, model: completion.model, usage: usageOf(completion) };
    },
  };
}
