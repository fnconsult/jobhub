/**
 * The task Playbooks for the worker (ADR-0026), which shares the web app's database: each read at the
 * version this environment serves, as the web app does (JOBHUB_TARGET).
 */
import type { Pool } from "pg";
import { createCoachingPlaybooks } from "../coaching-playbooks/index";
import { playbookServing } from "../coaching-playbooks/serving";
import type { TaskPlaybookReader } from "./index";

export { servedTaskRun, taskRun, type TaskPlaybookReader, type TaskRun } from "./index";

export function taskPlaybooksReader(database: Pool, env: Record<string, string | undefined> = process.env): TaskPlaybookReader {
  // Reads only: no Playbook Agent is checked against the models offered here, which only saving does.
  const playbooks = createCoachingPlaybooks(database, { serving: playbookServing(env), agentModels: () => [] });
  return (id) => playbooks.servedTask(id);
}
