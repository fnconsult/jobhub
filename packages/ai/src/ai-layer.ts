import type { SearchCriteria } from "@jobhub/shared";
import { findIdentity } from "./identity-scan";
import { buildCompanyQuery, buildSearchQuery, type JobSearchQuery } from "./search-query";
import { AiConfigError, DataResidencyError } from "./errors";
import { SEARCH_TASK, TEXT_TASKS } from "./types";
import type { AiProvider, AiTask, Message, ProviderId, SearchFilters, TextTask, TokenUsage, UsageEntry, UsageLog } from "./types";

export { AiConfigError, DataResidencyError };

export interface GenerateRequest {
  task: TextTask;
  /** The Candidate the call is made for; null for a Guest. */
  candidateId: string | null;
  system?: string;
  /** A single user prompt, or a whole conversation. */
  prompt: string | Message[];
  maxTokens?: number;
  /**
   * True when the prompt or system text carries the Candidate's identity: name, postal address,
   * phone, email, the raw CV text or the Master CV identity block. Declare it from the fields you
   * inject. With the Candidate's EU AI consent, such a call goes to the identity route (Mistral).
   */
  containsIdentity?: boolean;
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
  /** Narrows the search where the provider can (domains, freshness). Results must still be checked. */
  filters?: SearchFilters;
  /** Which job title and language to word the query with. Default: the Search Criteria's own title, in French. */
  query?: JobSearchQuery;
}

export interface CompanySearchRequest {
  candidateId: string | null;
  /** The only input: the employer's name, as the Job Offer or the Candidate gives it. Never a person. */
  employer: string;
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
  /** Searches the web for public facts about an employer, for a Company Dossier. */
  searchCompany(request: CompanySearchRequest): Promise<SearchResult>;
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
  /**
   * Where a call carrying the Candidate's identity goes when they gave EU AI consent
   * (ADR-0007 amendment). Must be an EU-resident text provider. Default: Mistral.
   */
  identityRoute?: Route;
  /** Whether the Candidate gave EU AI consent. Without it, no Candidate has consented. */
  euAiConsent?: (candidateId: string) => Promise<boolean>;
  /** Where a warning goes (e.g. identity found in a call that did not declare it). Default: console.warn. */
  warn?: (message: string, details: Record<string, unknown>) => void;
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_IDENTITY_ROUTE: Route = { provider: "mistral" };

export function createAiLayer(options: AiLayerOptions): AiLayer {
  const now = options.now ?? (() => new Date());
  const identityRoute = options.identityRoute ?? DEFAULT_IDENTITY_ROUTE;
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

  /** `identity`: the call carries the Candidate's identity, so it is personal data whatever its task. */
  const assertAllowed = (task: TextTask, provider: AiProvider, identity = false) => {
    if (!provider.generate) throw new AiConfigError(`AI provider "${provider.id}" cannot generate text (task "${task}")`);
    if ((identity || TEXT_TASKS[task].personalData) && provider.residency !== "eu") {
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
  // The identity route needs no provider until a consenting Candidate's call carries identity; when it has one, check it now.
  const identityProvider = options.euAiConsent && options.providers.find((p) => p.id === identityRoute.provider);
  if (identityProvider && (!identityProvider.generate || identityProvider.residency !== "eu")) {
    throw new DataResidencyError(
      `The identity route carries personal data and must be an EU-resident text provider, not ${identityProvider.id} (${identityProvider.endpoint})`,
    );
  }

  const warn = options.warn ?? ((message: string, details: Record<string, unknown>) => console.warn(`[ai] ${message}`, details));

  /**
   * The identity route when the call carries the Candidate's identity and they gave EU AI consent; else the task's route.
   * A call that does not declare identity is still scanned for a phone number or email address: a hit
   * counts as identity and is logged (never the prompt itself), so the call site can be fixed.
   */
  async function routeForCall(request: GenerateRequest, messages: Message[]): Promise<{ route: Route; identity: boolean }> {
    const { candidateId, task } = request;
    const byTask = () => ({ route: routeFor(task), identity: false });
    if (candidateId === null || !options.euAiConsent) return byTask();
    const undeclared = request.containsIdentity ? [] : findIdentity([request.system ?? "", ...messages.map((m) => m.content)]);
    if (!request.containsIdentity && undeclared.length === 0) return byTask();
    if (!(await options.euAiConsent(candidateId))) return byTask();
    if (undeclared.length > 0) warn("Undeclared identity in an AI call: routed as identity-bearing", { task, candidateId, found: undeclared });
    return { route: identityRoute, identity: true };
  }

  const log = (entry: Omit<UsageEntry, "at">) => options.usage.record({ ...entry, at: now() });

  /** `query` must be built by search-query.ts: nothing else ever reaches the search provider. */
  async function search(candidateId: string | null, query: string, filters?: SearchFilters): Promise<SearchResult> {
    const route = routeFor(SEARCH_TASK);
    const provider = providerFor(route);
    if (!provider.search) throw new AiConfigError(`AI provider "${provider.id}" cannot search the web`);
    const output = await provider.search(query, { model: route.model, filters });
    await log({ candidateId, task: SEARCH_TASK, provider: provider.id, endpoint: provider.endpoint, model: output.model, ...output.usage });
    return { answer: output.answer, sources: output.sources, provider: provider.id, model: output.model, usage: output.usage };
  }

  return {
    async generate(request) {
      const messages = typeof request.prompt === "string" ? [{ role: "user" as const, content: request.prompt }] : request.prompt;
      const { route, identity } = await routeForCall(request, messages);
      const provider = providerFor(route);
      // Checked again per call: the rule must hold even if a provider changes at runtime.
      assertAllowed(request.task, provider, identity);
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

    searchWeb(request) {
      return search(request.candidateId, buildSearchQuery(request.criteria, request.query), request.filters);
    },

    searchCompany(request) {
      return search(request.candidateId, buildCompanyQuery(request.employer));
    },
  };
}
