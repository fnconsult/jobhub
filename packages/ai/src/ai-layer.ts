import type { SearchCriteria } from "@jobhub/shared";
import { findIdentity } from "./identity-scan";
import { buildCompanyQuery, buildSearchQuery, jobSearchQueries, jobTitlesPrompt, type JobSearchQuery, type QueryLanguage } from "./search-query";
import { buildCompanyNewsQuery, COMPANY_NEWS_MAX_AGE_DAYS, companyNewsIn, type CompanyNewsArticle, type CompanyNewsRequest } from "./company-news";
import { costInEur, toolCostInEur } from "./cost";
import { effortHandling, type Effort, type EffortHandling } from "./effort";
import { AiConfigError, DataResidencyError } from "./errors";
import { SEARCH_TASK, TEXT_TASKS } from "./types";
import type { AiProvider, AiTask, Message, ProviderId, SearchFilters, TextTask, TokenUsage, ToolCall, Transcript, UsageEntry, UsageLog } from "./types";

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
  /**
   * The provider and model for this call instead of the task's (a Playbook Agent's, #225). The task's
   * data rules still hold: a personal-data task only reaches an EU-resident endpoint, and an
   * identity-bearing call of a consenting Candidate still goes to the identity route.
   */
  route?: Route;
  /** How hard the model should think; left out by a model that has no such setting (see `agentModels`). */
  effort?: Effort;
}

/**
 * The instructions of one AI task as its task Playbook's served version gives them (ADR-0026): its text,
 * the rules part only (the output shape, safety rules and data stay with the caller), and the Playbook
 * Agent it runs on. Without them, a task uses its built-in text on its configured route.
 */
export interface TaskInstructions {
  text: string;
  /** The Playbook Agent's provider and model; the task's data rules still hold (see `GenerateRequest.route`). */
  route?: Route;
  /** The Playbook Agent's effort; none: the model's own. */
  effort?: Effort;
}

/** A text provider a Playbook Agent may use (#225): EU-resident, with the models it offers and how each takes effort. */
export interface AgentModelChoice {
  provider: ProviderId;
  endpoint: string;
  /** The model a Playbook Agent naming none gets. */
  defaultModel?: string;
  models: { model: string; effort: EffortHandling }[];
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
  /**
   * Which job title and language to word the query with: one of the queries `planJobSearch` returned,
   * as returned (any other, or a copy, is refused). Default: the Search Criteria's own title, in French.
   */
  query?: JobSearchQuery;
  /** Which page of results, from 1 (the default) up to the plan's `pages`. */
  page?: number;
  /**
   * The one place to search near: one of the Search Criteria's locations, the first by default.
   * A Job Search sends one search per location (ADR-0025).
   */
  location?: string;
}

export interface JobSearchPlanRequest {
  candidateId: string | null;
  /** Only their job title reaches the AI step that finds its variants. */
  criteria: SearchCriteria;
  /** The "job-search-queries" task Playbook's served version; default: its built-in text. */
  instructions?: JobSearchInstructions;
}

/**
 * How a Job Search's queries are prepared, from the "job-search-queries" task Playbook (ADR-0026): the job
 * title variants step's instructions and agent, and how each query opens per language, where
 * `{{intitulé}}` and `{{lieu}}` are one job title and one location, cleaned. An opening lacking either
 * is not used: the built-in one is.
 */
export interface JobSearchInstructions {
  titles: TaskInstructions;
  openings: Record<QueryLanguage, string>;
}

/** What a Job Search sends the web-search provider: its queries, and how far each can be paged. */
export interface JobSearchPlan {
  /** Up to 6 queries, in the order to send them: up to 3 job titles, each in French and English. */
  queries: JobSearchQuery[];
  /** How many pages of results the web-search provider can give one query (`SearchRequest.page`). */
  pages: number;
  /** The job title step's AI call, for its cost; null when it failed (the plan then has the Search Criteria title alone). */
  call: GenerateResult | null;
}

export interface CompanySearchRequest {
  candidateId: string | null;
  /** The only input: the employer's name, as the Job Offer or the Candidate gives it. Never a person. */
  employer: string;
  /**
   * The "company-facts-search" task Playbook's served text, `{{entreprise}}` standing for the employer;
   * default: its built-in text. The JSON keys and "name no person" are always added.
   */
  instructions?: string;
}

export interface SearchResult {
  answer: string;
  sources: string[];
  /** The date the provider states for some sources (by URL); may be a last-updated date. Absent when it dates none. */
  sourceDates?: Record<string, Date>;
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
}

