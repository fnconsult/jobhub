import { getAi } from "@/ai/server";
import { sharedPool } from "@/database/pool";
import { hasEvalRunOn } from "@/evals";
import { createCoachingPlaybooks, type CoachingPlaybooks } from "./index";
import { playbookServing } from "./serving";

let instance: CoachingPlaybooks | undefined;

/**
 * The app's Coaching Playbooks, on the database named by DATABASE_URL, serving what this environment
 * serves (JOBHUB_TARGET, ADR-0021); Playbook Agents may use the models the app's AI layer offers, a task
 * Playbook's searches the web-search providers it offers (ADR-0026), and a version is Human-validated only
 * after an Eval Run on it (ADR-0023).
 */
export function getCoachingPlaybooks(): CoachingPlaybooks {
  instance ??= createCoachingPlaybooks(sharedPool(), { serving: playbookServing(process.env), agentModels: () => getAi().agentModels(), searchModels: () => getAi().searchModels(), evalRunOn: hasEvalRunOn });
  return instance;
}
