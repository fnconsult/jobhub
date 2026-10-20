import { getAi } from "@/ai/server";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { sharedPool } from "@/database/pool";
import { getGuardrailStore } from "@/guardrails/server";
import { createEvals, type Evals } from "./index";

let instance: Evals | undefined;

/**
 * The app's Eval Cases and Eval Runs (ADR-0023, #231), in this environment's database: every call on the app's
 * AI layer's `forEval()`, the Coaching Playbooks served here and the Guardrails as the Back Office tunes them.
 */
export function getEvals(): Evals {
  instance ??= createEvals(sharedPool(), { ai: getAi(), playbooks: getCoachingPlaybooks(), guardrails: getGuardrailStore().config });
  return instance;
}
