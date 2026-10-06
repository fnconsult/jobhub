import type { SearchCriteria } from "@jobhub/shared";
import { buildSearchQuery } from "./search-query";
import { AiConfigError, DataResidencyError } from "./errors";
import { SEARCH_TASK, TEXT_TASKS } from "./types";
import type { AiProvider, AiTask, Message, ProviderId, TextTask, TokenUsage, UsageEntry, UsageLog } from "./types";

export { AiConfigError, DataResidencyError };

export interface GenerateRequest {
  task: TextTask;
  /** The Candidate the call is made for; null for a Guest. */
  candidateId: string | null;
  system?: string;
  /** A single user prompt, or a whole conversation. */
  prompt: string | Message[];
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
}

export interface SearchRequest {
  candidateId: string | null;
  /** The only input: the provider receives a query built from these fields and nothing else. */
  criteria: SearchCriteria;
}

export interface SearchResult {
  answer: string;
  sources: string[];
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
}

/** The single entry point for every LLM and AI-search call (ADR-0007). */
export interface AiLayer {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  searchWeb(request: SearchRequest): Promise<SearchResult>;
}

export interface Route {
  provider: ProviderId;
  model?: string;
}

export interface AiLayerOptions {
  providers: AiProvider[];
  /** Which provider (and optionally model) serves each task. */
  routes: Partial<Record<AiTask, ProviderId | Route>>;
  usage: UsageLog;
  now?: () => Date;
}

const DEFAULT_MAX_TOKENS = 4096;

export function createAiLayer(options: AiLayerOptions): AiLayer {
  const now = options.now ?? (() => new Date());
  const routeFor = (task: AiTask): Route => {
    const route = options.routes[task];
    if (!route) throw new AiConfigError(`No provider configured for AI task "${task}"`);
    return typeof route === "string" ? { provider: route } : route;
  };
  const providerFor = (route: Route): AiProvider => {
    const provider = options.providers.find((p) => p.id === route.provider);
    if (!provider) throw new AiConfigError(`AI provider "${route.provider}" is not configured`);
    return provider;
  };

  const assertAllowed = (task: TextTask, provider: AiProvider) => {
    if (!provider.generate) throw new AiConfigError(`AI provider "${provider.id}" cannot generate text (task "${task}")`);
    if (TEXT_TASKS[task].personalData && provider.residency !== "eu") {
      throw new DataResidencyError(
        `AI task "${task}" carries personal data and may only use an EU-resident endpoint, not ${provider.id} (${provider.endpoint})`,
      );
    }
  };

  // Fail fast at start-up on a configuration that breaks the data rule.
  for (const task of Object.keys(options.routes) as AiTask[]) {
    const provider = providerFor(routeFor(task));
    if (task === SEARCH_TASK) {
      if (!provider.search) throw new AiConfigError(`AI provider "${provider.id}" cannot search the web`);
    } else {
      assertAllowed(task, provider);
    }
  }

  const log = (entry: Omit<UsageEntry, "at">) => options.usage.record({ ...entry, at: now() });

  return {
    async generate(request) {
      const route = routeFor(request.task);
      const provider = providerFor(route);
      // Checked again per call: the rule must hold even if a provider changes at runtime.
      assertAllowed(request.task, provider);
      const messages = typeof request.prompt === "string" ? [{ role: "user" as const, content: request.prompt }] : request.prompt;
      const output = await provider.generate!({
        model: route.model,
        system: request.system,
        messages,
        maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
      await log({
        candidateId: request.candidateId,
        task: request.task,
        provider: provider.id,
        endpoint: provider.endpoint,
        model: output.model,
        ...output.usage,
      });
      return { text: output.text, provider: provider.id, model: output.model, usage: output.usage };
    },

    async searchWeb(request) {
      const route = routeFor(SEARCH_TASK);
      const provider = providerFor(route);
      if (!provider.search) throw new AiConfigError(`AI provider "${provider.id}" cannot search the web`);
      const output = await provider.search(buildSearchQuery(request.criteria), { model: route.model });
      await log({
        candidateId: request.candidateId,
        task: SEARCH_TASK,
        provider: provider.id,
        endpoint: provider.endpoint,
        model: output.model,
        ...output.usage,
      });
      return { answer: output.answer, sources: output.sources, provider: provider.id, model: output.model, usage: output.usage };
    },
  };
}
