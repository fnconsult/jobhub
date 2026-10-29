// The root package.json, bundled into the build like any module: its Version reaches the page with no environment
// variable to set at build or run time (next.config.ts's `env` only inlines `process.env.X` read by name, #470).
import rootManifest from "../../../../package.json";

type Env = Record<string, string | undefined>;

/**
 * The Version this build serves (ADR-0063): the root package.json's, on `main` the next one, the Beta's; on `prod`
 * the one Promoted. Null when it carries none.
 */
export const builtVersion: string | null = typeof rootManifest.version === "string" ? rootManifest.version : null;

/**
 * What Nouveautés needs to know of the deployment (ADR-0063): the Version it serves (the build's, `builtVersion`) and
 * whether it is the Beta, whose Version is not Promoted yet. Production is JOBHUB_TARGET=production, or a production
 * build that names no target (like the Playbooks' serving, ADR-0021), so a deployment that forgets to say where it
 * runs never shows a Release Note as not published. Staging, the e2e suite and a developer's machine run what `main`
 * carries: the Beta.
 */
export function nouveautesDeployment(env: Env, version: string | null = builtVersion): { version: string | null; beta: boolean } {
  const target = env.JOBHUB_TARGET?.trim();
  const production = target ? target === "production" : env.NODE_ENV === "production";
  return { version: version?.trim() || null, beta: !production };
}
