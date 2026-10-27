/**
 * What an AI task runs with (ADR-0026): the served version of its task Playbook, its instructions and
 * its Playbook Agent, read for each call.
 *
 *   const run = await taskRun(taskPlaybooks, "cv-reading", ai);
 *   await ai.generate({ task: "cv_parsing", system: `${run.text()}\n${SHAPE}`, ...run.agent, … });
 *   run.text("fr");                                          // one `## fr` section
 *   await ai.searchCompany({ candidateId, employer, instructions: run.text(), route: run.searchRoute });
 *   const reading = await servedTaskRun(taskPlaybooks, "job-offer-reading", ai); // null: none served
 *
 * `taskRun` never fails: when no version is served (archived, or none Human-validated in production) or
 * it cannot be read, the task runs on its built-in text (version 1 as written in
 * `@jobhub/coach-knowledge/tasks`) and its configured route, with a warning. `servedTaskRun` is for a
 * task that does nothing without a served version (the Job Offer Summary and sector).
 * A served Playbook Agent the AI layer no longer offers (its provider unconfigured, its model gone) is
 * not used: the task's configured route is, with a warning; likewise a served web-search provider no
 * longer offered: the configured web-search route is. The AI layer still redacts every call (ADR-0007),
 * and identity-bearing calls still follow EU AI Consent.
 *
 * Each warning goes to the console and into `run.warnings` (#260, ADR-0030), with its Failure Reason code:
 * `...run.agent` and `run.instructions()` carry them into the AI call, which is recorded as Outcome warning;
 * a search passes `warnings: run.warnings`. A run that makes no call (`servedTaskRun` returning null) leaves
 * its warning on the console only.
 */
import type { AiLayer, AiWarning, GenerateRequest, Route, TaskInstructions } from "@jobhub/ai";
import { builtInInstructions, taskPlaybookSeed, taskSection, type TaskPlaybookId } from "@jobhub/coach-knowledge/tasks";
import type { PlaybookAgent, PlaybookSearch, ServedTaskPlaybook } from "../coaching-playbooks";

export type { TaskPlaybookId } from "@jobhub/coach-knowledge/tasks";

/** Reads a task Playbook's served version: `CoachingPlaybooks.servedTask`. */
export type TaskPlaybookReader = (id: TaskPlaybookId) => Promise<ServedTaskPlaybook | null>;

/** One run of an AI task: its instructions and the Playbook Agent running it. */
export interface TaskRun {
  id: TaskPlaybookId;
  /** The served version's number; null when the built-in text is used. */
  version: number | null;
  /** Its instructions, or one `## section` of them. */
  text(section?: string): string;
  /**
   * What to spread into `ai.generate`: the route and effort of its Playbook Agent (none for the task's configured
   * route), and `warnings`.
   */
  agent: Pick<GenerateRequest, "route" | "effort"> & { warnings: AiWarning[] };
  /** Its instructions (or one section) with its Playbook Agent and warnings, as the AI layer's own tasks take them. */
  instructions(section?: string): TaskInstructions;
  /** The web-search provider and model its searches go to, as the AI layer's searches take it (`route`); undefined for the configured web-search route. */
  searchRoute: Route | undefined;
  /**
   * How it fell back (#260), each with its Failure Reason code and what happened: recorded with every AI call it
   * runs. A section missing is added when `text` is asked for it, so before the call is made.
   */
  warnings: AiWarning[];
}

/** What `taskRun` checks a served version against: the models the AI layer offers (a test double may offer no web search). */
type Offers = Pick<AiLayer, "agentModels"> & Partial<Pick<AiLayer, "searchModels">>;

type Warn = (message: string) => void;
const consoleWarn: Warn = (message) => console.warn(`[task-playbooks] ${message}`);

/** Where a run's warnings go: the console, and the run's own list for its AI calls. */
type Note = (reason: AiWarning["reason"], message: string) => void;
const noting =
  (warn: Warn, warnings: AiWarning[]): Note =>
  (reason, message) => {
    warn(message);
    warnings.push({ reason, detail: message });
  };

