import { createAiLayer, endpointFor, type AiLayer, type Route } from "./ai-layer";
import { pricesFromEnv } from "./cost";
import { AiConfigError } from "./errors";
import { createAnthropicProvider, type AnthropicEndpoint } from "./providers/anthropic";
import { createMistralProvider, createOpenAiProvider } from "./providers/chat-completions";
import { BRAVE_MAX_PAGES, createBraveProvider } from "./providers/brave";
import { createPerplexityProvider, PERPLEXITY_MAX_QUERIES, PERPLEXITY_SEARCH_TYPES } from "./providers/perplexity";
import { createTavilyProvider, TAVILY_DEPTHS } from "./providers/tavily";
import type { CandidateIdentity } from "./redaction";
import { createFakeProvider } from "./testing";
import { PROVIDER_IDS, SEARCH_TASK, TEXT_TASKS, type AiProvider, type AiTask, type ProviderId, type TextTask, type UsageLog } from "./types";
import { createConsoleUsageLog } from "./usage";

type Env = Record<string, string | undefined>;

const TASKS: AiTask[] = [...(Object.keys(TEXT_TASKS) as AiTask[]), SEARCH_TASK];
const DEFAULT_PROVIDER: Record<Exclude<AiTask, keyof typeof DEFAULT_TASK>, ProviderId> = {
  scoring: "anthropic",
  writing: "anthropic",
  coaching: "anthropic",
  cv_parsing: "anthropic",
  offer_analysis: "anthropic",
  web_search: "perplexity",
};
/**
 * A task whose provider is not set takes another task's provider, and its model unless one is set:
 * job titles are public text, like Job Offers; the Back Office Assistant is a coach, for Administrators;
 * Guardrails check what the AI Coach reads and writes (ADR-0022); the AI judge of Eval Runs reads the AI Coach's replies (ADR-0023).
 */
const DEFAULT_TASK = { job_titles: "offer_analysis", back_office_assistant: "coaching", guardrail: "coaching", eval: "coaching" } as const satisfies Partial<Record<AiTask, AiTask>>;

const taskKey = (task: AiTask, suffix: "PROVIDER" | "MODEL") => `AI_${task.toUpperCase()}_${suffix}`;

const ANTHROPIC_ENDPOINTS = ["auto", "bedrock", "vertex", "direct"] as const;
/** The Search providers (ADR-0043): what web search and its fallback may name. */
export const SEARCH_PROVIDER_IDS = ["perplexity", "brave", "tavily"] as const satisfies readonly ProviderId[];
/** The fallback Search provider's setting, and its value for none. */
const FALLBACK_SETTING = "AI_WEB_SEARCH_FALLBACK_PROVIDER";
const NO_FALLBACK = "none";
const FALLBACK_CHOICES = [NO_FALLBACK, ...SEARCH_PROVIDER_IDS] as const;
const OPENAI_DATA_RESIDENCIES = ["eu", "us"] as const;

/** The code's defaults of the AI layer's settings that are not keys: what it uses when env sets nothing. */
const DEFAULTS = {
  ANTHROPIC_ENDPOINT: "auto",
  BEDROCK_REGION: "eu-north-1",
  VERTEX_REGION: "europe-west1",
  OPENAI_DATA_RESIDENCY: "eu",
  // No fallback until one is chosen (ADR-0043).
  AI_WEB_SEARCH_FALLBACK_PROVIDER: NO_FALLBACK,
  PERPLEXITY_SEARCH_TYPE: "fast",
  PERPLEXITY_QUERIES_PER_CALL: String(PERPLEXITY_MAX_QUERIES),
  BRAVE_MAX_PAGES: String(BRAVE_MAX_PAGES),
  TAVILY_SEARCH_DEPTH: "basic",
} as const;

/**
 * Each Search provider's typed settings (#398), which replace AI_WEB_SEARCH_MODEL: the search type or depth a
 * route naming none gets, and how many queries a call carries or pages a query is given.
 */
