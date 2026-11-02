/**
 * What a session pending its second step reaches (ADR-0075): the second step's page, its endpoint and sign-out (or a
 * new sign-in by magic link), nothing else. Any other page sends it to the second step, to come back afterwards; any other API route, Better
 * Auth's own and those the extension calls included, and a Server Action posted to a page answer 401 with the stable
 * code SECOND_STEP_REQUIRED. Applied by the proxy (src/proxy.ts) before anything else of the app's runs, the CGU
 * Acceptance gate (ADR-0062) included.
 */
import { RETURN_PARAM, safeReturnPath } from "../auth/sign-in-return";
import { routes } from "../routes";

/** The code a refused request answers with: `{ error: SECOND_STEP_REQUIRED }`, 401. */
export const SECOND_STEP_REQUIRED = "second_step_required";
export const SECOND_STEP_PAGE = routes.secondStep;
/** Where the second step's page (and Mon compte, to confirm turning it off) posts a code. */
export const SECOND_STEP_ENDPOINT = "/api/two-step-verification/second-step";
/**
 * Better Auth's endpoints it reaches: signing out, and following a magic link, which signs in afresh (a new session,
 * pending again if the account has Two-step verification): a link opened from the email must not answer 401.
 */
const AUTH_OPEN = ["/api/auth/sign-out", "/api/auth/magic-link/verify"];

/** What the second step's page is drawn with, which holds no one's data: Next's own files, the public files. */
const FILES = ["/_next/", "/logos/"];
const FILE_PATHS = ["/robots.txt", "/sitemap.xml"];

export type GateDecision = "open" | "redirect" | "refuse";

/** What a request at `path` (with its query) made with `method` gets from a session pending its second step. */
export function pendingSessionGate(path: string, method: string): GateDecision {
  const pathname = path.split(/[?#]/, 1)[0]!;
  if (pathname === SECOND_STEP_ENDPOINT || AUTH_OPEN.includes(pathname)) return "open";
  if (pathname === "/api" || pathname.startsWith("/api/")) return "refuse";
  if (FILES.some((prefix) => pathname.startsWith(prefix)) || FILE_PATHS.includes(pathname)) return "open";
  if (method !== "GET" && method !== "HEAD") return "refuse";
  return pathname === SECOND_STEP_PAGE ? "open" : "redirect";
}

/** The second step's page, bringing the Candidate back to `back` (a page of this site) once it is done. */
export function secondStepHref(back: string | null): string {
  const path = safeReturnPath(back);
  return path && path !== routes.home && !path.startsWith(SECOND_STEP_PAGE) ? `${SECOND_STEP_PAGE}?${new URLSearchParams({ [RETURN_PARAM]: path })}` : SECOND_STEP_PAGE;
}

/** Where to go once the second step is done: `raw` when it is a page of this site other than the second step's, else home. */
export function secondStepReturn(raw: string | null | undefined): string {
  const path = safeReturnPath(raw);
  return path && !path.startsWith(SECOND_STEP_PAGE) ? path : routes.home;
}
