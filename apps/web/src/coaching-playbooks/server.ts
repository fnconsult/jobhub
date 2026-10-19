import { getAi } from "@/ai/server";
import { sharedPool } from "@/database/pool";
import { createCoachingPlaybooks, type CoachingPlaybooks } from "./index";
import { playbookServing } from "./serving";

let instance: CoachingPlaybooks | undefined;

/**
 * The app's Coaching Playbooks, on the database named by DATABASE_URL, serving what this environment
 * serves (JOBHUB_TARGET, ADR-0021); Playbook Agents may use the models the app's AI layer offers.
 */
export function getCoachingPlaybooks(): CoachingPlaybooks {
  instance ??= createCoachingPlaybooks(sharedPool(), { serving: playbookServing(process.env), agentModels: () => getAi().agentModels() });
  return instance;
}