const SEARCH_PROVIDER_SETTINGS = [
  { name: "PERPLEXITY_SEARCH_TYPE", default: DEFAULTS.PERPLEXITY_SEARCH_TYPE, values: PERPLEXITY_SEARCH_TYPES },
  { name: "PERPLEXITY_QUERIES_PER_CALL", default: DEFAULTS.PERPLEXITY_QUERIES_PER_CALL, range: { min: 1, max: PERPLEXITY_MAX_QUERIES } },
  { name: "BRAVE_MAX_PAGES", default: DEFAULTS.BRAVE_MAX_PAGES, range: { min: 1, max: BRAVE_MAX_PAGES } },
  { name: "TAVILY_SEARCH_DEPTH", default: DEFAULTS.TAVILY_SEARCH_DEPTH, values: TAVILY_DEPTHS },
] as const;

/** What AI_WEB_SEARCH_MODEL may still name, per Search provider, and the setting that replaces it. */
const LEGACY_SEARCH_MODELS: Partial<Record<ProviderId, { models: readonly string[]; setting?: string }>> = {
  perplexity: { models: PERPLEXITY_SEARCH_TYPES, setting: "PERPLEXITY_SEARCH_TYPE" },
  brave: { models: ["web"] },
  tavily: { models: TAVILY_DEPTHS, setting: "TAVILY_SEARCH_DEPTH" },
};

/**
 * The AI layer's routing settings (ADR-0033's Platform Settings for AI routing): each with its code default
 * (empty: the code sets nothing, e.g. a model left to its provider's default, or a task taking another
 * task's provider) and, for a choice, the values env may hold. The keys and AI_FAKE are not among them.
 */
export const AI_ROUTING_SETTINGS: ReadonlyArray<{ name: string; default: string; values?: readonly string[]; range?: { min: number; max: number } }> = [
  { name: "ANTHROPIC_ENDPOINT", default: DEFAULTS.ANTHROPIC_ENDPOINT, values: ANTHROPIC_ENDPOINTS },
  { name: "BEDROCK_REGION", default: DEFAULTS.BEDROCK_REGION },
  { name: "VERTEX_REGION", default: DEFAULTS.VERTEX_REGION },
  { name: "VERTEX_PROJECT_ID", default: "" },
  { name: "OPENAI_DATA_RESIDENCY", default: DEFAULTS.OPENAI_DATA_RESIDENCY, values: OPENAI_DATA_RESIDENCIES },
  ...TASKS.flatMap((task) => [
    { name: taskKey(task, "PROVIDER"), default: task in DEFAULT_TASK ? "" : DEFAULT_PROVIDER[task as keyof typeof DEFAULT_PROVIDER], values: PROVIDER_IDS },
    { name: taskKey(task, "MODEL"), default: "" },
  ]),
  { name: "AI_IDENTITY_MODEL", default: "" },
  { name: FALLBACK_SETTING, default: DEFAULTS.AI_WEB_SEARCH_FALLBACK_PROVIDER, values: FALLBACK_CHOICES },
  ...SEARCH_PROVIDER_SETTINGS,
];

/** Every environment variable the AI layer reads. `.env.example` must list them all. */
export const AI_ENV_KEYS = [
  "AI_FAKE",
  "AI_IDENTITY_MODEL",
  "AI_WEB_SEARCH_FALLBACK_PROVIDER",
  ...SEARCH_PROVIDER_SETTINGS.map((setting) => setting.name),
  ...TASKS.flatMap((task) => [taskKey(task, "PROVIDER"), taskKey(task, "MODEL")]),
  "ANTHROPIC_ENDPOINT",
  "ANTHROPIC_API_KEY",
  "BEDROCK_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
  "VERTEX_REGION",
  "VERTEX_PROJECT_ID",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_DATA_RESIDENCY",
  "PERPLEXITY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "TAVILY_API_KEY",
] as const;

