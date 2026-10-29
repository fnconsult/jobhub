type Env = Record<string, string | undefined>;

/**
 * What Nouveautés needs to know of the deployment (ADR-0063): the Version it serves (JOBHUB_VERSION, the root
 * package.json's, set at build time by next.config.ts) and whether it is the Beta, whose Version is not Promoted yet.
 * Production is JOBHUB_TARGET=production, or a production build that names no target (like the Playbooks' serving,
 * ADR-0021), so a deployment that forgets to say where it runs never shows a Release Note as not published. Staging,
 * the e2e suite and a developer's machine run what `main` carries: the Beta.
 */
export function nouveautesDeployment(env: Env): { version: string | null; beta: boolean } {
  const target = env.JOBHUB_TARGET?.trim();
  const production = target ? target === "production" : env.NODE_ENV === "production";
  return { version: env.JOBHUB_VERSION?.trim() || null, beta: !production };
}
