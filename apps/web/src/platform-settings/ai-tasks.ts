/**
 * The AI tasks and Playbook Agents as Paramètres shows them (#402, ADR-0042): which provider, model and effort each
 * runs on, where that comes from, and whether that provider's key is entered.
 *
 *   aiTaskRoutes(state)                      the IA tab's « Tâches »: each text task's route (AI_<TASK>_PROVIDER/_MODEL)
 *   playbookAgentRows(playbooks, state)      the IA tab's « Playbook Agents »: every Coaching Playbook and task Playbook
 *                                            with a Playbook Agent, its served, validated and draft versions
 *   searchTaskRows(playbooks, state)         Recherche web's « Tâches IA de la recherche »: the four task Playbooks
 *                                            of a Job Search and a Company Dossier, as they run now
 *   routeChange(task, provider, model)       the Platform Settings a route change saves, in order
 *   playbookAgentChange(latest, form)        what a Playbook Agent change saves: a draft Playbook Version
 *
 * A route is a Platform Setting, applied from the next call; a Playbook Agent belongs to its Playbook Version, so a
 * change makes a draft version, served in production once Human-validated in Playbooks. Choosing a provider whose key
 * is missing is shown, never refused.
 */
import { euOnly, taskRouteFromEnv, TEXT_TASKS, type Effort, type ProviderId, type TextTask } from "@jobhub/ai";
import { runsOnAgent, taskPlaybookSeed, type TaskPlaybookId } from "@jobhub/coach-knowledge/tasks";
import { TOOLS, type Tool } from "@jobhub/shared";
import type { CoachingPlaybook, PlaybookAgent, PlaybookSearch, PlaybookVersion } from "../coaching-playbooks";
import { toolStatus } from "../tools/index";
import { overSettings } from "./ai-routing";
import type { ProvidersState } from "./parametres";
import type { PlatformSettingSource } from "./resolver";

/** The text tasks, in the AI layer's order. */
export const TEXT_TASK_IDS = Object.keys(TEXT_TASKS) as TextTask[];

/** The text providers a task's route may name; the Search providers only search. */
export const TEXT_PROVIDERS = ["anthropic", "mistral", "openai"] as const satisfies readonly ProviderId[];

const providerSetting = (task: string) => `AI_${task.toUpperCase()}_PROVIDER`;
const modelSetting = (task: string) => `AI_${task.toUpperCase()}_MODEL`;

/** Whether `provider` cannot be called: no Tool of it has its keys (Claude counts as keyed through any of its endpoints). */
export function keyMissing(state: ProvidersState, provider: ProviderId): boolean {
  const tools = (TOOLS as readonly Tool[]).filter((tool) => tool.usage?.table === "ai_usage" && tool.usage.provider === provider);
  if (tools.length === 0) return false;
  return !tools.some((tool) => {
    const { status } = toolStatus(tool, state);
    return status === "configured" || status === "no_key_needed";
  });
}

/** Where a value comes from: a Platform Setting's source, or a version of the task Playbook. */
export type ValueSource = { kind: "setting"; name: string; source: PlatformSettingSource } | { kind: "playbook"; version: number };

export interface AiTaskRoute {
  task: TextTask;
  providerSetting: string;
  modelSetting: string;
  provider: ProviderId;
  /** Null: the provider's default model. */
  model: string | null;
  /** Its provider setting's source; a task taking another's provider by default says the default. */
  source: ValueSource;
  personalData: boolean;
  /** Whether it runs only on an EU endpoint (ADR-0052): a provider outside the EU is refused on save. */
  euOnly: boolean;
  keyMissing: boolean;
}

/** The env the AI layer is built from: env with the Back Office's settings over it. */
const routingEnv = (state: ProvidersState) => overSettings(state.env, state.settings.env);

