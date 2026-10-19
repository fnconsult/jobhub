/**
 * The provider-agnostic AI layer (ADR-0007): every LLM and AI-search call goes through `AiLayer`.
 * Server-side only: never import it from the browser extension.
 *
 *   const ai = createAiLayerFromEnv();
 *   await ai.generate({ task: "scoring", candidateId, system, prompt });
 *   // Declare it when the prompt carries the Candidate's identity: with EU AI consent, it goes to Mistral.
 *   await ai.generate({ task: "writing", candidateId, system, prompt, containsIdentity: true });
 *   const plan = await ai.planJobSearch({ candidateId, criteria }); // up to 6 queries: job title variants × FR/EN
 *   await ai.searchWeb({ candidateId, criteria, query: plan.queries[0], page: 1, filters: { excludeDomains, maxAgeDays: 30 } });
 *   await ai.searchCompany({ candidateId, employer });
 *   await readOfferFields(ai, { candidateId, jobOffer }); // a Job Offer's fields, read from its text
 */
export { createAiLayer } from "./ai-layer";
export type {
  AgentModelChoice,
  AiLayer,
  AiLayerOptions,
  CompanySearchRequest,
  GenerateRequest,
  GenerateResult,
  JobSearchPlan,
  JobSearchPlanRequest,
  Route,
  SearchRequest,
  SearchResult,
} from "./ai-layer";
export { AI_ENV_KEYS, createAiLayerFromEnv, taskRouteFromEnv } from "./env";
export type { AiLayerDeps } from "./env";
export { AiConfigError, AiProviderError, DataResidencyError } from "./errors";
export { createAnthropicProvider } from "./providers/anthropic";
export type { AnthropicEndpoint, AnthropicProviderOptions } from "./providers/anthropic";
export { createMistralProvider, createOpenAiProvider } from "./providers/chat-completions";
export { createPerplexityProvider } from "./providers/perplexity";
export { createBraveProvider } from "./providers/brave";
export { createLinkupProvider } from "./providers/linkup";
export { createTavilyProvider } from "./providers/tavily";
export { readJobPage, readOfferFields } from "./job-offer-reading";
export type { OfferFields } from "./job-offer-reading";
export { buildCompanyQuery, buildSearchQuery, COMPANY_FACTS } from "./search-query";
export type { JobSearchQuery, QueryLanguage } from "./search-query";
export { PROVIDER_IDS, SEARCH_TASK, TEXT_TASKS } from "./types";
export type * from "./types";
export { allUsageLogs, createConsoleUsageLog } from "./usage";
export { EFFORTS, effortHandling, isEffort } from "./effort";
export type { Effort, EffortHandling } from "./effort";
export { costInEur, enrichmentCostInEur, EUR_PER_USD, toolCostInEur } from "./cost";
export type { PricedCall } from "./cost";
