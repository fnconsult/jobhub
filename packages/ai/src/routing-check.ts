/**
 * An AI routing change checked before it is saved (ADR-0033, #301): the candidate configuration is
 * built as the AI layer would build it, and refused where its routes would be wrong.
 *
 *   const refusal = await checkAiRoutingChange(envInUse, envWithTheNewValue, { fetch });
 *   if (refusal) // refusal.reason, refusal.technical (the setting at fault and why)
 */
import { cleanTechnicalMessage, failureOf, type FailureReason, type TechnicalReason } from "@jobhub/shared";
import { AI_ENV_KEYS, createAiLayerFromEnv, routedTargets, type RoutedTarget } from "./env";
import { AiConfigError, AiProviderError, DataResidencyError } from "./errors";
import type { AiProvider } from "./types";

type Env = Record<string, string | undefined>;

/** Why a change is refused, and the technical detail: which setting, which task, where it would go. */
export interface AiRoutingRefusal {
  reason: Extract<FailureReason, "key_missing" | "route_missing" | "data_residency" | "test_failed">;
  technical: TechnicalReason;
}

/** Why the AI layer would not start on `env` (a key missing, a provider that cannot serve its task), or null. */
function buildProblem(env: Env): AiRoutingRefusal | null {
  try {
    // With an EU AI consent lookup, so the identity route is checked too; nothing is called nor recorded.
    createAiLayerFromEnv(env, { usage: { record: () => {} }, euAiConsent: async () => false });
    return null;
  } catch (error) {
    if (!(error instanceof AiConfigError || error instanceof DataResidencyError)) throw error;
    const { technical } = failureOf(error);
    return { reason: error instanceof AiConfigError ? (error.reason === "key_missing" ? "key_missing" : "route_missing") : "data_residency", technical };
  }
}

/** What is wrong with the routes `env` sets. */
function problemsOf(env: Env): AiRoutingRefusal[] {
  const built = buildProblem(env);
  if (built) return [built];
  const problems: AiRoutingRefusal[] = [];
  for (const { target, providerSetting, personalData, endpoint } of routedTargets(env)) {
    if (!personalData || !endpoint || endpoint.residency === "eu") continue;
    problems.push({
      reason: "data_residency",
      technical: {
        class: "DataResidencyError",
        provider: endpoint.id,
        message: `${providerSetting}: the ${target} task carries personal data and would reach ${endpoint.id} through ${endpoint.endpoint}, outside the EU`,
      },
    });
  }
  return problems;
}

export interface AiRoutingCheckDeps {
  /** What the test calls go through. Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** How long one test call may take. Default: 20 s. */
  timeoutMs?: number;
}

/** The query a web-search model is tested with: a company's name, nothing of anyone. */
const TEST_QUERY = "Jobbbox";

/** The cheapest call `endpoint` takes: one token of text, or one search. */
async function testCall(endpoint: AiProvider, model: string, timeoutMs: number): Promise<void> {
  const call = endpoint.generate
    ? endpoint.generate({ model, messages: [{ role: "user", content: "Réponds OK." }], maxTokens: 1 })
    : endpoint.search!(TEST_QUERY, { model });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiProviderError(endpoint.id, `no answer within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([call, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The routes naming a model, by where they go: what one test call covers. */
const testedRoute = (target: RoutedTarget) => `${target.endpoint!.id}|${target.endpoint!.endpoint}|${target.route.model}`;
const namingModel = (target: RoutedTarget) => Boolean(target.endpoint && target.route.model);

/**
 * The first route of `after` naming a model that fails its test call, among those `before` did not
 * already use (same provider, endpoint and model): one call each, not retried.
 */
async function failedModel(before: Env, after: Env, deps: AiRoutingCheckDeps): Promise<AiRoutingRefusal | null> {
  let inUse: Set<string>;
  try {
    inUse = new Set(routedTargets(before).filter(namingModel).map(testedRoute));
  } catch {
    inUse = new Set();
  }
  const secrets = AI_ENV_KEYS.filter((name) => /_KEY$|_TOKEN_/.test(name)).map((name) => after[name]);
  for (const target of routedTargets(after, { fetch: deps.fetch, maxRetries: 0 }).filter(namingModel)) {
    const route = testedRoute(target);
    if (inUse.has(route)) continue;
    inUse.add(route);
    const endpoint = target.endpoint!;
    try {
      await testCall(endpoint, target.route.model!, deps.timeoutMs ?? 20_000);
    } catch (error) {
      const { technical } = failureOf(error, { secrets });
      const message = `${target.modelSetting}: ${target.route.model} failed its test call on ${endpoint.id} (${endpoint.endpoint}): ${technical.message}`;
      return { reason: "test_failed", technical: { ...technical, message: cleanTechnicalMessage(message, { secrets }) } };
    }
  }
  return null;
}

/**
 * Whether changing the AI routing from `before` to `after` (each the environment with the Back Office's
 * values and the Provider Secrets over it) may be saved: null when it may, else why not.
 *  - The AI layer must start on `after`: no key missing, no provider that cannot serve its task.
 *  - No task with personal data may reach an endpoint outside the EU.
 *  - Each model a route names that `before` did not use there passes its test call (one token, or one search).
 * A problem the configuration already had before the change does not block it.
 */
export async function checkAiRoutingChange(before: Env, after: Env, deps: AiRoutingCheckDeps = {}): Promise<AiRoutingRefusal | null> {
  const known = new Set(problemsOf(before).map((problem) => problem.technical.message));
  const problem = problemsOf(after).find((found) => !known.has(found.technical.message));
  return problem ?? failedModel(before, after, deps);
}
