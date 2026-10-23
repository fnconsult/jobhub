import { cleanTechnicalMessage, failureOf, type Failure, type FailureReason, type IndustryReference, type Outcome, type SearchCriteria } from "@jobhub/shared";
import { findIdentity } from "./identity-scan";
import { buildCompanyQuery, buildSearchQuery, jobSearchQueries, jobTitlesPrompt, type JobSearchQuery, type QueryLanguage } from "./search-query";
import { buildCompanyNewsQuery, COMPANY_NEWS_MAX_AGE_DAYS, companyNewsIn, type CompanyNewsArticle, type CompanyNewsRequest } from "./company-news";
import { costInEur, toolCostInEur } from "./cost";
import { effortHandling, type Effort, type EffortHandling } from "./effort";
import { AiConfigError, DataResidencyError } from "./errors";
import { redactIdentity, REDACTION_NOTE, type CandidateIdentity, type Redaction } from "./redaction";
import { SEARCH_TASK, TEXT_TASKS } from "./types";
import type { AiProvider, AiTask, AiWarning, Message, ProviderId, Residency, SearchFilters, TextOutput, TextTask, TokenUsage, ToolCall, Transcript, UsageEntry, UsageLog } from "./types";

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
   * The provider and model for this call instead of the task's (a Playbook Agent's, #225), any text
   * provider configured. The call is still redacted (redaction.ts), and an identity-bearing call of a
   * consenting Candidate still goes to the identity route.
   */
  route?: Route;
  /** How hard the model should think; left out by a model that has no such setting (see `agentModels`). */
  effort?: Effort;
  /**
   * The degraded paths the feature this call serves took (#260, ADR-0030): a Task Playbook fallback, a Playbook
   * Agent left out… recorded with the call, then Outcome warning when it works. Read when the call is recorded,
   * so one added while it runs (a Match Score that stopped waiting for it) is recorded too.
   */
  warnings?: AiWarning[];
  /**
   * What the feature does without this call (#260), e.g. `cv_reading_fallback`: recorded with the call when it
   * fails or is never sent, beside its own Failure Reason.
   */
  fallback?: FailureReason;
  /**
   * Whether the feature can use the reply (#260): null when it can, else the warning to record the call with, its
   * detail written by the code (why, a length), never the reply's text.
   */
  unusable?: (reply: string) => AiWarning | null;
  /**
   * Stops the call (#325): passed to the provider's request. Once aborted, the call rejects with the signal's reason
   * and is recorded failed, Failure Reason `stopped`, with no tokens; not sent when it had not left yet.
   */
  signal?: AbortSignal;
}

/**
 * The instructions of one AI task as its task Playbook's served version gives them (ADR-0026): its text,
 * the rules part only (the output shape, safety rules and data stay with the caller), and the Playbook
 * Agent it runs on. Without them, a task uses its built-in text on its configured route.
 */
export interface TaskInstructions {
  text: string;
  /** The Playbook Agent's provider and model; the call is still redacted (see `GenerateRequest.route`). */
  route?: Route;
  /** The Playbook Agent's effort; none: the model's own. */
  effort?: Effort;
  /** How the task Playbook fell back (#260): recorded with each call it runs. */
  warnings?: AiWarning[];
}

/**
 * A provider a task Playbook may run on, as the Back Office offers it: a text provider for a Playbook
 * Agent (#225), or a web-search provider for a task Playbook's searches (ADR-0026). Every one configured
 * is offered, outside the EU too, which the Back Office says: redaction keeps the Candidate's identity
 * out of every call (redaction.ts).
 */
export interface AgentModelChoice {
  provider: ProviderId;
  /** Where it is reached; several, comma-separated, when the provider has more than one endpoint (Claude). */
  endpoint: string;
  /** Where the endpoint its default model runs on processes data. */
  residency: Residency;
  /** The model a Playbook Agent naming none gets; for a web search, the provider's own (a depth, for Tavily and Linkup). */
  defaultModel?: string;
  /** Each with how it takes effort (a web search ignores it) and where the endpoint serving it processes data. */
  models: { model: string; effort: EffortHandling; residency: Residency }[];
}

