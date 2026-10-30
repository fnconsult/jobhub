/**
 * Bringing a signed-out visitor back where they were (#542): a page that needs a Candidate sends them to sign in with
 * `?suite=<the page>`, and `&raison=session-expiree` when their session cookie outlived the session. Sign-in goes
 * back there, but only to a path of this site: never another origin (no open redirect).
 */
import { routes } from "../routes";

/** The `?suite=` parameter: the page to come back to. */
export const RETURN_PARAM = "suite";
/** The `?raison=` parameter: why sign-in is asked. */
export const REASON_PARAM = "raison";
/** The one reason sign-in says so far: the session expired. Any other value is ignored, never shown. */
export const SESSION_EXPIRED = "session-expiree";

const ORIGIN = "https://jobbbox.invalid";

/** `raw` if it is a path of this site (`/compte?x=1`), else null: not `//host`, `/\host`, a scheme, nor control characters. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if ([...raw].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  try {
    const url = new URL(raw, ORIGIN);
    return url.origin === ORIGIN ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** The sign-in page (`signIn`) bringing back to `back` (when it is a page of this site), saying the session `expired`. */
export function signInHref(back: string | null, expired: boolean, signIn: string = routes.signIn): string {
  const params = new URLSearchParams();
  const path = safeReturnPath(back);
  if (path && path !== signIn) params.set(RETURN_PARAM, path);
  if (expired) params.set(REASON_PARAM, SESSION_EXPIRED);
  const query = params.toString();
  return query ? `${signIn}?${query}` : signIn;
}
