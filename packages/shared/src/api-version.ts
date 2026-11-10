/**
 * The API Version (ADR-0063, #564): the whole number naming the contract between the web app and its clients, the
 * extension and the Jobbbox app (ADR-0076, #684). Raised only when a change breaks a client already installed
 * (docs/ops/extension-api-version.md says when). A client states the one it speaks in API_VERSION_HEADER on every call;
 * the web app serves this one and the one before, and answers an older one, or none, `426 Upgrade Required` with
 * EXTENSION_OUTDATED for the extension, APP_OUTDATED for the app.
 */
export const API_VERSION = 1;

/** The request header in which the extension states its API Version. */
export const API_VERSION_HEADER = "Jobbbox-Api-Version";

/** The stable code of the 426 answer: the extension is asked to update itself (« Mettez à jour l'extension »). */
export const EXTENSION_OUTDATED = "extension_outdated";

/**
 * The request header in which a native client names itself: a native fetch sends no Origin and no Sec-Fetch headers, so
 * the web app knows the Jobbbox app by it, as it knows the extension by its origin (ADR-0076, #684).
 */
export const API_CLIENT_HEADER = "Jobbbox-Client";

/** What the Jobbbox app (iOS, iPadOS, Android) states in API_CLIENT_HEADER on every call. */
export const MOBILE_CLIENT = "mobile";

/** The stable code of the 426 answer to the Jobbbox app: it is asked to update itself (« Mettre à jour Jobbbox », #704). */
export const APP_OUTDATED = "app_outdated";

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

/**
 * The request header in which the extension states its Extension Version (#924), on every call beside its API Version:
 * kept with each Extension Event, and read by the API Version's guard (MINIMUM_EXTENSION_VERSION). Adding it changed no
 * contract: a server that does not read it ignores it.
 */
export const EXTENSION_VERSION_HEADER = "Jobbbox-Extension-Version";

/**
 * The oldest Extension Version the web app serves when a call states one (#924): raised to ask the extensions before it to
 * update without raising the API Version. An extension that states no version (any before 0.2.0) is judged on its API
 * Version alone. 0.2.0 is the first that states it, so nothing is refused by it yet.
 */
export const MINIMUM_EXTENSION_VERSION = "0.2.0";

/** An Extension Version as the stores require it, X.Y.Z, digits only (each part at most 4 digits); null for anything else. */
export function readExtensionVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(trimmed) ? trimmed : null;
}

/**
 * Whether a call's stated Extension Version is served: `minimum` or later, compared part by part. One that states none,
 * or none readable, is served: its API Version alone decides.
 */
export function isServedExtensionVersion(value: string | null | undefined, minimum: string = MINIMUM_EXTENSION_VERSION): boolean {
  const stated = readExtensionVersion(value);
  if (!stated) return true;
  const parts = stated.split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (parts[i] !== floor[i]) return parts[i]! > floor[i]!;
  return true;
}