/** The single entry point for every LLM and AI-search call (ADR-0007). */
export interface AiLayer {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /**
   * The queries of a Job Search: the Search Criteria title and up to 2 variants (an AI step given
   * that title alone) × French and English. Never fails: without variants, the title alone.
   */
  planJobSearch(request: JobSearchPlanRequest): Promise<JobSearchPlan>;
  searchWeb(request: SearchRequest): Promise<SearchResult>;
  /** Searches the web for public facts about an employer, for a Company Dossier. */
  searchCompany(request: CompanySearchRequest): Promise<SearchResult>;
  /**
   * Searches the web for the employer's Company News: up to 5 articles from the last 12 months, newest
   * first, none whose title may name a person (company-news.ts). Never fails: on a failed search, none.
   */
  searchCompanyNews(request: CompanyNewsRequest): Promise<CompanyNewsArticle[]>;
  /**
   * The providers and models a Playbook Agent may use (#225): the EU-resident text providers configured,
   * each with the models a route names for it, then those it offers.
   */
  agentModels(): AgentModelChoice[];
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
  /** Milliseconds, to time each call. Default: performance.now. */
  clock?: () => number;
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
/** Room for a few job titles as JSON. */
const JOB_TITLES_MAX_TOKENS = 300;
const DEFAULT_IDENTITY_ROUTE: Route = { provider: "mistral" };
/** ISO 3166-1 alpha-2, e.g. "FR". */
const COUNTRY_CODE = /^[A-Z]{2}$/;

export function createAiLayer(options: AiLayerOptions): AiLayer {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const identityRoute = options.identityRoute ?? DEFAULT_IDENTITY_ROUTE;
  const routeFor = (task: AiTask): Route => {
    const route = options.routes[task];
    if (!route) throw new AiConfigError(`No provider configured for AI task "${task}"`);
    return typeof route === "string" ? { provider: route } : route;
  };
  /**
   * A provider may be reached through several endpoints (Claude: the direct API, then Bedrock). A call with
   * personal data takes the first EU-resident one, else the last one listed (the one meant for personal
   * data, so a refusal names it); any other call, the first one listed.
   */
  const providerFor = (route: Route, personalData = false): AiProvider => {
    const candidates = options.providers.filter((p) => p.id === route.provider);
    const provider = personalData ? (candidates.find((p) => p.residency === "eu") ?? candidates.at(-1)) : candidates[0];
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
    const provider = providerFor(routeFor(task), task !== SEARCH_TASK && TEXT_TASKS[task].personalData);
    if (task === SEARCH_TASK) {
      if (!provider.search) throw new AiConfigError(`AI provider "${provider.id}" cannot search the web`);
    } else {
      assertAllowed(task, provider);
    }
  }
  // The identity route needs no provider until a consenting Candidate's call carries identity; when it has one, check it now.
  const identityProvider = options.euAiConsent && options.providers.some((p) => p.id === identityRoute.provider) && providerFor(identityRoute, true);
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
    const byTask = () => ({ route: request.route ?? routeFor(task), identity: false });
    if (candidateId === null || !options.euAiConsent) return byTask();
    const undeclared = request.containsIdentity ? [] : findIdentity([request.system ?? "", ...messages.map((m) => m.content)]);
    if (!request.containsIdentity && undeclared.length === 0) return byTask();
    if (!(await options.euAiConsent(candidateId))) return byTask();
    if (undeclared.length > 0) warn("Undeclared identity in an AI call: routed as identity-bearing", { task, candidateId, found: undeclared });
    return { route: identityRoute, identity: true };
  }

  /**
   * Records one call's usage without waiting for it: a usage log that throws, rejects or is slow
   * never fails nor delays the call. Its failure is only warned about.
   */
  const log = (entry: Omit<UsageEntry, "at">) => {
    const failed = (error: unknown) =>
      warn("AI usage not recorded", { task: entry.task, provider: entry.provider, error: error instanceof Error ? error.message : String(error) });
    try {
      void Promise.resolve(options.usage.record({ ...entry, at: now() })).catch(failed);
    } catch (error) {
      failed(error);
    }
  };

  /**
   * Makes a provider call and records its usage, failed or not, with what it said. A failed call has
   * no tokens and costs nothing; its model is the route's, else the provider's default. A web
   * search uses the `web_search` tool once unless the provider says otherwise.
   */
  async function recorded<T extends { model: string; usage: TokenUsage; tools?: ToolCall[] }>(
    entry: Pick<UsageEntry, "candidateId" | "task">,
    provider: AiProvider,
    route: Route,
    said: Omit<Transcript, "reply">,
    call: () => Promise<T>,
    replyOf: (output: T) => string,
  ): Promise<T> {
    const base = { ...entry, provider: provider.id, endpoint: provider.endpoint };
    const search = entry.task === SEARCH_TASK;
    const started = clock();
    let output: T;
    try {
      output = await call();
    } catch (error) {
      const durationMs = Math.round(clock() - started);
      const tools = search ? [{ name: "web_search", count: 1, ok: false, durationMs, costEur: 0 }] : [];
      log({ ...base, model: route.model ?? provider.defaultModel ?? provider.id, inputTokens: 0, outputTokens: 0, ok: false, durationMs, costEur: 0, tools, transcript: { ...said, reply: null } });
      throw error;
    }
    const durationMs = Math.round(clock() - started);
    const called = output.tools ?? (search ? [{ name: "web_search", count: 1 }] : []);
    const priced = { provider: provider.id, model: output.model };
    log({
      ...base,
      model: output.model,
      ...output.usage,
      ok: true,
      durationMs,
      costEur: costInEur({ ...priced, usage: output.usage }),
      tools: called.map((tool) => ({ name: tool.name, count: tool.count, ok: tool.ok ?? true, durationMs, costEur: toolCostInEur(priced, tool) })),
      transcript: { ...said, reply: replyOf(output) },
    });
    return output;
  }

