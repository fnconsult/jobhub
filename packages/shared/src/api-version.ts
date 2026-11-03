/**
 * The API Version (ADR-0063, #564): the whole number naming the contract between the extension and the web app.
 * Raised only when a change breaks an extension already installed (docs/ops/extension-api-version.md says when). The
 * extension states the one it speaks in API_VERSION_HEADER on every call; the web app serves this one and the one
 * before, and answers an older one, or none from an extension, `426 Upgrade Required` with EXTENSION_OUTDATED.
 */
export const API_VERSION = 1;

/** The request header in which the extension states its API Version. */
export const API_VERSION_HEADER = "Jobbbox-Api-Version";

/** The stable code of the 426 answer: the extension is asked to update itself (« Mettez à jour l'extension »). */
export const EXTENSION_OUTDATED = "extension_outdated";

/**
 * The stable code of the 401 every API route answers a session pending its second step (ADR-0075, #663): the extension
 * then says « Terminez votre connexion sur Jobbbox », with a link to SECOND_STEP_PATH. An older extension reads it as
 * signed out, which it is not far from: no version is raised for it.
 */
export const SECOND_STEP_REQUIRED = "second_step_required";

/** The web app's page where a session pending its second step finishes signing in. */
export const SECOND_STEP_PATH = "/connexion/deuxieme-etape";

/** The API Versions the web app serves: the current one and the one before (none below 1). */
export function servedApiVersions(current: number = API_VERSION): number[] {
  return current > 1 ? [current, current - 1] : [current];
}

/**
 * Whether a header's value names an API Version the web app serves: a whole number, written plainly, the current one
 * or the one before. A later one is let through too: the web app ships before the extension that raises it, so it is
 * never told to update; it only happens on a Beta a step behind.
 */
export function isServedApiVersion(value: string | null | undefined, current: number = API_VERSION): boolean {
  if (!value || !/^\d+$/.test(value.trim())) return false;
  return Number(value.trim()) >= Math.min(...servedApiVersions(current));
}