export interface AiLayerDeps {
  fetch?: typeof globalThis.fetch;
  /** Default: one JSON line per call on stdout. */
  usage?: UsageLog;
  /**
   * Whether the Candidate gave EU AI consent (ADR-0007 amendment). With it, their identity-bearing
   * calls go to Mistral (AI_IDENTITY_MODEL). Without this lookup, no Candidate has consented.
   */
  euAiConsent?: (candidateId: string) => Promise<boolean>;
  /**
   * What is known of the Candidate's identity, taken out of each of their AI calls (redaction.ts). Without
   * it, only email addresses and phone numbers are, by their shape. Must not throw (a failure is only warned about).
   */
  identityOf?: (candidateId: string) => Promise<CandidateIdentity | null>;
  /**
   * A text task routed to a provider whose key is missing: true starts the layer all the same, that task's calls failing
   * as key_missing, so a route chosen on Paramètres before its key is entered warns and never blocks (ADR-0042); default
   * false: start-up stops, naming the key. The Search provider's key is not concerned.
   */
  tolerateMissingKeys?: boolean;
}

/** Whether `error` says a provider's key is missing (an API key or token, not a setting such as VERTEX_PROJECT_ID). */
const isMissingKey = (error: unknown): error is AiConfigError =>
  error instanceof AiConfigError && error.reason === "key_missing" && /Missing environment variable \w+(_API_KEY|_TOKEN_\w+)\b/.test(error.message);

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new AiConfigError(`Missing environment variable ${key}`, { reason: "key_missing" });
  return value;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const value = env[key]?.trim() || fallback;
  if (!allowed.includes(value as T)) throw new AiConfigError(`${key} must be one of ${allowed.join(", ")} (got "${value}")`);
  return value as T;
}

/** A whole number from `min` to `max`, else `fallback` when env sets none. */
function wholeIn(env: Env, key: string, min: number, max: number, fallback: string): number {
  const value = env[key]?.trim() || fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new AiConfigError(`${key} must be a whole number from ${min} to ${max} (got "${value}")`);
  return number;
}

/**
 * Where Claude is reached (ANTHROPIC_ENDPOINT). `auto`, the default, follows the keys entered:
 * the direct API with ANTHROPIC_API_KEY, Bedrock with AWS_BEARER_TOKEN_BEDROCK, both with both
 * keys, and Bedrock through the AWS credential chain (e.g. the ECS task role) with neither.
 * The direct API comes first: with both, tasks without personal data use it (ai-layer.ts).
 * `bedrock` or `vertex` (an older .env's setting) keeps every task on that endpoint, and an
 * ANTHROPIC_API_KEY entered adds the direct API after it: only a route naming one of its models
 * (a Playbook Agent's, offered outside the EU) reaches it.
 */
function anthropicEndpoints(env: Env): AnthropicEndpoint[] {
  const bedrock = (): AnthropicEndpoint => ({ kind: "bedrock", region: env.BEDROCK_REGION?.trim() || DEFAULTS.BEDROCK_REGION, apiKey: env.AWS_BEARER_TOKEN_BEDROCK?.trim() || undefined });
  const directKey = env.ANTHROPIC_API_KEY?.trim();
  const andDirect = (endpoint: AnthropicEndpoint): AnthropicEndpoint[] => (directKey ? [endpoint, { kind: "direct", apiKey: directKey }] : [endpoint]);
  switch (oneOf(env, "ANTHROPIC_ENDPOINT", ANTHROPIC_ENDPOINTS, DEFAULTS.ANTHROPIC_ENDPOINT)) {
    case "direct":
      return [{ kind: "direct", apiKey: required(env, "ANTHROPIC_API_KEY") }];
    case "vertex":
      return andDirect({ kind: "vertex", region: env.VERTEX_REGION?.trim() || DEFAULTS.VERTEX_REGION, projectId: required(env, "VERTEX_PROJECT_ID") });
    case "bedrock":
      return andDirect(bedrock());
    case "auto": {
      const endpoints: AnthropicEndpoint[] = directKey ? [{ kind: "direct", apiKey: directKey }] : [];
      if (!directKey || env.AWS_BEARER_TOKEN_BEDROCK?.trim()) endpoints.push(bedrock());
      return endpoints;
    }
  }
}

