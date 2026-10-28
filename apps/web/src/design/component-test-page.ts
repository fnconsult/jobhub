import type { Density } from "@jobhub/shared/design";

type Env = Record<string, string | undefined>;

/** Where the components' test page lives: every Design System component on one page, for the e2e suite's axe and keyboard checks. */
export const COMPONENT_TEST_PAGE = "/design-system/composants";

/**
 * Whether the components' test page (#462) is served: to the e2e suite (JOBHUB_TARGET=e2e) and on a developer's
 * machine, never in production or on staging, nor by a production build that names no target (like the Playbooks'
 * serving, ADR-0021). The Design System page of the Back Office (#463) is the one Administrators read.
 */
export function componentTestPageServed(env: Env): boolean {
  const target = env.JOBHUB_TARGET?.trim();
  if (target) return target === "e2e" || target === "development";
  return env.NODE_ENV !== "production";
}

/** The Density the test page is shown in: Compact when its address says `?densite=compact`, Confort otherwise. */
export function densityOfTestPage(densite: string | string[] | undefined): Density {
  const value = Array.isArray(densite) ? densite[0] : densite;
  return value === "compact" ? "compact" : "confort";
}