/** Each text task's route, as the AI layer routes it now; none when a value it refuses keeps the routes from being read. */
export function aiTaskRoutes(state: ProvidersState): AiTaskRoute[] {
  const env = routingEnv(state);
  try {
    return TEXT_TASK_IDS.map((task): AiTaskRoute => {
      const route = taskRouteFromEnv(env, task);
      const setting = state.settings.setting(providerSetting(task));
      return {
        task,
        providerSetting: providerSetting(task),
        modelSetting: modelSetting(task),
        provider: route.provider,
        model: route.model ?? null,
        source: { kind: "setting", name: providerSetting(task), source: setting?.source ?? "default" },
        personalData: TEXT_TASKS[task].personalData,
        euOnly: euOnly(task),
        keyMissing: keyMissing(state, route.provider),
      };
    });
  } catch {
    return [];
  }
}

/** A Coaching Playbook or task Playbook with its versions that matter here. */
export interface PlaybookWithVersions {
  playbook: CoachingPlaybook;
  /** The latest Human-validated version: what production serves; null when none is. */
  validated: PlaybookVersion | null;
}

export interface PlaybookAgentRow {
  id: string;
  kind: "playbook" | "task";
  title: string;
  /** What this environment serves; null when none is (archived, or nothing validated in production). */
  served: PlaybookVersion | null;
  /** The latest Human-validated version: what production serves. */
  validated: PlaybookVersion | null;
  /** The latest version while it waits for its validation in Playbooks; null when the latest is validated. */
  draft: PlaybookVersion | null;
  /** The Playbook Agent shown: the served version's, else the latest's. */
  agent: PlaybookAgent | null;
  /** Its web searches' provider, for a task Playbook that searches (null: the configured web-search route). */
  search: PlaybookSearch | null;
  /** Whether it runs web searches (a task Playbook that does). */
  searches: boolean;
  keyMissing: boolean;
}

function rowOf({ playbook, validated }: PlaybookWithVersions, state: ProvidersState): PlaybookAgentRow {
  const shown = playbook.served ?? playbook.latest;
  const agent = shown.agent;
  return {
    id: playbook.id,
    kind: playbook.kind === "task" ? "task" : "playbook",
    title: playbook.title,
    served: playbook.served,
    validated,
    draft: playbook.latest.validation ? null : playbook.latest,
    agent,
    search: shown.search,
    searches: playbook.kind === "task" && Boolean(taskPlaybookSeed(playbook.id)?.search),
    keyMissing: agent ? keyMissing(state, agent.provider) : false,
  };
}

/** Every Coaching Playbook in use and every task Playbook with a Playbook Agent, Coaching Playbooks first. */
export function playbookAgentRows(playbooks: readonly PlaybookWithVersions[], state: ProvidersState): PlaybookAgentRow[] {
  const withAgent = playbooks.filter(({ playbook }) => !playbook.archived && (playbook.kind === "playbook" || (playbook.kind === "task" && playbook.latest.agent !== null)));
  const order = (row: PlaybookWithVersions) => (row.playbook.kind === "playbook" ? 0 : 1);
  return [...withAgent].sort((a, b) => order(a) - order(b)).map((row) => rowOf(row, state));
}

/** The task Playbooks of a Job Search and a Company Dossier: Recherche web's « Tâches IA de la recherche » (#386). */
export const SEARCH_TASK_PLAYBOOKS = ["job-search-queries", "job-offer-reading", "company-facts-search", "company-news-search"] as const satisfies readonly TaskPlaybookId[];

export interface SearchTaskRow {
  id: (typeof SEARCH_TASK_PLAYBOOKS)[number];
  title: string;
  /** Its Playbook Agent's (a text task), else its web search's: what it runs on now. */
  provider: ProviderId;
  model: string | null;
  /** Null: none sent (the model's own), or a web search. */
  effort: Effort | null;
  /** Its served version, when it names the provider; else the route's Platform Setting. */
  source: ValueSource;
  keyMissing: boolean;
  /** Its row on the IA tab and in Playbooks: what « Modifier… » opens. */
  playbook: PlaybookAgentRow | null;
}