/** Whether Claude is reached through an EU-resident endpoint, so it is the default for tasks with personal data. */
function anthropicInEu(env: Env): boolean {
  const kind = oneOf(env, "ANTHROPIC_ENDPOINT", ANTHROPIC_ENDPOINTS, DEFAULTS.ANTHROPIC_ENDPOINT);
  if (kind === "auto") return !env.ANTHROPIC_API_KEY?.trim() || Boolean(env.AWS_BEARER_TOKEN_BEDROCK?.trim());
  return kind !== "direct";
}

/** `maxRetries`: Claude's SDK retries (default 2); a test call makes none, so a transient fault is not read as a pass. */
function buildProviders(id: ProviderId, env: Env, fetch: typeof globalThis.fetch | undefined, maxRetries?: number): AiProvider[] {
  if (id === "anthropic") return anthropicEndpoints(env).map((endpoint) => createAnthropicProvider({ endpoint, fetch, ...(maxRetries === undefined ? {} : { maxRetries }) }));
  return [buildProvider(id, env, fetch)];
}

function buildProvider(id: Exclude<ProviderId, "anthropic">, env: Env, fetch: typeof globalThis.fetch | undefined): AiProvider {
  switch (id) {
    case "mistral":
      return createMistralProvider({ apiKey: required(env, "MISTRAL_API_KEY"), fetch });
    case "openai":
      return createOpenAiProvider({
        apiKey: required(env, "OPENAI_API_KEY"),
        dataResidency: oneOf(env, "OPENAI_DATA_RESIDENCY", OPENAI_DATA_RESIDENCIES, DEFAULTS.OPENAI_DATA_RESIDENCY),
        fetch,
      });
    case "perplexity":
      return createPerplexityProvider({
        apiKey: required(env, "PERPLEXITY_API_KEY"),
        searchType: oneOf(env, "PERPLEXITY_SEARCH_TYPE", PERPLEXITY_SEARCH_TYPES, DEFAULTS.PERPLEXITY_SEARCH_TYPE),
        queriesPerCall: wholeIn(env, "PERPLEXITY_QUERIES_PER_CALL", 1, PERPLEXITY_MAX_QUERIES, DEFAULTS.PERPLEXITY_QUERIES_PER_CALL),
        fetch,
      });
    case "brave":
      return createBraveProvider({ apiKey: required(env, "BRAVE_SEARCH_API_KEY"), maxPages: wholeIn(env, "BRAVE_MAX_PAGES", 1, BRAVE_MAX_PAGES, DEFAULTS.BRAVE_MAX_PAGES), fetch });
    case "tavily":
      return createTavilyProvider({ apiKey: required(env, "TAVILY_API_KEY"), depth: oneOf(env, "TAVILY_SEARCH_DEPTH", TAVILY_DEPTHS, DEFAULTS.TAVILY_SEARCH_DEPTH), fetch });
  }
}

const IDENTITY_PROVIDER = "mistral" satisfies ProviderId;

/**
 * Mistral for identity-bearing calls. Its key is not required to start: without it, such a call
 * fails (naming the key) instead of going to another provider, and every other call still works.
 */
function identityProvider(env: Env, fake: boolean, fetch: typeof globalThis.fetch | undefined): AiProvider {
  if (fake) return createFakeProvider({ id: IDENTITY_PROVIDER });
  if (env.MISTRAL_API_KEY?.trim()) return buildProvider(IDENTITY_PROVIDER, env, fetch);
  return {
    id: IDENTITY_PROVIDER,
    endpoint: "mistral (not configured)",
    residency: "eu",
    generate: async () => {
      throw new AiConfigError("Missing environment variable MISTRAL_API_KEY: needed for identity-bearing AI calls of Candidates with EU AI consent", { reason: "key_missing" });
    },
  };
}

/**
 * The model AI_WEB_SEARCH_MODEL names for the web search route, read for one more release (#398): kept when the
 * provider offers it and its own typed setting is not set, else dropped. `notice`: what to tell whoever runs it.
 */