/**
 * How one call that worked went, as AI Usage records it (ADR-0034): what the caller keeps in a result's Provenance.
 * A call that failed throws instead.
 */
export interface CallFacts {
  /** The endpoint that served it, with its region when it has one, e.g. "bedrock eu-north-1" or "api.mistral.ai". */
  endpoint: string;
  /** How long the provider took to answer. */
  durationMs: number;
  /** ok, or warning when the feature it served ran degraded (its warnings, or a reply it could not use). */
  outcome: Exclude<Outcome, "failed">;
}

export interface GenerateResult extends CallFacts {
  text: string;
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
  /**
   * Present when the call carried the Candidate's identity and went to the identity route under their
   * EU AI Consent (ADR-0007 amendment, #121): what AI Activity shows as « consentement IA UE » (#327).
   */
  euAiConsent?: true;
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
  /** The web-search provider and model (or depth) instead of the configured one: a task Playbook's (ADR-0026), one `searchModels` offers. */
  route?: Route;
  /**
   * The one place to search near: one of the Search Criteria's locations, the first by default.
   * A Job Search sends one search per location (ADR-0025).
   */
  location?: string;
  /** The NAF labels the Search Criteria's Sectors are named by (#236); without them, none is named. */
  industries?: IndustryReference;
  /** The degraded paths its feature took (a task Playbook's fallback), recorded with the search (see `GenerateRequest.warnings`). */
  warnings?: AiWarning[];
  /** Stops the search (see `GenerateRequest.signal`). */
  signal?: AbortSignal;
}

export interface JobSearchPlanRequest {
  candidateId: string | null;
  /** Only their job title reaches the AI step that finds its variants. */
  criteria: SearchCriteria;
  /** The "job-search-queries" task Playbook's served version; default: its built-in text. */
  instructions?: JobSearchInstructions;
  /** The web-search provider its searches will go to (`SearchRequest.route`), for how far they page; default: the configured one. */
  route?: Route;
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
  /** The web-search provider and model instead of the configured one (see `SearchRequest.route`). */
  route?: Route;
  /** The degraded paths its feature took (a task Playbook's fallback), recorded with the search (see `GenerateRequest.warnings`). */
  warnings?: AiWarning[];
  /** Stops the search (see `GenerateRequest.signal`). */
  signal?: AbortSignal;
}

export interface SearchResult extends CallFacts {
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
   * first, none whose title may name a person (company-news.ts). Never fails: on a failed search, none;
   * only a search stopped by its signal rejects.
   */
  searchCompanyNews(request: CompanyNewsRequest): Promise<CompanyNewsArticle[]>;
  /** `searchCompanyNews`, with the search call that found the articles (null when it failed): for a Provenance (ADR-0034). */
  searchCompanyNewsWithCall(request: CompanyNewsRequest): Promise<CompanyNews>;
  /**
   * The providers and models a Playbook Agent may use (#225): every text provider configured, outside the
   * EU too, each with the models a route names for it, then those it offers.
   */
  agentModels(): AgentModelChoice[];
  /**
   * The same layer for an Eval Run (#231, ADR-0023): each text call is recorded in AI Usage on the `eval` task
   * and for no Candidate (Eval Cases are fictional), yet keeps the route and data rules of its own task, so the
   * AI Coach and its Playbook Agents are played on the endpoints they use for Candidates. The AI
   * judge's own calls are of the `eval` task. An Eval Run makes no web search: those methods refuse.
   */
  forEval(): AiLayer;
  /**
   * The web-search providers and models (or depths) a task Playbook's searches may use (ADR-0026): every
   * web-search provider configured, the configured route's model first for its provider.
   */
  searchModels(): AgentModelChoice[];
}

/** A Company Dossier's Company News, and the web search that found them. */
export interface CompanyNews {
  articles: CompanyNewsArticle[];
  /** The search call; null when it failed (the articles are then none). */
  call: SearchResult | null;
}

export interface Route {
  provider: ProviderId;
  model?: string;
}

