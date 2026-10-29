import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { effortHandling, type Effort } from "../effort";
import { AiProviderError } from "../errors";
import type { AiProvider, Residency, TextInput, TextOutput, TokenUsage } from "../types";

/**
 * Where Claude is reached. Only Bedrock and Vertex in an EU region are EU-resident; the direct
 * Anthropic API is not, so the AI layer prefers another endpoint for a task with personal data, and
 * the Back Office marks it outside the EU (every call is redacted either way, ADR-0007).
 */
export type AnthropicEndpoint =
  /** Anthropic's own API. */
  | { kind: "direct"; apiKey: string }
  /** AWS Bedrock. Without `apiKey` (a Bedrock API key), the AWS credential chain is used (e.g. the ECS task role). */
  | { kind: "bedrock"; region: string; apiKey?: string }
  /** Google Vertex AI. Without `authClient`, Google application default credentials are used. */
  | { kind: "vertex"; region: string; projectId: string; authClient?: VertexAuthClient };

type VertexAuthClient = NonNullable<NonNullable<ConstructorParameters<typeof AnthropicVertex>[0]>["authClient"]>;

export interface AnthropicProviderOptions {
  endpoint: AnthropicEndpoint;
  /** Used when the task's route names no model. */
  defaultModel?: string;
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
}

/** The Claude models offered a Playbook Agent (#225), largest first. */
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
/**
 * The direct API's default model follows the call's effort (ADR-0007 amendment of 2026-10-28): a model a route
 * names always wins. With no effort, Sonnet.
 */
export const DIRECT_MODEL_BY_EFFORT: Readonly<Record<Effort, string>> = { low: "claude-haiku-5-5", medium: "claude-sonnet-5-5", high: "claude-opus-5-5" };
const DIRECT_DEFAULT_MODEL = DIRECT_MODEL_BY_EFFORT.medium;
/** Bedrock serves older ones in the EU: no 5.5 model in eu-north-1 (October 2026). */
const BEDROCK_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

/** Claude's `input_tokens` leave out the input read from and written to its prompt cache. */
function usageOf(usage: Anthropic.Usage): TokenUsage {
  const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + cacheWriteTokens,
    outputTokens: usage.output_tokens,
    ...(cachedInputTokens ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
  };
}

/** Bedrock regions are "eu-*"; Vertex EU locations are "europe-*" or the "eu" multi-region. */
function residencyOf(endpoint: AnthropicEndpoint): Residency {
  switch (endpoint.kind) {
    case "direct":
      return "outside_eu";
    case "bedrock":
      return /^eu-/.test(endpoint.region) ? "eu" : "outside_eu";
    case "vertex":
      return /^(eu|europe-.+)$/.test(endpoint.region) ? "eu" : "outside_eu";
  }
}

/**
 * The host each endpoint reaches. Always passed to the SDK explicitly: left unset, the SDKs read
 * ANTHROPIC_BASE_URL, ANTHROPIC_BEDROCK_MANTLE_BASE_URL or ANTHROPIC_VERTEX_BASE_URL from the
 * environment, which would send personal data to a host that `residency` knows nothing about.
 */
function baseUrlOf(endpoint: AnthropicEndpoint): string {
  switch (endpoint.kind) {
    case "direct":
      return "https://api.anthropic.com";
    case "bedrock":
      return `https://bedrock-mantle.${endpoint.region}.api.aws/anthropic`;
    case "vertex":
      switch (endpoint.region) {
        case "global":
          return "https://aiplatform.googleapis.com/v1";
        case "us":
        case "eu":
          return `https://aiplatform.${endpoint.region}.rep.googleapis.com/v1`;
        default:
          return `https://${endpoint.region}-aiplatform.googleapis.com/v1`;
      }
  }
}

/** The one call the adapter makes; served identically by the direct, Bedrock and Vertex clients. */
interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message> };
}

function clientFor(options: AnthropicProviderOptions): MessagesClient {
  const { endpoint, fetch, maxRetries } = options;
  const baseURL = baseUrlOf(endpoint);
  switch (endpoint.kind) {
    case "direct":
      return new Anthropic({ apiKey: endpoint.apiKey, baseURL, fetch, maxRetries });
    case "bedrock":
      return new AnthropicBedrockMantle({ awsRegion: endpoint.region, baseURL, apiKey: endpoint.apiKey, fetch, maxRetries });
    case "vertex":
      return new AnthropicVertex({
        region: endpoint.region,
        baseURL,
        projectId: endpoint.projectId,
        ...(endpoint.authClient ? { authClient: endpoint.authClient } : {}),
        fetch,
        maxRetries,
      });
  }
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const { endpoint } = options;
  // Bedrock names Claude's models with its own prefix.
  const named = (model: string) => (endpoint.kind === "bedrock" ? `anthropic.${model}` : model);
  const catalog = endpoint.kind === "bedrock" ? BEDROCK_MODELS : MODELS;
  // The direct API picks its default by effort, unless one is given; Bedrock and Vertex keep their largest model.
  const byEffort = endpoint.kind === "direct" && options.defaultModel === undefined;
  const defaultModel = options.defaultModel ?? (byEffort ? DIRECT_DEFAULT_MODEL : named(catalog[0]!));
  const defaultModelFor = (effort?: Effort): string => (byEffort && effort ? DIRECT_MODEL_BY_EFFORT[effort] : defaultModel);
  let client: MessagesClient | undefined;

  return {
    id: "anthropic",
    defaultModel,
    ...(byEffort ? { defaultModelFor, modelByEffort: DIRECT_MODEL_BY_EFFORT } : {}),
    models: [...new Set([defaultModel, ...catalog.map(named)])],
    endpoint: endpoint.kind === "direct" ? "api.anthropic.com" : `${endpoint.kind} ${endpoint.region}`,
    residency: residencyOf(endpoint),

    async generate(input: TextInput): Promise<TextOutput> {
      client ??= clientFor(options);
      const model = input.model ?? defaultModelFor(input.effort);
      let message: Anthropic.Message;
      try {
        message = await client.messages.create({
          model,
          max_tokens: input.maxTokens,
          ...(input.system ? { system: input.system } : {}),
          messages: input.messages,
          ...(input.effort && effortHandling("anthropic", model) === "native" ? { output_config: { effort: input.effort } } : {}),
        }, input.signal ? { signal: input.signal } : undefined);
      } catch (error) {
        // Stopped (#325): the SDK's own abort error says nothing the signal's reason does not.
        if (input.signal?.aborted) throw input.signal.reason;
        const apiError = error instanceof Anthropic.APIError;
        // An API error's message carries the answer, scrubbed here; the error itself (headers, body) is not kept as the cause.
        const secrets = endpoint.kind === "vertex" ? [] : [endpoint.apiKey];
        throw new AiProviderError("anthropic", error instanceof Error ? error.message : "request failed", apiError ? error.status : undefined, {
          secrets,
          ...(!apiError && { cause: error }),
        });
      }
      if (message.stop_reason === "refusal") throw new AiProviderError("anthropic", "Claude declined the request (refusal)", undefined, { reason: "provider_rejected" });
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return {
        text,
        model: message.model,
        usage: usageOf(message.usage),
      };
    },
  };
}