function legacySearchModel(env: Env, provider: ProviderId): { model?: string; notice?: string } {
  const model = env[taskKey(SEARCH_TASK, "MODEL")]?.trim();
  if (!model) return {};
  const legacy = LEGACY_SEARCH_MODELS[provider];
  if (!legacy?.models.includes(model)) {
    return { notice: `AI_WEB_SEARCH_MODEL="${model}" is ignored: ${provider} offers ${legacy?.models.join(", ") ?? "no such choice"}; AI_WEB_SEARCH_MODEL will no longer be read after this release` };
  }
  const replacedBy = legacy.setting ? ` (use ${legacy.setting})` : "";
  if (legacy.setting && env[legacy.setting]?.trim()) {
    return { notice: `AI_WEB_SEARCH_MODEL is ignored: ${legacy.setting} is set, and AI_WEB_SEARCH_MODEL will no longer be read after this release` };
  }
  return { model, notice: `AI_WEB_SEARCH_MODEL is read for one more release${replacedBy}` };
}

/**
 * The fallback Search provider (AI_WEB_SEARCH_FALLBACK_PROVIDER): none with "none", and none when the default
 * names the active one. Set to the active one, or to anything but a Search provider, it is refused.
 */
function searchFallbackFromEnv(env: Env, active: ProviderId): ProviderId | undefined {
  const chosen = oneOf(env, FALLBACK_SETTING, FALLBACK_CHOICES, DEFAULTS.AI_WEB_SEARCH_FALLBACK_PROVIDER);
  if (chosen === NO_FALLBACK) return undefined;
  if (chosen !== active) return chosen;
  if (env[FALLBACK_SETTING]?.trim()) throw new AiConfigError(`${FALLBACK_SETTING} must not be the active Search provider (${active})`);
  return undefined;
}

/** Which provider (and model, when set) serves each task: AI_<TASK>_PROVIDER and AI_<TASK>_MODEL, else the defaults. */
function routesFromEnv(env: Env, fake: boolean): Record<AiTask, Route> {
  // Claude reached only outside the EU (the direct API): tasks with personal data default to Mistral, a
  // preference for an EU endpoint where nothing is configured. AI_<TASK>_PROVIDER may name any provider.
  const personalFallback = !fake && !anthropicInEu(env);
  const defaultProvider = (task: keyof typeof DEFAULT_PROVIDER): ProviderId => {
    const provider = DEFAULT_PROVIDER[task];
    return provider === "anthropic" && personalFallback && TEXT_TASKS[task as TextTask]?.personalData ? IDENTITY_PROVIDER : provider;
  };
  const routes: Partial<Record<AiTask, Route>> = {};
  const routeOf = (provider: ProviderId, model: string | undefined): Route => (model ? { provider, model } : { provider });
  for (const task of TASKS) {
    if (task in DEFAULT_TASK) continue;
    const provider = oneOf(env, taskKey(task, "PROVIDER"), PROVIDER_IDS, defaultProvider(task as keyof typeof DEFAULT_PROVIDER));
    // The web search's model is its provider's typed setting now (#398); the old setting is still read for one release.
    const model = task === SEARCH_TASK ? legacySearchModel(env, provider).model : env[taskKey(task, "MODEL")]?.trim() || undefined;
    routes[task] = routeOf(provider, model);
  }
  for (const [task, fallback] of Object.entries(DEFAULT_TASK) as [AiTask, AiTask][]) {
    const inherited = routes[fallback]!;
    const provider = oneOf(env, taskKey(task, "PROVIDER"), PROVIDER_IDS, inherited.provider);
    routes[task] = routeOf(provider, env[taskKey(task, "MODEL")]?.trim() || (provider === inherited.provider ? inherited.model : undefined));
  }
  return routes as Record<AiTask, Route>;
}

/**
 * The provider and model (when one is set) a task is routed to by the environment, without building
 * the AI layer nor needing its keys: e.g. the AI Coach's (`coaching`), which Playbook Agents start from (#225).
 */
