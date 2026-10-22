/**
 * An AI routing change checked before it is saved (ADR-0033, #301): the candidate configuration is
 * built as the AI layer would build it, and refused where its routes would be wrong.
 *
 *   const refusal = await checkAiRoutingChange(envInUse, envWithTheNewValue, { fetch });
 *   if (refusal) // refusal.reason, refusal.technical (the setting at fault and why)
 */
import { cleanTechnicalMessage, failureOf, type FailureReason, type TechnicalReason } from "@jobhub/shared";
import { createAiLayer } from "./ai-layer";
import { AI_ENV_KEYS, createAiLayerFromEnv, routedTargets, type RoutedTarget } from "./env";
import { AiConfigError, AiProviderError, DataResidencyError } from "./errors";
import { SEARCH_TASK, type TextTask, type UsageLog } from "./types";

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

/**
 * `env` with every key a provider cannot be built without entered, where none is: those keys only keep a route
 * from starting, never change where it goes. So a route waiting for its key is judged where it will go once the key
 * is entered in Clés, which runs no routing check. Claude's keys choose its endpoint under ANTHROPIC_ENDPOINT=auto:
 * its direct API's is entered only where ANTHROPIC_ENDPOINT=direct requires it.
 */
function withRequiredKeysEntered(env: Env): Env {
  const entered: Env = { ...env };
  const required = [
    ...AI_ENV_KEYS.filter((name) => name.endsWith("_API_KEY") && name !== "ANTHROPIC_API_KEY"),
    "VERTEX_PROJECT_ID",
    ...(env.ANTHROPIC_ENDPOINT?.trim() === "direct" ? ["ANTHROPIC_API_KEY"] : []),
  ];
  for (const name of required) if (!env[name]?.trim()) entered[name] = "not-entered-yet";
  return entered;
}

/**
 * The routes of `env` that would take personal data outside the EU, each a problem of its own. Checked whatever
 * else is wrong with `env` (a key missing, a provider that cannot serve its task): the AI layer only prefers EU
 * endpoints at runtime, so this check is the one rule. None when a value a setting refuses keeps the routes from
 * being read: `buildProblem` names it.
 */
function residencyProblems(env: Env): AiRoutingRefusal[] {
  let targets: RoutedTarget[];
  try {
    targets = routedTargets(withRequiredKeysEntered(env));
  } catch {
    return [];
  }
  return targets.flatMap(({ target, providerSetting, personalData, endpoint }): AiRoutingRefusal[] =>
    !personalData || !endpoint || endpoint.residency === "eu"
      ? []
      : [
          {
            reason: "data_residency",
            technical: {
              class: "DataResidencyError",
              provider: endpoint.id,
              message: `${providerSetting}: the ${target} task carries personal data and would reach ${endpoint.id} through ${endpoint.endpoint}, outside the EU`,
            },
          },
        ],
  );
}

/** What is wrong with the routes `env` sets: why the AI layer would not start, and each route leaving the EU with personal data. */
function problemsOf(env: Env): AiRoutingRefusal[] {
  const built = buildProblem(env);
  return [...(built ? [built] : []), ...residencyProblems(env)];
}

export interface AiRoutingCheckDeps {
  /** What the test calls go through. Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** How long one test call may take. Default: 20 s. */
  timeoutMs?: number;
  /** Where each test call is recorded in AI Usage, as any AI call: for no Candidate, on the task whose route it tests. Default: nowhere. */
  usage?: UsageLog;
}

/** The employer a web-search model is tested with: a company's name, nothing of anyone. */
const TEST_QUERY = "Jobbbox";

/**
 * The task a test of `target`'s route is recorded on: its own; the identity route's, which serves any task with
 * personal data of a consenting Candidate, on Tailored Documents' (`writing`), the calls it most often takes.
 */
const recordedAs = (target: RoutedTarget["target"]): TextTask => (target === "identity" ? "writing" : (target as TextTask));

/**
 * The cheapest call `target`'s endpoint takes, one token of text or one search, made through an AI layer of that
 * endpoint alone, so it is redacted and recorded in AI Usage (cost, Outcome, Failure Reason) as any AI call is.
 */
async function testCall(target: RoutedTarget, deps: AiRoutingCheckDeps): Promise<void> {
  const { endpoint, route } = target;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const ai = createAiLayer({ providers: [endpoint!], routes: {}, usage: deps.usage ?? { record: () => {} } });
  const call =
    target.target === SEARCH_TASK
      ? ai.searchCompany({ candidateId: null, employer: TEST_QUERY, instructions: "{{entreprise}}", route })
      : ai.generate({ task: recordedAs(target.target), candidateId: null, prompt: "Réponds OK.", maxTokens: 1, route });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiProviderError(endpoint!.id, `no answer within ${timeoutMs} ms`)), timeoutMs);
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
      await testCall(target, deps);
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
 * A problem the configuration already had before the change does not block it; each is weighed on its own, so a
 * configuration already broken (a key missing) still has its residency checked.
 */
export async function checkAiRoutingChange(before: Env, after: Env, deps: AiRoutingCheckDeps = {}): Promise<AiRoutingRefusal | null> {
  const known = new Set(problemsOf(before).map((problem) => problem.technical.message));
  const problem = problemsOf(after).find((found) => !known.has(found.technical.message));
  return problem ?? failedModel(before, after, deps);
}
