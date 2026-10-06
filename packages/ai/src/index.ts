/**
 * The provider-agnostic AI layer (ADR-0007): every LLM and AI-search call goes through `AiLayer`.
 * Server-side only: never import it from the browser extension.
 *
 *   const ai = createAiLayerFromEnv();
 *   await ai.generate({ task: "scoring", candidateId, system, prompt });
 *   await ai.searchWeb({ candidateId, criteria });
 */
export { createAiLayer } from "./ai-layer";
export type { AiLayer, AiLayerOptions, GenerateRequest, GenerateResult, Route, SearchRequest, SearchResult } from "./ai-layer";
export { AI_ENV_KEYS, createAiLayerFromEnv } from "./env";
export type { AiLayerDeps } from "./env";
export { AiConfigError, AiProviderError, DataResidencyError } from "./errors";
export { createAnthropicProvider } from "./providers/anthropic";
export type { AnthropicEndpoint, AnthropicProviderOptions } from "./providers/anthropic";
export { createMistralProvider, createOpenAiProvider, createPerplexityProvider } from "./providers/chat-completions";
export { buildSearchQuery } from "./search-query";
export { PROVIDER_IDS, SEARCH_TASK, TEXT_TASKS } from "./types";
export type * from "./types";
export { createConsoleUsageLog } from "./usage";