  const searchProvider = (): { route: Route; provider: AiProvider } => {
    const route = routeFor(SEARCH_TASK);
    const provider = providerFor(route);
    if (!provider.search) throw new AiConfigError(`AI provider "${provider.id}" cannot search the web`);
    return { route, provider };
  };

  /** `query` must be built by search-query.ts: nothing else ever reaches the search provider. */
  async function search(candidateId: string | null, query: string, filters?: SearchFilters, page?: number): Promise<SearchResult> {
    // A filter names websites, a time window and a country (ADR-0007): a country is a code, never free text.
    if (filters?.country !== undefined && !COUNTRY_CODE.test(filters.country)) {
      throw new DataResidencyError("A web search's country filter must be a two-letter country code (ISO 3166-1 alpha-2)");
    }
    const { route, provider } = searchProvider();
    const output = await recorded(
      { candidateId, task: SEARCH_TASK },
      provider,
      route,
      { messages: [{ role: "user", content: query }] },
      () => provider.search!(query, { model: route.model, filters, ...(page && page > 1 ? { page } : {}) }),
      (answer) => answer.answer,
    );
    return {
      answer: output.answer,
      sources: output.sources,
      ...(output.sourceDates ? { sourceDates: output.sourceDates } : {}),
      provider: provider.id,
      model: output.model,
      usage: output.usage,
    };
  }

  const layer: AiLayer = {
    async generate(request) {
      const messages = typeof request.prompt === "string" ? [{ role: "user" as const, content: request.prompt }] : request.prompt;
      const { route, identity } = await routeForCall(request, messages);
      const provider = providerFor(route, identity || TEXT_TASKS[request.task].personalData);
      // Checked again per call: the rule must hold even if a provider changes at runtime.
      assertAllowed(request.task, provider, identity);
      const output = await recorded(
        { candidateId: request.candidateId, task: request.task },
        provider,
        route,
        { ...(request.system === undefined ? {} : { system: request.system }), messages },
        () =>
          provider.generate!({
            model: route.model,
            system: request.system,
            messages,
            maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(request.effort ? { effort: request.effort } : {}),
          }),
        (reply) => reply.text,
      );
      return { text: output.text, provider: provider.id, model: output.model, usage: output.usage };
    },

    async planJobSearch({ candidateId, criteria, instructions }) {
      const pages = Math.max(1, searchProvider().provider.searchPages ?? 1);
      const titles = instructions?.titles;
      const { system, prompt } = jobTitlesPrompt(criteria, titles?.text);
      let call: GenerateResult | null = null;
      try {
        call = await layer.generate({
          task: "job_titles",
          candidateId,
          system,
          prompt,
          maxTokens: JOB_TITLES_MAX_TOKENS,
          ...(titles?.route ? { route: titles.route } : {}),
          ...(titles?.effort ? { effort: titles.effort } : {}),
        });
      } catch (error) {
        warn("Job title variants unavailable: searching with the Search Criteria title alone", {
          candidateId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { queries: jobSearchQueries(criteria, call?.text ?? null, instructions?.openings), pages, call };
    },

    async searchWeb(request) {
      return search(request.candidateId, buildSearchQuery(request.criteria, request.query, request.location ?? request.criteria.locations[0]), request.filters, request.page);
    },

    async searchCompany(request) {
      return search(request.candidateId, buildCompanyQuery(request.employer, request.instructions));
    },

    async searchCompanyNews(request) {
      try {
        const found = await search(request.candidateId, buildCompanyNewsQuery(request), { maxAgeDays: COMPANY_NEWS_MAX_AGE_DAYS });
        const companyNames = [request.employer, request.registeredName ?? "", request.website ?? ""].filter(Boolean);
        return companyNewsIn(found.answer, { now: now(), companyNames, ...(found.sourceDates ? { sourceDates: found.sourceDates } : {}) });
      } catch (error) {
        warn("Company News unavailable: the Company Dossier is built without it", {
          candidateId: request.candidateId,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },

    agentModels() {
      const routed = [...Object.values(options.routes), identityRoute].map((route) => (typeof route === "string" ? { provider: route } : route));
      const choices: AgentModelChoice[] = [];
      for (const provider of options.providers) {
        if (!provider.generate || provider.residency !== "eu" || choices.some((choice) => choice.provider === provider.id)) continue;
        const named = routed.flatMap((route) => (route?.provider === provider.id && route.model ? [route.model] : []));
        const models = [...new Set([...named, ...(provider.models ?? (provider.defaultModel ? [provider.defaultModel] : []))])];
        // A provider standing for a missing key offers nothing.
        if (models.length > 0) {
          choices.push({
            provider: provider.id,
            endpoint: provider.endpoint,
            ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
            models: models.map((model) => ({ model, effort: effortHandling(provider.id, model) })),
          });
        }
      }
      return choices;
    },
  };
  return layer;
}
