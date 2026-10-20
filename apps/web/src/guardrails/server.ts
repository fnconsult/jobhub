import { getAi } from "@/ai/server";
import { playbookServing } from "@/coaching-playbooks/serving";
import { sharedPool } from "@/database/pool";
import { createGuardrails, type Guardrails } from "./index";
import { createGuardrailStore, type GuardrailStore, type GuardrailTriggerDay } from "./store";

let store: GuardrailStore | undefined;
let guardrails: Guardrails | undefined;

/**
 * The app's Guardrail settings, messages and triggers, on the database named by DATABASE_URL. Production
 * (JOBHUB_TARGET) serves only Human-validated Guardrail messages, like Playbook Versions (ADR-0021, ADR-0022).
 */
export function getGuardrailStore(): GuardrailStore {
  store ??= createGuardrailStore(sharedPool(), { serving: playbookServing(process.env) });
  return store;
}

/** The app's Guardrails, on the app's AI layer (task `guardrail`), as the Back Office tunes them. */
export function getGuardrails(): Guardrails {
  guardrails ??= (() => {
    const { config, triggers } = getGuardrailStore();
    return createGuardrails({ ai: getAi(), config, triggers });
  })();
  return guardrails;
}

/** The Guardrail Triggers of the last `days` days, per day and per Guardrail, newest first (the back office's view). */
export function guardrailTriggersOfLastDays(days: number): Promise<GuardrailTriggerDay[]> {
  return getGuardrailStore().triggersPerDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}