/** Each search task Playbook as it runs now: its served version's Playbook Agent or search provider, else its AI task's route. */
export function searchTaskRows(playbooks: readonly PlaybookWithVersions[], state: ProvidersState): SearchTaskRow[] {
  const env = routingEnv(state);
  return SEARCH_TASK_PLAYBOOKS.flatMap((id): SearchTaskRow[] => {
    const seed = taskPlaybookSeed(id);
    if (!seed) return [];
    const found = playbooks.find(({ playbook }) => playbook.id === id);
    const row = found ? rowOf(found, state) : null;
    const served = found?.playbook.served ?? null;
    // As the task runs it: a served version without the section its agent reads runs its search alone (#405).
    const onAgent = runsOnAgent(id, served?.content ?? seed.instructions);
    const named = onAgent ? served?.agent : served?.search;
    const routeTask = onAgent || !seed.search ? seed.aiTask : "web_search";
    let route: { provider: ProviderId; model?: string };
    try {
      route = taskRouteFromEnv(env, routeTask as Parameters<typeof taskRouteFromEnv>[1]);
    } catch {
      return [];
    }
    const provider = named?.provider ?? route.provider;
    const routeSetting = state.settings.setting(providerSetting(routeTask));
    return [
      {
        id,
        title: found?.playbook.title ?? seed.title,
        provider,
        model: named ? named.model : (route.model ?? null),
        effort: onAgent && served?.agent ? served.agent.effort : null,
        source: named && served ? { kind: "playbook", version: served.version } : { kind: "setting", name: providerSetting(routeTask), source: routeSetting?.source ?? "default" },
        keyMissing: keyMissing(state, provider),
        playbook: row,
      },
    ];
  });
}

/**
 * A route change as the Platform Settings it saves, in order: the provider, then the model ("" restores it, the
 * provider's default). A provider changed with no model named restores the model first, so the old provider's model
 * is never tested on the new one.
 */
export function routeChange(task: TextTask, current: { provider: ProviderId; model: string | null }, wanted: { provider: string; model: string }): { name: string; value: string | null }[] {
  const model = wanted.model.trim();
  const changes: { name: string; value: string | null }[] = [];
  const providerChanged = wanted.provider !== current.provider;
  if (providerChanged && current.model !== null) changes.push({ name: modelSetting(task), value: null });
  if (providerChanged) changes.push({ name: providerSetting(task), value: wanted.provider });
  if (model !== (providerChanged ? "" : (current.model ?? ""))) changes.push({ name: modelSetting(task), value: model || null });
  return changes;
}

/**
 * What `CoachingPlaybooks.save` is given for a Playbook Agent changed on Paramètres: the latest version's rules and "when
 * to consult it" as they are, with the model (`agentModel`: "provider|model", "" model: the provider's default), the
 * effort and, for a task Playbook that searches, the web search's provider (`searchModel`, "": the configured route)
 * chosen. A Human-validated latest version gets a new draft version; a draft is updated in place.
 */
export function playbookAgentChange(
  latest: PlaybookVersion,
  form: { agentModel?: string; effort?: string; searchModel?: string },
): { content: string; provider: string; model: string; effort: string; consultWhen: string; searchProvider: string; searchModel: string } {
  const [provider = "", model = ""] = form.agentModel !== undefined ? form.agentModel.split("|") : [latest.agent?.provider ?? "", latest.agent?.model ?? ""];
  const [searchProvider = "", searchModel = ""] = form.searchModel !== undefined ? form.searchModel.split("|") : [latest.search?.provider ?? "", latest.search?.model ?? ""];
  return {
    content: latest.content,
    provider,
    model,
    effort: form.effort ?? latest.agent?.effort ?? "",
    consultWhen: latest.agent?.consultWhen ?? "",
    searchProvider,
    searchModel,
  };
}
