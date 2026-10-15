import type { KnowledgeEnvironment } from "@jobhub/coach-knowledge";

const ENVIRONMENTS: readonly KnowledgeEnvironment[] = ["production", "development", "eval"];

/**
 * Which coaching knowledge the app serves (ADR-0019): in production only what a human
 * validated, elsewhere everything. COACH_KNOWLEDGE_ENVIRONMENT (production | development | eval)
 * overrides it, e.g. so the e2e suite can try unvalidated playbooks on a production build.
 */
export function knowledgeEnvironment(env: Record<string, string | undefined>): KnowledgeEnvironment {
  const chosen = env.COACH_KNOWLEDGE_ENVIRONMENT?.trim();
  if (!chosen) return env.NODE_ENV === "production" ? "production" : "development";
  if (!(ENVIRONMENTS as readonly string[]).includes(chosen)) {
    throw new Error(`COACH_KNOWLEDGE_ENVIRONMENT must be one of ${ENVIRONMENTS.join(", ")}, not "${chosen}"`);
  }
  return chosen as KnowledgeEnvironment;
}
