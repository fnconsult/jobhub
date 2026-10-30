import { builtVersion, currentRelease } from "@/release";

type Env = Record<string, string | undefined>;

/**
 * What Nouveautés needs to know of the deployment (ADR-0063): the Version it serves and whether it is the Beta, whose
 * Version is not Promoted yet. Read from the Release (`@/release`, #559), like the Back Office and Mon compte.
 */
export function nouveautesDeployment(env: Env, version: string | null = builtVersion): { version: string | null; beta: boolean } {
  const release = currentRelease(env, version);
  return { version: release.version, beta: release.beta };
}
