import type { PlaybookServing } from "./index";

type Env = Record<string, string | undefined>;

/** Where the app runs, as deploy/deploy.sh names it (JOBHUB_TARGET), plus the e2e suite's and a developer's machine. */
const TARGETS = ["production", "staging", "e2e", "development"] as const;

/**
 * Which Playbook Versions the app serves (ADR-0019, ADR-0021): in production only the latest
 * Human-validated one, elsewhere the latest one. Production is JOBHUB_TARGET=production, or a
 * production build (NODE_ENV=production) that names no target, so a deployment that forgets to
 * say where it runs never serves unvalidated advice. An unknown target is refused.
 */
export function playbookServing(env: Env): PlaybookServing {
  const target = env.JOBHUB_TARGET?.trim();
  if (!target) return env.NODE_ENV === "production" ? "validated" : "latest";
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error(`JOBHUB_TARGET must be one of ${TARGETS.join(", ")}, not "${target}"`);
  return target === "production" ? "validated" : "latest";
}
