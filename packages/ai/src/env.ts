import { createAiLayer, type AiLayer, type Route } from "./ai-layer";
import { AiConfigError } from "./errors";
import { createAnthropicProvider, type AnthropicEndpoint } from "./providers/anthropic";
import { createMistralProvider, createOpenAiProvider } from "./providers/chat-completions";
import { createBraveProvider } from "./providers/brave";
import { createLinkupProvider } from "./providers/linkup";
import { createPerplexityProvider } from "./providers/perplexity";
import { createTavilyProvider } from "./providers/tavily";
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

/** Every environment variable the AI layer reads. `.env.example` must list them all. */
export const AI_ENV_KEYS = [
  "AI_FAKE",
  "AI_IDENTITY_MODEL",
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
  "LINKUP_API_KEY",
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
}

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

const ANTHROPIC_ENDPOINTS = ["auto", "bedrock", "vertex", "direct"] as const;

/**
 * Where Claude is reached (ANTHROPIC_ENDPOINT). `auto`, the default, follows the keys entered:
 * the direct API with ANTHROPIC_API_KEY, Bedrock with AWS_BEARER_TOKEN_BEDROCK, both with both
 * keys, and Bedrock through the AWS credential chain (e.g. the ECS task role) with neither.
 * The direct API comes first: with both, tasks without personal data use it (ai-layer.ts).
 */
function anthropicEndpoints(env: Env): AnthropicEndpoint[] {
  const bedrock = (): AnthropicEndpoint => ({ kind: "bedrock", region: env.BEDROCK_REGION?.trim() || "eu-north-1", apiKey: env.AWS_BEARER_TOKEN_BEDROCK?.trim() || undefined });
  switch (oneOf(env, "ANTHROPIC_ENDPOINT", ANTHROPIC_ENDPOINTS, "auto")) {
    case "direct":
      return [{ kind: "direct", apiKey: required(env, "ANTHROPIC_API_KEY") }];
    case "vertex":
      return [{ kind: "vertex", region: env.VERTEX_REGION?.trim() || "europe-west1", projectId: required(env, "VERTEX_PROJECT_ID") }];
    case "bedrock":
      return [bedrock()];
    case "auto": {
      const direct = env.ANTHROPIC_API_KEY?.trim();
      const endpoints: AnthropicEndpoint[] = direct ? [{ kind: "direct", apiKey: direct }] : [];
      if (!direct || env.AWS_BEARER_TOKEN_BEDROCK?.trim()) endpoints.push(bedrock());
      return endpoints;
    }
  }
}

/** Whether Claude is reached through an EU-resident endpoint, so it is the default for tasks with personal data. */
function anthropicInEu(env: Env): boolean {
  const kind = oneOf(env, "ANTHROPIC_ENDPOINT", ANTHROPIC_ENDPOINTS, "auto");
  if (kind === "auto") return !env.ANTHROPIC_API_KEY?.trim() || Boolean(env.AWS_BEARER_TOKEN_BEDROCK?.trim());
  return kind !== "direct";
}

function buildProviders(id: ProviderId, env: Env, fetch: typeof globalThis.fetch | undefined): AiProvider[] {
  if (id === "anthropic") return anthropicEndpoints(env).map((endpoint) => createAnthropicProvider({ endpoint, fetch }));
  return [buildProvider(id, env, fetch)];
}

function buildProvider(id: Exclude<ProviderId, "anthropic">, env: Env, fetch: typeof globalThis.fetch | undefined): AiProvider {
  switch (id) {
    case "mistral":
      return createMistralProvider({ apiKey: required(env, "MISTRAL_API_KEY"), fetch });
    case "openai":
      return createOpenAiProvider({
        apiKey: required(env, "OPENAI_API_KEY"),
        dataResidency: oneOf(env, "OPENAI_DATA_RESIDENCY", ["eu", "us"] as const, "eu"),
        fetch,
      });
    case "perplexity":
      return createPerplexityProvider({ apiKey: required(env, "PERPLEXITY_API_KEY"), fetch });
    case "brave":
      return createBraveProvider({ apiKey: required(env, "BRAVE_SEARCH_API_KEY"), fetch });
    case "tavily":
      return createTavilyProvider({ apiKey: required(env, "TAVILY_API_KEY"), fetch });
    case "linkup":
      return createLinkupProvider({ apiKey: required(env, "LINKUP_API_KEY"), fetch });
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
    routes[task] = routeOf(provider, env[taskKey(task, "MODEL")]?.trim() || undefined);
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
    linkup: Boolean(env.LINKUP_API_KEY?.trim()),
  };
  return PROVIDER_IDS.filter((id) => entered[id] && !used.includes(id)).flatMap((id) => buildProviders(id, env, fetch));
}

/**
 * Builds the AI layer from environment variables (in production, ECS injects them from Secrets Manager).
 * Per task: AI_<TASK>_PROVIDER and AI_<TASK>_MODEL. Only providers some task uses need their keys.
 * Throws at start-up on a missing key or a task routed to a provider that cannot serve it (a web-search
 * provider for a text task); every call is redacted (redaction.ts, ADR-0007).
 */
export function createAiLayerFromEnv(env: Env = process.env, deps: AiLayerDeps = {}): AiLayer {
  const fake = env.AI_FAKE?.trim() === "true";
  if (fake && env.NODE_ENV === "production") throw new AiConfigError("AI_FAKE cannot be used in production");

  const routes = routesFromEnv(env, fake);
  const used = [...new Set(Object.values(routes).map((route) => route.provider))];
  const providers = used.flatMap((id) => (fake ? [createFakeProvider({ id })] : buildProviders(id, env, deps.fetch)));
  if (!fake) providers.push(...offeredOnlyProviders(env, used, deps.fetch));
  if (deps.euAiConsent && !providers.some((provider) => provider.id === IDENTITY_PROVIDER)) providers.push(identityProvider(env, fake, deps.fetch));

  return createAiLayer({
    providers,
    routes,
    identityRoute: { provider: IDENTITY_PROVIDER, model: env.AI_IDENTITY_MODEL?.trim() || undefined },
    euAiConsent: deps.euAiConsent,
    identityOf: deps.identityOf,
    usage: deps.usage ?? createConsoleUsageLog(),
  });
}
