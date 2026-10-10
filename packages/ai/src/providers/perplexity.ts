/**
 * Perplexity: web search only (ADR-0002, ADR-0007). It has no text generation on purpose.
 * Speaks Perplexity's Agent API (`POST /v1/responses`); its chat-completions endpoint is retired.
 */
import { AiProviderError } from "../errors";
import type { AiProvider, SearchOutput } from "../types";
import { postJson } from "./http";

/** The parts of an Agent API response a search needs. */
interface AgentResponse {
  status?: string;
  model?: string;
  error?: { message?: string } | null;
  output?: (
    | { type: "search_results"; results?: { url?: string }[] }
    | { type: "message"; content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[] }
    | { type: string }
  )[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Perplexity's preset: its cheapest web-search setup. A configured model replaces only the preset's model. */
const PRESET = "fast";
/** Room for an answer listing offers; also required by Perplexity for `anthropic/*` models. */
const MAX_OUTPUT_TOKENS = 2048;

export interface PerplexityProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

export function createPerplexityProvider(options: PerplexityProviderOptions): AiProvider {
  const client = { provider: "perplexity" as const, apiKey: options.apiKey, fetch: options.fetch };
  return {
    id: "perplexity",
    endpoint: "api.perplexity.ai",
    residency: "outside_eu",
    async search(query, { model }): Promise<SearchOutput> {
      const response = await postJson<AgentResponse>(client, "https://api.perplexity.ai/v1/responses", {
        preset: PRESET,
        ...(model ? { model } : {}),
        input: query,
        tools: [{ type: "web_search" }],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      });
      if (response?.status !== "completed") {
        const reason = response?.error?.message ?? `status ${response?.status ?? "missing"}`;
        throw new AiProviderError("perplexity", `search did not complete: ${reason}`, 200);
      }
      return searchOutputOf(response);
    },
  };
}

function searchOutputOf(response: AgentResponse): SearchOutput {
  const answer: string[] = [];
  const found: string[] = [];
  const cited: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type === "search_results" && "results" in item) {
      for (const result of item.results ?? []) if (result.url) found.push(result.url);
    }
    if (item.type === "message" && "content" in item) {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        answer.push(part.text ?? "");
        for (const annotation of part.annotations ?? []) if (annotation.type === "url_citation" && annotation.url) cited.push(annotation.url);
      }
    }
  }
  return {
    answer: answer.join(""),
    sources: [...new Set([...found, ...cited])],
    model: response.model ?? "unknown",
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}
