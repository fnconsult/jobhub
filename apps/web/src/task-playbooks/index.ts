/**
 * What an AI task runs with (ADR-0026): the served version of its task Playbook, its instructions and
 * its Playbook Agent, read for each call.
 *
 *   const run = await taskRun(taskPlaybooks, "cv-reading", ai);
 *   await ai.generate({ task: "cv_parsing", system: `${run.text()}\n${SHAPE}`, ...run.agent, … });
 *   run.text("fr");                                          // one `## fr` section
 *   const reading = await servedTaskRun(taskPlaybooks, "job-offer-reading", ai); // null: none served
 *
 * `taskRun` never fails: when no version is served (archived, or none Human-validated in production) or
 * it cannot be read, the task runs on its built-in text (version 1 as written in
 * `@jobhub/coach-knowledge/tasks`) and its configured route, with a warning. `servedTaskRun` is for a
 * task that does nothing without a served version (the Job Offer Summary and sector).
 * A served Playbook Agent the AI layer no longer offers (its provider unconfigured, its model gone) is
 * not used: the task's configured route is, with a warning. The AI layer still applies the task's data
 * rules (ADR-0007): personal data stays EU-resident, identity-bearing calls follow EU AI Consent.
 */
import type { AiLayer, GenerateRequest, TaskInstructions } from "@jobhub/ai";
import { builtInInstructions, taskSection, type TaskPlaybookId } from "@jobhub/coach-knowledge/tasks";
import type { PlaybookAgent, ServedTaskPlaybook } from "../coaching-playbooks";

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
  /** The route and effort of its Playbook Agent, to spread into `ai.generate`; empty for the task's configured route. */
  agent: Pick<GenerateRequest, "route" | "effort">;
  /** Its instructions (or one section) with its Playbook Agent, as the AI layer's own tasks take them. */
  instructions(section?: string): TaskInstructions;
}

type Warn = (message: string) => void;
const consoleWarn: Warn = (message) => console.warn(`[task-playbooks] ${message}`);

/** The Playbook Agent as the AI layer takes it; empty, with a warning, when the AI layer no longer offers its model. */
function agentFor(id: string, agent: PlaybookAgent | null, ai: Pick<AiLayer, "agentModels">, warn: Warn): TaskRun["agent"] {
  if (!agent) return {};
  const choice = ai.agentModels().find((each) => each.provider === agent.provider);
  if (!choice || (agent.model !== null && !choice.models.some((each) => each.model === agent.model))) {
    warn(`task Playbook "${id}": its Playbook Agent (${agent.provider} ${agent.model ?? "default model"}) is not offered here, the task's configured route is used`);
    return {};
  }
  return { route: agent.model ? { provider: agent.provider, model: agent.model } : { provider: agent.provider }, ...(agent.effort ? { effort: agent.effort } : {}) };
}

function runOf(id: TaskPlaybookId, served: ServedTaskPlaybook | null, ai: Pick<AiLayer, "agentModels">, warn: Warn): TaskRun {
  const agent = served ? agentFor(id, served.agent, ai, warn) : {};
  const text = (section?: string): string => {
    if (!served) return builtInInstructions(id, section);
    if (section === undefined) return served.content;
    const found = taskSection(served.content, section);
    if (found !== null) return found;
    warn(`task Playbook "${id}" v${served.version} has no section "${section}": its built-in text is used`);
    return builtInInstructions(id, section);
  };
  return { id, version: served?.version ?? null, text, agent, instructions: (section) => ({ text: text(section), ...agent }) };
}

/** The served version of `id`, or null when none is or it cannot be read (`failed`). */
async function read(reader: TaskPlaybookReader | undefined, id: TaskPlaybookId, warn: Warn): Promise<{ served: ServedTaskPlaybook | null; failed: boolean }> {
  if (!reader) return { served: null, failed: false };
  try {
    return { served: await reader(id), failed: false };
  } catch (error) {
    warn(`task Playbook "${id}" could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return { served: null, failed: true };
  }
}

/**
 * How the task of `id` runs now: its served version, else its built-in text (with a warning).
 * Without `reader` (a caller not wired to the database, as in unit tests), the built-in text, silently.
 */
export async function taskRun(reader: TaskPlaybookReader | undefined, id: TaskPlaybookId, ai: Pick<AiLayer, "agentModels">, warn: Warn = consoleWarn): Promise<TaskRun> {
  const { served, failed } = await read(reader, id, warn);
  if (reader && !served && !failed) warn(`no version of task Playbook "${id}" is served: its built-in text is used`);
  return runOf(id, served, ai, warn);
}

/** How the task of `id` runs now, only from its served version: null when none is (or it cannot be read). */
export async function servedTaskRun(reader: TaskPlaybookReader | undefined, id: TaskPlaybookId, ai: Pick<AiLayer, "agentModels">, warn: Warn = consoleWarn): Promise<TaskRun | null> {
  const { served } = await read(reader, id, warn);
  return served ? runOf(id, served, ai, warn) : null;
}
