import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { AiProviderError } from "../errors";
import type { AiProvider, Residency, TextInput, TextOutput } from "../types";

/**
 * Where Claude is reached. Only Bedrock and Vertex in an EU region are EU-resident;
 * the direct Anthropic API is not, so the AI layer keeps personal data off it.
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

const DEFAULT_MODEL = "claude-opus-5-5";

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

/** The one call the adapter makes; served identically by the direct, Bedrock and Vertex clients. */
interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

function clientFor(options: AnthropicProviderOptions): MessagesClient {
  const { endpoint, fetch, maxRetries } = options;
  switch (endpoint.kind) {
    case "direct":
      return new Anthropic({ apiKey: endpoint.apiKey, fetch, maxRetries });
    case "bedrock":
      return new AnthropicBedrockMantle({ awsRegion: endpoint.region, apiKey: endpoint.apiKey, fetch, maxRetries });
    case "vertex":
      return new AnthropicVertex({
        region: endpoint.region,
        projectId: endpoint.projectId,
        ...(endpoint.authClient ? { authClient: endpoint.authClient } : {}),
        fetch,
        maxRetries,
      });
  }
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const { endpoint } = options;
  const defaultModel = options.defaultModel ?? (endpoint.kind === "bedrock" ? `anthropic.${DEFAULT_MODEL}` : DEFAULT_MODEL);
  let client: MessagesClient | undefined;

  return {
    id: "anthropic",
    endpoint: endpoint.kind === "direct" ? "api.anthropic.com" : `${endpoint.kind} ${endpoint.region}`,
    residency: residencyOf(endpoint),

    async generate(input: TextInput): Promise<TextOutput> {
      client ??= clientFor(options);
      let message: Anthropic.Message;
      try {
        message = await client.messages.create({
          model: input.model ?? defaultModel,
          max_tokens: input.maxTokens,
          ...(input.system ? { system: input.system } : {}),
          messages: input.messages,
        });
      } catch (error) {
        const status = error instanceof Anthropic.APIError ? error.status : undefined;
        throw new AiProviderError("anthropic", error instanceof Error ? error.message : "request failed", status, { cause: error });
      }
      if (message.stop_reason === "refusal") throw new AiProviderError("anthropic", "Claude declined the request (refusal)");
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return {
        text,
        model: message.model,
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    },
  };
}
