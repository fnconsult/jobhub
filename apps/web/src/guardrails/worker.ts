/**
 * The Guardrails as the worker runs them (#446): Email intake's reading of an email is guarded there, on the worker's AI
 * layer, with the settings the Back Office tunes and its Guardrail Triggers recorded in Postgres, like the web app's.
 *
 *   const guardrails = workerGuardrails(database, ai);
 *   await guardrails.guardEmail({ candidateId, email: { text, authenticated }, read });
 */
import type { AiLayer } from "@jobhub/ai";
import type { Pool } from "pg";
import { playbookServing } from "../coaching-playbooks/serving";
import { createGuardrails, type Guardrails } from "./index";
import { createGuardrailStore } from "./store";

export * from "./index";

export function workerGuardrails(database: Pool, ai: AiLayer, env: Record<string, string | undefined> = process.env): Guardrails {
  const { config, triggers } = createGuardrailStore(database, { serving: playbookServing(env) });
  return createGuardrails({ ai, config, triggers });
}
