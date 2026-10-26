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
 *   await ai.searchCompanyNews({ candidateId, employer, registeredName, website }); // its Company News, never fails
 *   await ai.searchCompanyNewsWithCall({ candidateId, employer }); // the same, with the search call (null when it failed)
 *   await readOfferFields(ai, { candidateId, jobOffer, reading }); // a Job Offer's fields, read from its text
 * A task's instructions come from its task Playbook when the caller passes them (`TaskInstructions`,
 * ADR-0026); otherwise from the built-in text, version 1 as written in `@jobhub/coach-knowledge/tasks`.
 * Every call, generation and web search, is redacted before it leaves (redaction.ts): email addresses and
 * phone numbers always, and what `identityOf` knows of the Candidate; a reply gets the values back.
 */
export { createAiLayer, createWebSearchRun } from "./ai-layer";
export type {
  AgentModelChoice,
  AiLayer,
  AiLayerOptions,
  CallFacts,
  CompanyNews,
  CompanySearchRequest,
  GenerateRequest,
  GenerateResult,
  JobSearchPlan,
  JobSearchInstructions,
  JobSearchPlanRequest,
  Route,
  SearchRequest,
  SearchFallback,
  SearchResult,
  TaskInstructions,
  WebSearchRun,
} from "./ai-layer";
export { AI_ENV_KEYS, AI_ROUTING_SETTINGS, createAiLayerFromEnv, modelSettingProviders, taskRouteFromEnv } from "./env";
export type { AiLayerDeps } from "./env";
export { checkAiRoutingChange } from "./routing-check";
export type { AiRoutingCheckDeps, AiRoutingRefusal } from "./routing-check";
export { findIdentity, identityIn } from "./identity-scan";
export type { IdentityHit } from "./identity-scan";
export { AiConfigError, AiProviderError, DataResidencyError, WebSearchUnavailable } from "./errors";
export { givenNameOf, redactIdentity, REDACTION_NOTE } from "./redaction";
export type { CandidateIdentity, RedactedKind, Redaction } from "./redaction";
export { createAnthropicProvider } from "./providers/anthropic";
export type { AnthropicEndpoint, AnthropicProviderOptions } from "./providers/anthropic";
export { createMistralProvider, createOpenAiProvider } from "./providers/chat-completions";
export { createPerplexityProvider } from "./providers/perplexity";
export { createBraveProvider } from "./providers/brave";
export { createTavilyProvider } from "./providers/tavily";
export { activityOf, FEATURE_STEPS, TOOL_STEPS } from "./activity";
export { createProvenanceRecorder } from "./provenance-recorder";
export type { ProvenanceRecorder, ProvenanceRecorderOptions } from "./provenance-recorder";
export type { FeatureStep, StepSubject, StepTool } from "./activity";
export { readJobPage, readOfferFields } from "./job-offer-reading";
export type { OfferFields } from "./job-offer-reading";
export { buildCompanyQuery, buildSearchQuery, COMPANY_FACTS } from "./search-query";
export { buildCompanyNewsQuery, COMPANY_NEWS_MAX_AGE_DAYS, companyNewsIn, MAX_COMPANY_NEWS } from "./company-news";
export type { CompanyNewsArticle, CompanyNewsRequest } from "./company-news";
export { DEFAULT_JOB_SEARCH_SHAPE } from "./search-query";
export type { JobSearchQuery, JobSearchShape, QueryLanguage } from "./search-query";
export { PROVIDER_IDS, SEARCH_TASK, TEXT_TASKS } from "./types";
export type * from "./types";
export { allUsageLogs, createConsoleUsageLog } from "./usage";
export { EFFORTS, effortHandling, isEffort } from "./effort";
export type { Effort, EffortHandling } from "./effort";
export { costInEur, enrichmentCostInEur, EUR_PER_USD, toolCostInEur } from "./cost";
export type { PricedCall } from "./cost";