/** What the feature an AI call serves says of it (#260), recorded with it. */
interface CallNotes<T> {
  /** Its warnings, read when the call is recorded. */
  warnings: () => readonly AiWarning[];
  /** What the feature does without it: recorded with it when it fails. */
  fallback?: FailureReason;
  /** The warning of an output the feature cannot use, or null when it can. */
  unusable?: (output: T) => AiWarning | null;
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
   * (ADR-0007 amendment, #121): the Candidate's own choice. Must be an EU-resident text provider. Default: Mistral.
   */
  identityRoute?: Route;
  /** Whether the Candidate gave EU AI consent. Without it, no Candidate has consented. */
  euAiConsent?: (candidateId: string) => Promise<boolean>;
  /** Where a warning goes (e.g. identity found in a call that did not declare it). Default: console.warn. */
  warn?: (message: string, details: Record<string, unknown>) => void;
  /**
   * What is known of the Candidate's identity (their account's and Master CV's name, email, phone,
   * address and links), taken out of each of their calls before it is sent (redaction.ts). Without it,
   * or when it fails, only email addresses and phone numbers are, by their shape.
   */
  identityOf?: (candidateId: string) => Promise<CandidateIdentity | null>;
}

const DEFAULT_MAX_TOKENS = 4096;
/** Room for a few job titles as JSON. */
const JOB_TITLES_MAX_TOKENS = 300;
const DEFAULT_IDENTITY_ROUTE: Route = { provider: "mistral" };
/** ISO 3166-1 alpha-2, e.g. "FR". */
const COUNTRY_CODE = /^[A-Z]{2}$/;
/** How long a Candidate's identity is kept between their calls (a Job discovery run makes many). */
const IDENTITY_CACHE_MS = 60_000;
/** Candidates whose identity is kept at most; past it, all are read again. */
const IDENTITY_CACHE_SIZE = 1_000;

/**
 * The endpoint a route reaches among `providers`, or none when its provider is not configured. A provider
 * may be reached through several endpoints (Claude: the direct API, then Bedrock). A model only some of
 * them name (Bedrock prefixes Claude's) takes one of those. Among them, a call with personal data (`euFirst`:
 * its task's, or the identity of a consenting Candidate) takes the first EU-resident one when there is one,
 * a preference rather than a rule; any other call, the first one listed.
 */
export function endpointFor(providers: readonly AiProvider[], route: Route, euFirst = false): AiProvider | undefined {
  const all = providers.filter((p) => p.id === route.provider);
  const naming = route.model ? all.filter((p) => p.models?.includes(route.model!)) : [];
  const candidates = naming.length > 0 ? naming : all;
  return euFirst ? (candidates.find((p) => p.residency === "eu") ?? candidates[0]) : candidates[0];
}

export function createAiLayer(options: AiLayerOptions): AiLayer {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const identityRoute = options.identityRoute ?? DEFAULT_IDENTITY_ROUTE;
  const routeFor = (task: AiTask): Route => {
    const route = options.routes[task];
    if (!route) throw new AiConfigError(`No provider configured for AI task "${task}"`);
    return typeof route === "string" ? { provider: route } : route;
  };
  const providerFor = (route: Route, euFirst = false): AiProvider => {
    const provider = endpointFor(options.providers, route, euFirst);
    // Its key was never entered: a provider is configured with its key.
    if (!provider) throw new AiConfigError(`AI provider "${route.provider}" is not configured`, { reason: "key_missing" });
    return provider;
  };

  /**
   * A web-search provider only searches: it never takes a text task. `identity`: the call goes to the
   * identity route under the Candidate's EU AI consent (ADR-0007 amendment, #121), which must be EU-resident.
   */
  const assertAllowed = (task: TextTask, provider: AiProvider, identity = false) => {
    if (!provider.generate) throw new AiConfigError(`AI provider "${provider.id}" cannot generate text (task "${task}")`);
    if (identity && provider.residency !== "eu") {
      throw new DataResidencyError(`The identity route of a Candidate with EU AI consent must be EU-resident, not ${provider.id} (${provider.endpoint}) (task "${task}")`);
    }
  };

  // Fail fast at start-up on a task routed to a provider that cannot serve it.
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

  const identities = new Map<string, { at: number; identity: Promise<CandidateIdentity | null> }>();
  /**
   * What is known of the Candidate's identity, kept a minute. Never fails: a lookup that throws or rejects
   * is warned about (never its values) and the call is redacted by shape alone.
   */
  async function identityFor(candidateId: string, task: AiTask): Promise<{ identity: CandidateIdentity | null; warning?: AiWarning }> {
    const lookup = options.identityOf;
    if (!lookup) return { identity: null };
    const at = now().getTime();
    let cached = identities.get(candidateId);
    if (!cached || at - cached.at > IDENTITY_CACHE_MS) {
      if (identities.size >= IDENTITY_CACHE_SIZE) identities.clear();
      cached = { at, identity: Promise.resolve().then(() => lookup(candidateId)) };
      identities.set(candidateId, cached);
    }
    try {
      return { identity: await cached.identity };
    } catch (error) {
      if (identities.get(candidateId) === cached) identities.delete(candidateId);
      const message = error instanceof Error ? error.message : String(error);
      warn("Candidate identity unavailable: the call is redacted by shape alone (emails, phone numbers)", { task, candidateId, error: message });
      return { identity: null, warning: { reason: "identity_unavailable", detail: `identity lookup failed: ${message}` } };
    }
  }

  /**
   * `texts` with the Candidate's identity taken out (redaction.ts); how many of each kind is warned about, never the
   * values. With `identity_unavailable` when it was redacted by shape alone, the identity unread.
   */
  async function redacted(task: AiTask, candidateId: string | null, texts: string[]): Promise<{ redaction: Redaction; warnings: AiWarning[] }> {
    const { identity, warning } = candidateId === null ? { identity: null } : await identityFor(candidateId, task);
    const redaction = redactIdentity(texts, identity);
    if (redaction.redacted) warn("Identity redacted before the AI call", { task, candidateId, redacted: redaction.counts });
    return { redaction, warnings: warning ? [warning] : [] };
  }

  /**
   * The identity route when the call carries the Candidate's identity and they gave EU AI consent; else the task's route.
   * A call that does not declare identity is still scanned for a phone number or email address: a hit
   * counts as identity and is logged (never the prompt itself), so the call site can be fixed.
   */
  async function routeForCall(request: GenerateRequest, messages: Message[]): Promise<{ route: Route; identity: boolean; warning?: AiWarning }> {
    const { candidateId, task } = request;
    const byTask = () => ({ route: request.route ?? routeFor(task), identity: false });
    if (candidateId === null || !options.euAiConsent) return byTask();
    const undeclared = request.containsIdentity ? [] : findIdentity([request.system ?? "", ...messages.map((m) => m.content)]);
    if (!request.containsIdentity && undeclared.length === 0) return byTask();
    if (!(await options.euAiConsent(candidateId))) return byTask();
    if (undeclared.length === 0) return { route: identityRoute, identity: true };
    warn("Undeclared identity in an AI call: routed as identity-bearing", { task, candidateId, found: undeclared });
    return { route: identityRoute, identity: true, warning: { reason: "identity_undeclared", detail: `found: ${undeclared.join(", ")}` } };
  }

  /** What is known of the Candidate's identity; none for a Guest. Never fails. */
  const identityOrNone = async (task: AiTask, candidateId: string | null) => (candidateId === null ? null : (await identityFor(candidateId, task)).identity);

  /** The Failure Reason of `error` (ADR-0030), its technical message redacted with what is known of the Candidate. Never fails. */
  const failureWith = (error: unknown, identity: CandidateIdentity | null): Failure =>
    failureOf(error, { redact: (text) => redactIdentity([text], identity).texts[0] ?? text });

  /**
   * The warnings as recorded (#260): each detail scrubbed of keys, redacted by shape and cut, as a technical
   * message is; `fallback`, when given, last.
   */
  const recordable = (warnings: readonly AiWarning[], fallback?: AiWarning): AiWarning[] =>
    [...warnings, ...(fallback ? [fallback] : [])].map(({ reason, detail }) => ({
      reason,
      ...(detail === undefined ? {} : { detail: cleanTechnicalMessage(detail, { redact: (text) => redactIdentity([text], null).texts[0] ?? text }) }),
    }));

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
   * search uses the `web_search` tool once unless the provider says otherwise. `notes`: what its feature says of it (#260).
   * Once `signal` aborts, the call rejects with its reason, recorded with Failure Reason `stopped` (#325); one
   * aborted before it left is not sent.
   */
  async function recorded<T extends { model: string; usage: TokenUsage; tools?: ToolCall[] }>(
    entry: Pick<UsageEntry, "candidateId" | "task">,
    provider: AiProvider,
    route: Route,
    said: Omit<Transcript, "reply">,
    call: () => Promise<T>,
    replyOf: (output: T) => string,
    notes: CallNotes<T>,
    signal?: AbortSignal,
  ): Promise<{ output: T } & CallFacts> {
    const base = { ...entry, provider: provider.id, endpoint: provider.endpoint };
    const search = entry.task === SEARCH_TASK;
    const started = clock();
    let left = false;
    let output: T;
    try {
      signal?.throwIfAborted();
      left = true;
      output = await call();
    } catch (error) {
      const durationMs = left ? Math.round(clock() - started) : 0;
      // A key or a residency rule missing inside the provider (the identity route's stand-in): nothing left.
      const sent = left && !(error instanceof AiConfigError || error instanceof DataResidencyError);
      const stopped = signal?.aborted === true;
      const failure = failureWith(error, await identityOrNone(entry.task, entry.candidateId));
      const { technical } = failure;
      const reason = stopped ? "stopped" : failure.reason;
      const tools = search && sent ? [{ name: "web_search", count: 1, ok: false, durationMs, costEur: 0 }] : [];
      const warnings = recordable(notes.warnings(), notes.fallback ? { reason: notes.fallback } : undefined);
      log({
        ...base,
        model: route.model ?? provider.defaultModel ?? provider.id,
        inputTokens: 0,
        outputTokens: 0,
        outcome: "failed",
        reason,
        technicalReason: technical,
        ...(warnings.length > 0 ? { warnings } : {}),
        sent,
        durationMs,
        costEur: 0,
        tools,
        transcript: { ...said, reply: null },
      });
      throw stopped ? signal.reason : error;
    }
    const durationMs = Math.round(clock() - started);
    const called = output.tools ?? (search ? [{ name: "web_search", count: 1 }] : []);
    const priced = { provider: provider.id, model: output.model };
    const warnings = recordable(notes.warnings(), unusableReply(notes, output) ?? undefined);
    const outcome = warnings[0] ? "warning" : "ok";
    log({
      ...base,
      model: output.model,
      ...output.usage,
      ...(warnings[0] ? { outcome, reason: warnings[0].reason, warnings } : { outcome }),
      sent: true,
      durationMs,
      costEur: costInEur({ ...priced, usage: output.usage }),
      tools: called.map((tool) => ({ name: tool.name, count: tool.count, ok: tool.ok ?? true, durationMs, costEur: toolCostInEur(priced, tool) })),
      transcript: { ...said, reply: replyOf(output) },
    });
    return { output, endpoint: provider.endpoint, durationMs, outcome };
  }

  /** The warning of an `output` its feature cannot use (`CallNotes.unusable`), or null; a check that throws refuses it. */
  function unusableReply<T>(notes: CallNotes<T>, output: T): AiWarning | null {
    if (!notes.unusable) return null;
    try {
      return notes.unusable(output);
    } catch (error) {
      return { reason: notes.fallback ?? "invalid_reply", detail: `the reply could not be checked (${error instanceof Error ? error.name : "unknown"})` };
    }
  }

  /**
   * Records a call stopped before it was sent (ADR-0030): failed, not sent, no tokens nor cost, with what it would
   * have said, redacted. Its provider and model are what was chosen, else its task's configured route. Never fails:
   * the caller then throws `error`.
   */
  async function notSent(
    error: unknown,
    entry: Pick<UsageEntry, "candidateId" | "task">,
    chosen: { route?: Route; provider?: AiProvider },
    said: Omit<Transcript, "reply">,
    notes: Omit<CallNotes<never>, "unusable"> = { warnings: () => [] },
  ): Promise<void> {
    try {
      const configured = options.routes[entry.task];
      const route = chosen.route ?? (typeof configured === "string" ? { provider: configured } : configured);
      const identity = await identityOrNone(entry.task, entry.candidateId);
      const [system = "", ...contents] = redactIdentity([said.system ?? "", ...said.messages.map((message) => message.content)], identity).texts;
      const { reason, technical } = failureWith(error, identity);
      const warnings = recordable(notes.warnings(), notes.fallback ? { reason: notes.fallback } : undefined);
      log({
        ...entry,
        provider: chosen.provider?.id ?? route?.provider ?? null,
        endpoint: chosen.provider?.endpoint ?? null,
        model: route?.model ?? chosen.provider?.defaultModel ?? null,
        inputTokens: 0,
        outputTokens: 0,
        outcome: "failed",
        reason,
        technicalReason: technical,
        ...(warnings.length > 0 ? { warnings } : {}),
        sent: false,
        durationMs: 0,
        costEur: 0,
        tools: [],
        transcript: { ...(said.system === undefined ? {} : { system }), messages: said.messages.map((message, index) => ({ role: message.role, content: contents[index] ?? "" })), reply: null },
      });
    } catch (failure) {
      warn("AI usage not recorded", { task: entry.task, error: failure instanceof Error ? failure.message : String(failure) });
    }
  }

  /** The configured web-search route, or `override` (a task Playbook's): either must name a provider that searches. */
  const searchProvider = (override?: Route): { route: Route; provider: AiProvider } => {
    const route = override ?? routeFor(SEARCH_TASK);
    const provider = providerFor(route);
    if (!provider.search) throw new AiConfigError(`AI provider "${provider.id}" cannot search the web`);
    return { route, provider };
  };

  /**
   * `query` must be built by search-query.ts: nothing else ever reaches the search provider, and it is redacted too.
   * `override`: a task Playbook's web-search route; `warnings` and `fallback`: what its feature says of it (#260).
   */
  async function search({
    candidateId,
    query,
    filters,
    page,
    override,
    warnings = [],
    fallback,
    signal,
  }: {
    candidateId: string | null;
    query: string;
    filters?: SearchFilters;
    page?: number;
    override?: Route;
    warnings?: AiWarning[];
    fallback?: FailureReason;
    signal?: AbortSignal;
  }): Promise<SearchResult> {
    const fed = { warnings: () => warnings, ...(fallback ? { fallback } : {}) };
    let chosen: { route: Route; provider: AiProvider };
    try {
      // A filter names websites, a time window and a country (ADR-0007): a country is a code, never free text.
      if (filters?.country !== undefined && !COUNTRY_CODE.test(filters.country)) {
        throw new DataResidencyError("A web search's country filter must be a two-letter country code (ISO 3166-1 alpha-2)");
      }
      chosen = searchProvider(override);
    } catch (error) {
      await notSent(error, { candidateId, task: SEARCH_TASK }, { route: override }, { messages: [{ role: "user", content: query }] }, fed);
      throw error;
    }
    const { route, provider } = chosen;
    const { redaction, warnings: redactionWarnings } = await redacted(SEARCH_TASK, candidateId, [query]);
    const [sent = ""] = redaction.texts;
    const { output, ...facts } = await recorded(
      { candidateId, task: SEARCH_TASK },
      provider,
      route,
      { messages: [{ role: "user", content: sent }] },
      () => provider.search!(sent, { model: route.model, filters, ...(page && page > 1 ? { page } : {}), ...(signal ? { signal } : {}) }),
      (answer) => answer.answer,
      { ...fed, warnings: () => [...warnings, ...redactionWarnings] },
      signal,
    );
    return {
      answer: output.answer,
      sources: output.sources,
      ...(output.sourceDates ? { sourceDates: output.sourceDates } : {}),
      provider: provider.id,
      model: output.model,
      usage: output.usage,
      ...facts,
    };
  }

  /** One text call, recorded in AI Usage as `recordedAs` (its own task, or `eval` for an Eval Run). */
  async function generateAs(request: GenerateRequest, recordedAs: TextTask): Promise<GenerateResult> {
    const messages = typeof request.prompt === "string" ? [{ role: "user" as const, content: request.prompt }] : request.prompt;
    const chosen: { route?: Route; provider?: AiProvider } = { route: request.route };
    // What the feature says of the call (#260), its own warnings first, then the AI layer's.
    const warnings: AiWarning[] = [];
    const notes: CallNotes<TextOutput> = {
      warnings: () => [...(request.warnings ?? []), ...warnings],
      ...(request.fallback ? { fallback: request.fallback } : {}),
    };
    let identity: boolean;
    try {
      // Routed on what the call says (the identity scan), then redacted: what leaves is never the Candidate's identity.
      let undeclared: AiWarning | undefined;
      ({ route: chosen.route, identity, warning: undeclared } = await routeForCall(request, messages));
      if (undeclared) warnings.push(undeclared);
      chosen.provider = providerFor(chosen.route, identity || TEXT_TASKS[request.task].personalData);
      // Checked again per call: the rule must hold even if a provider changes at runtime.
      assertAllowed(request.task, chosen.provider, identity);
    } catch (error) {
      await notSent(error, { candidateId: request.candidateId, task: recordedAs }, chosen, { ...(request.system === undefined ? {} : { system: request.system }), messages }, notes);
      throw error;
    }
    const { route, provider } = chosen as { route: Route; provider: AiProvider };
    const { redaction, warnings: redactionWarnings } = await redacted(request.task, request.candidateId, [request.system ?? "", ...messages.map((message) => message.content)]);
    warnings.push(...redactionWarnings);
    const unusable = request.unusable;
    if (unusable) notes.unusable = (output) => unusable(redaction.restore(output.text));
    const [redactedSystem = "", ...contents] = redaction.texts;
    // The model is told to keep the placeholders as they are, so they can be put back in its reply.
    const system = redaction.redacted ? [redactedSystem, REDACTION_NOTE].filter(Boolean).join("\n\n") : request.system;
    const sent = messages.map((message, index) => ({ ...message, content: contents[index] ?? "" }));
    const { output, ...facts } = await recorded(
      { candidateId: request.candidateId, task: recordedAs },
      provider,
      route,
      // The AI Message Log keeps what was sent, redacted, and the reply as it came, placeholders and all.
      { ...(system === undefined ? {} : { system }), messages: sent },
      () =>
        provider.generate!({
          model: route.model,
          system,
          messages: sent,
          maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.effort ? { effort: request.effort } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
        }),
      (reply) => reply.text,
      notes,
      request.signal,
    );
    return { text: redaction.restore(output.text), provider: provider.id, model: output.model, usage: output.usage, ...facts, ...(identity ? { euAiConsent: true as const } : {}) };
  }

  const layer: AiLayer = {
    generate: (request) => generateAs(request, request.task),

    async planJobSearch({ candidateId, criteria, instructions, route }) {
      const pages = Math.max(1, searchProvider(route).provider.searchPages ?? 1);
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
          ...(titles?.warnings ? { warnings: titles.warnings } : {}),
          fallback: "job_titles_unavailable",
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
      return search({
        candidateId: request.candidateId,
        query: buildSearchQuery(request.criteria, request.query, request.location ?? request.criteria.locations[0], request.industries),
        ...(request.filters ? { filters: request.filters } : {}),
        ...(request.page ? { page: request.page } : {}),
        ...(request.route ? { override: request.route } : {}),
        ...(request.warnings ? { warnings: request.warnings } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },

    async searchCompany(request) {
      return search({
        candidateId: request.candidateId,
        query: buildCompanyQuery(request.employer, request.instructions),
        ...(request.route ? { override: request.route } : {}),
        ...(request.warnings ? { warnings: request.warnings } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },

    async searchCompanyNews(request) {
      return (await layer.searchCompanyNewsWithCall(request)).articles;
    },

    async searchCompanyNewsWithCall(request) {
      try {
        const found = await search({
          candidateId: request.candidateId,
          query: buildCompanyNewsQuery(request),
          filters: { maxAgeDays: COMPANY_NEWS_MAX_AGE_DAYS },
          ...(request.route ? { override: request.route } : {}),
          ...(request.warnings ? { warnings: request.warnings } : {}),
          fallback: "company_news_unavailable",
          ...(request.signal ? { signal: request.signal } : {}),
        });
        const companyNames = [request.employer, request.registeredName ?? "", request.website ?? ""].filter(Boolean);
        const articles = companyNewsIn(found.answer, { now: now(), companyNames, ...(found.sourceDates ? { sourceDates: found.sourceDates } : {}) });
        return { articles, call: found };
      } catch (error) {
        // Stopped: the Company Dossier is not built at all.
        if (request.signal?.aborted) throw error;
        warn("Company News unavailable: the Company Dossier is built without it", {
          candidateId: request.candidateId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { articles: [], call: null };
      }
    },

    agentModels() {
      return modelChoices((provider) => Boolean(provider.generate), [...Object.entries(options.routes).filter(([task]) => task !== SEARCH_TASK).map(([, route]) => route), identityRoute]);
    },

    searchModels() {
      return modelChoices((provider) => Boolean(provider.search), [options.routes[SEARCH_TASK]]);
    },

    forEval: () => evalLayer,
  };
  const noSearch = async (): Promise<never> => {
    const error = new AiConfigError("An Eval Run makes no web search");
    await notSent(error, { candidateId: null, task: SEARCH_TASK }, {}, { messages: [] });
    throw error;
  };
  const evalLayer: AiLayer = {
    generate: (request) => generateAs({ ...request, candidateId: null }, "eval"),
    planJobSearch: noSearch,
    searchWeb: noSearch,
    searchCompany: noSearch,
    searchCompanyNews: noSearch,
    searchCompanyNewsWithCall: noSearch,
    agentModels: () => layer.agentModels(),
    searchModels: () => layer.searchModels(),
    forEval: () => evalLayer,
  };

  /**
   * The providers `serves` keeps, one choice each whatever its endpoints, with the models a route in
   * `routed` names for it, then those its endpoints offer; each model with where the endpoint serving
   * it processes data. A provider standing for a missing key offers nothing.
   */
  function modelChoices(serves: (provider: AiProvider) => boolean, routed: (ProviderId | Route | undefined)[]): AgentModelChoice[] {
    const routes = routed.flatMap((route) => (route === undefined ? [] : [typeof route === "string" ? { provider: route } : route]));
    const choices: AgentModelChoice[] = [];
    for (const id of new Set(options.providers.filter(serves).map((provider) => provider.id))) {
      const endpoints = options.providers.filter((provider) => provider.id === id && serves(provider));
      const named = routes.flatMap((route) => (route.provider === id && route.model ? [route.model] : []));
      const offered = endpoints.flatMap((provider) => provider.models ?? (provider.defaultModel ? [provider.defaultModel] : []));
      const models = [...new Set([...named, ...offered])];
      if (models.length === 0) continue;
      const main = endpoints.find((provider) => provider.residency === "eu") ?? endpoints[0]!;
      choices.push({
        provider: id,
        endpoint: [...new Set(endpoints.map((provider) => provider.endpoint))].join(", "),
        residency: main.residency,
        ...(main.defaultModel ? { defaultModel: main.defaultModel } : {}),
        models: models.map((model) => ({ model, effort: effortHandling(id, model), residency: (endpoints.find((provider) => provider.models?.includes(model)) ?? main).residency })),
      });
    }
    return choices;
  }
  return layer;
}