/**
 * The Playbook Agent as the AI layer takes it; none, with a warning, when the AI layer does not offer its model for
 * the task (no longer, or outside the EU for a task that runs only in the EU, ADR-0052).
 */
function agentFor(id: TaskPlaybookId, agent: PlaybookAgent | null, ai: Offers, note: Note): Pick<GenerateRequest, "route" | "effort"> {
  if (!agent) return {};
  const choice = ai.agentModels(taskPlaybookSeed(id)?.aiTask).find((each) => each.provider === agent.provider);
  if (!choice || (agent.model !== null && !choice.models.some((each) => each.model === agent.model))) {
    note("task_playbook_agent_not_offered", `task Playbook "${id}": its Playbook Agent (${agent.provider} ${agent.model ?? "default model"}) is not offered here, the task's configured route is used`);
    return {};
  }
  return { route: agent.model ? { provider: agent.provider, model: agent.model } : { provider: agent.provider }, ...(agent.effort ? { effort: agent.effort } : {}) };
}

/** The web-search route a served version names; undefined, with a warning, when the AI layer no longer offers it. */
function searchRouteFor(id: string, search: PlaybookSearch | null, ai: Offers, note: Note): Route | undefined {
  if (!search) return undefined;
  const choice = ai.searchModels?.().find((each) => each.provider === search.provider);
  if (!choice || (search.model !== null && !choice.models.some((each) => each.model === search.model))) {
    note("task_playbook_search_not_offered", `task Playbook "${id}": its web-search provider (${search.provider} ${search.model ?? "default model"}) is not offered here, the configured web-search route is used`);
    return undefined;
  }
  return search.model ? { provider: search.provider, model: search.model } : { provider: search.provider };
}

function runOf(id: TaskPlaybookId, served: ServedTaskPlaybook | null, ai: Offers, note: Note, warnings: AiWarning[]): TaskRun {
  const agent = { ...(served ? agentFor(id, served.agent, ai, note) : {}), warnings };
  const searchRoute = served ? searchRouteFor(id, served.search ?? null, ai, note) : undefined;
  const text = (section?: string): string => {
    if (!served) return builtInInstructions(id, section);
    if (section === undefined) return served.content;
    const found = taskSection(served.content, section);
    if (found !== null) return found;
    note("task_playbook_section_missing", `task Playbook "${id}" v${served.version} has no section "${section}": its built-in text is used`);
    return builtInInstructions(id, section);
  };
  return { id, version: served?.version ?? null, text, agent, instructions: (section) => ({ text: text(section), ...agent }), searchRoute, warnings };
}

/** The served version of `id`, or null when none is or it cannot be read (`failed`). */
async function read(reader: TaskPlaybookReader | undefined, id: TaskPlaybookId, note: Note): Promise<{ served: ServedTaskPlaybook | null; failed: boolean }> {
  if (!reader) return { served: null, failed: false };
  try {
    return { served: await reader(id), failed: false };
  } catch (error) {
    note("task_playbook_unreadable", `task Playbook "${id}" could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return { served: null, failed: true };
  }
}

/**
 * How the task of `id` runs now: its served version, else its built-in text (with a warning).
 * Without `reader` (a caller not wired to the database, as in unit tests), the built-in text, silently.
 */
export async function taskRun(reader: TaskPlaybookReader | undefined, id: TaskPlaybookId, ai: Offers, warn: Warn = consoleWarn): Promise<TaskRun> {
  const warnings: AiWarning[] = [];
  const note = noting(warn, warnings);
  const { served, failed } = await read(reader, id, note);
  if (reader && !served && !failed) note("task_playbook_fallback", `no version of task Playbook "${id}" is served: its built-in text is used`);
  return runOf(id, served, ai, note, warnings);
}

/** How the task of `id` runs now, only from its served version: null when none is (or it cannot be read). */
export async function servedTaskRun(reader: TaskPlaybookReader | undefined, id: TaskPlaybookId, ai: Offers, warn: Warn = consoleWarn): Promise<TaskRun | null> {
  const warnings: AiWarning[] = [];
  const note = noting(warn, warnings);
  const { served } = await read(reader, id, note);
  return served ? runOf(id, served, ai, note, warnings) : null;
}