export function taskRouteFromEnv(env: Env, task: AiTask): Route {
  return routesFromEnv(env, env.AI_FAKE?.trim() === "true")[task];
}

/**
 * The smallest model `provider` offers through the endpoint `env` reaches it by: the last of its models, which
 * each text provider lists largest first (claude-haiku, mistral-small, gpt-5-mini). What a Playbook Agent that
 * only reads a few pages runs on by default (#405). Undefined when it cannot be told here (its key missing, a
 * provider offering a single model, fakes): its default model is then the one used.
 */
export function smallModelFromEnv(env: Env, provider: ProviderId): string | undefined {
  if (env.AI_FAKE?.trim() === "true") return undefined;
  try {
    const [endpoint] = buildProviders(provider, env, undefined);
    const models = endpoint?.generate ? (endpoint.models ?? []) : [];
    return models.length > 1 ? models.at(-1) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The provider whose model each model setting names, as `env` routes it, without needing any key:
 * AI_<TASK>_MODEL its task's provider, AI_IDENTITY_MODEL Mistral's. What Paramètres offers known models by (#301).
 */
export function modelSettingProviders(env: Env): Record<string, ProviderId> {
  const routes = routesFromEnv(env, env.AI_FAKE?.trim() === "true");
  return { ...Object.fromEntries(TASKS.map((task) => [taskKey(task, "MODEL"), routes[task].provider])), AI_IDENTITY_MODEL: IDENTITY_PROVIDER };
}

/** One AI route as the environment sets it: a task's, or the identity route under EU AI consent. */
export interface RoutedTarget {
  target: AiTask | "identity";
  /** The settings naming its provider and its model (the identity route's provider is fixed: Mistral). */
  providerSetting: string;
  modelSetting: string;
  route: Route;
  /** Whether its calls carry personal data: a text task's, or the identity route's. */
  personalData: boolean;
  /** The endpoint it reaches, as the AI layer chooses it; none when its provider cannot be built (a key missing). */
  endpoint?: AiProvider;
}

/**
 * Every AI route `env` sets, with the endpoint each reaches, built as `createAiLayerFromEnv` builds them
 * (fakes under AI_FAKE). A provider that cannot be built leaves its routes without an endpoint; a value
 * a setting refuses (an unknown provider) throws, as at start-up.
 */
export function routedTargets(env: Env, deps: { fetch?: typeof globalThis.fetch; maxRetries?: number } = {}): RoutedTarget[] {
  const fake = env.AI_FAKE?.trim() === "true";
  const routes = routesFromEnv(env, fake);
  const built = new Map<ProviderId, AiProvider[]>();
  const providersOf = (id: ProviderId): AiProvider[] => {
    if (!built.has(id)) {
      try {
        built.set(id, fake ? [createFakeProvider({ id })] : buildProviders(id, env, deps.fetch, deps.maxRetries));
      } catch {
        built.set(id, []);
      }
    }
    return built.get(id)!;
  };
  const targets: RoutedTarget[] = TASKS.map((task) => {
    const route = routes[task];
    const personalData = task !== SEARCH_TASK && TEXT_TASKS[task as TextTask].personalData;
    return { target: task, providerSetting: taskKey(task, "PROVIDER"), modelSetting: taskKey(task, "MODEL"), route, personalData, endpoint: endpointFor(providersOf(route.provider), route, personalData) };
  });
  const identityRoute: Route = { provider: IDENTITY_PROVIDER, ...(env.AI_IDENTITY_MODEL?.trim() ? { model: env.AI_IDENTITY_MODEL.trim() } : {}) };
  const identity = fake ? createFakeProvider({ id: IDENTITY_PROVIDER }) : env.MISTRAL_API_KEY?.trim() ? endpointFor(providersOf(IDENTITY_PROVIDER), identityRoute, true) : undefined;
  targets.push({ target: "identity", providerSetting: "AI_IDENTITY_MODEL", modelSetting: "AI_IDENTITY_MODEL", route: identityRoute, personalData: true, endpoint: identity });
  return targets;
}

/**
 * Providers no task uses that a task Playbook may still choose, when their keys are entered: every text
 * provider for a Playbook Agent (#225, `AiLayer.agentModels`), outside the EU too (OpenAI without EU data
 * residency, Claude's direct API), and every web-search provider for its searches (`AiLayer.searchModels`).
 */
function offeredOnlyProviders(env: Env, used: ProviderId[], fetch: typeof globalThis.fetch | undefined): AiProvider[] {
  const entered: Record<ProviderId, boolean> = {
    anthropic: Boolean(env.AWS_BEARER_TOKEN_BEDROCK?.trim() || env.ANTHROPIC_API_KEY?.trim()),
    mistral: Boolean(env.MISTRAL_API_KEY?.trim()),
    openai: Boolean(env.OPENAI_API_KEY?.trim()),
    perplexity: Boolean(env.PERPLEXITY_API_KEY?.trim()),
    brave: Boolean(env.BRAVE_SEARCH_API_KEY?.trim()),
    tavily: Boolean(env.TAVILY_API_KEY?.trim()),
  };
  return PROVIDER_IDS.filter((id) => entered[id] && !used.includes(id)).flatMap((id) => buildProviders(id, env, fetch));
}

/**
 * Builds the AI layer from environment variables (in production, ECS injects them from Secrets Manager).
 * Per task: AI_<TASK>_PROVIDER and AI_<TASK>_MODEL. Only providers some task uses need their keys.
 * Throws at start-up on a missing key of a text task's provider or a task routed to a provider that cannot
 * serve it (a web-search provider for a text task); without the active Search provider's key, it starts
 * with web search unavailable (#399). Every call is redacted (redaction.ts, ADR-0007).
 */
export function createAiLayerFromEnv(env: Env = process.env, deps: AiLayerDeps = {}): AiLayer {
  const fake = env.AI_FAKE?.trim() === "true";
  if (fake && env.NODE_ENV === "production") throw new AiConfigError("AI_FAKE cannot be used in production");

  const routes = routesFromEnv(env, fake);
  const used = [...new Set(Object.values(routes).map((route) => route.provider))];
  // A provider only text tasks use may wait for its key, when tolerated (ADR-0042); the active Search provider's key may be missing too: web search alone is then unavailable (#399, ADR-0043).
  const textOnly = (id: ProviderId) => routes[SEARCH_TASK].provider !== id;
  const searchOnly = (id: ProviderId) => Object.entries(routes).every(([task, route]) => route.provider !== id || task === SEARCH_TASK);
  const unconfigured: Partial<Record<ProviderId, string>> = {};
  const providers = used.flatMap((id) => {
    if (fake) return [createFakeProvider({ id })];
    try {
      return buildProviders(id, env, deps.fetch);
    } catch (error) {
      if (!isMissingKey(error) || !(searchOnly(id) || (deps.tolerateMissingKeys && textOnly(id)))) throw error;
      unconfigured[id] = error.message;
      return [];
    }
  });
  if (!fake) providers.push(...offeredOnlyProviders(env, used, deps.fetch));
  if (deps.euAiConsent && !providers.some((provider) => provider.id === IDENTITY_PROVIDER)) providers.push(identityProvider(env, fake, deps.fetch));

  const searchFallback = searchFallbackFromEnv(env, routes[SEARCH_TASK].provider);
  const { notice } = legacySearchModel(env, routes[SEARCH_TASK].provider);
  if (notice) console.warn(`[ai] ${notice}`);
  return createAiLayer({
    providers,
    routes,
    ...(searchFallback ? { searchFallback } : {}),
    identityRoute: { provider: IDENTITY_PROVIDER, model: env.AI_IDENTITY_MODEL?.trim() || undefined },
    euAiConsent: deps.euAiConsent,
    identityOf: deps.identityOf,
    unconfigured,
    // The billed units' prices and the EUR/USD rate in use (#403): a price overridden on a Tool's sheet is recorded from the next call.
    prices: pricesFromEnv(env),
    usage: deps.usage ?? createConsoleUsageLog(),
  });
}
