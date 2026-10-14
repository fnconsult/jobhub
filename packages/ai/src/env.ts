import { createAiLayer, type AiLayer, type Route } from "./ai-layer";
import { AiConfigError } from "./errors";
import { createAnthropicProvider } from "./providers/anthropic";
import { createMistralProvider, createOpenAiProvider } from "./providers/chat-completions";
import { createBraveProvider } from "./providers/brave";
import { createLinkupProvider } from "./providers/linkup";
import { createPerplexityProvider } from "./providers/perplexity";
import { createTavilyProvider } from "./providers/tavily";
import { createFakeProvider } from "./testing";
import { PROVIDER_IDS, SEARCH_TASK, TEXT_TASKS, type AiProvider, type AiTask, type ProviderId, type UsageLog } from "./types";
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
 * job titles are public text, like Job Offers.
 */
const DEFAULT_TASK = { job_titles: "offer_analysis" } as const satisfies Partial<Record<AiTask, AiTask>>;

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
}

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new AiConfigError(`Missing environment variable ${key}`);
  return value;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const value = env[key]?.trim() || fallback;
  if (!allowed.includes(value as T)) throw new AiConfigError(`${key} must be one of ${allowed.join(", ")} (got "${value}")`);
  return value as T;
}

function buildProvider(id: ProviderId, env: Env, fetch: typeof globalThis.fetch | undefined): AiProvider {
  switch (id) {
    case "anthropic": {
      const kind = oneOf(env, "ANTHROPIC_ENDPOINT", ["bedrock", "vertex", "direct"] as const, "bedrock");
      const endpoint =
        kind === "direct"
          ? { kind, apiKey: required(env, "ANTHROPIC_API_KEY") }
          : kind === "vertex"
            ? { kind, region: env.VERTEX_REGION?.trim() || "europe-west1", projectId: required(env, "VERTEX_PROJECT_ID") }
            : { kind, region: env.BEDROCK_REGION?.trim() || "eu-west-3", apiKey: env.AWS_BEARER_TOKEN_BEDROCK?.trim() || undefined };
      return createAnthropicProvider({ endpoint, fetch });
    }
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
      throw new AiConfigError("Missing environment variable MISTRAL_API_KEY: needed for identity-bearing AI calls of Candidates with EU AI consent");
    },
  };
}

/**
 * Builds the AI layer from environment variables (in production, ECS injects them from Secrets Manager).
 * Per task: AI_<TASK>_PROVIDER and AI_<TASK>_MODEL. Only providers some task uses need their keys.
 * Throws at start-up on a missing key or a routing that would break the data rule (ADR-0007).
 */
export function createAiLayerFromEnv(env: Env = process.env, deps: AiLayerDeps = {}): AiLayer {
  const fake = env.AI_FAKE?.trim() === "true";
  if (fake && env.NODE_ENV === "production") throw new AiConfigError("AI_FAKE cannot be used in production");

  const routes: Partial<Record<AiTask, Route>> = {};
  for (const task of TASKS) {
    if (task in DEFAULT_TASK) continue;
    const provider = oneOf(env, taskKey(task, "PROVIDER"), PROVIDER_IDS, DEFAULT_PROVIDER[task as keyof typeof DEFAULT_PROVIDER]);
    routes[task] = { provider, model: env[taskKey(task, "MODEL")]?.trim() || undefined };
  }
  for (const [task, fallback] of Object.entries(DEFAULT_TASK) as [AiTask, AiTask][]) {
    const inherited = routes[fallback]!;
    const provider = oneOf(env, taskKey(task, "PROVIDER"), PROVIDER_IDS, inherited.provider);
    const model = env[taskKey(task, "MODEL")]?.trim() || (provider === inherited.provider ? inherited.model : undefined);
    routes[task] = { provider, model };
  }
  const used = [...new Set(Object.values(routes).map((route) => route.provider))];
  const providers = used.map((id) => (fake ? createFakeProvider({ id }) : buildProvider(id, env, deps.fetch)));
  if (deps.euAiConsent && !used.includes(IDENTITY_PROVIDER)) providers.push(identityProvider(env, fake, deps.fetch));

  return createAiLayer({
    providers,
    routes,
    identityRoute: { provider: IDENTITY_PROVIDER, model: env.AI_IDENTITY_MODEL?.trim() || undefined },
    euAiConsent: deps.euAiConsent,
    usage: deps.usage ?? createConsoleUsageLog(),
  });
}
