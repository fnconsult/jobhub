import { getAi } from "@/ai/server";
import { playbookServing } from "@/coaching-playbooks/serving";
import { sharedPool } from "@/database/pool";
import { createGuardrails, type Guardrails } from "./index";
import { createGuardrailStore, type GuardrailStore } from "./store";

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
