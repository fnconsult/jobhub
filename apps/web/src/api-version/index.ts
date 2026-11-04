/**
 * The API Version's guard (#564, ADR-0063): `src/proxy.ts` asks it about every request. A request under the contract
 * between the web app and its clients states a served API Version in API_VERSION_HEADER, or is answered
 * `426 Upgrade Required` with the client's code (EXTENSION_OUTDATED, APP_OUTDATED), the store page to update from, and
 * the API Version served.
 *
 * Under the contract: a request to `/api/` from a browser extension or from the Jobbbox app (#684, ADR-0076), or that
 * states an API Version, from anywhere. The app is known by API_CLIENT_HEADER naming MOBILE_CLIENT: a native fetch sends
 * no Origin. Its store pages come with its builds (#704): until then its 426 names none. An
 * extension's request is known by its Origin (`chrome-extension://…`), which the browser sends on a POST, or, on a GET,
 * which carries none, by `Sec-Fetch-Site: none` with `Sec-Fetch-Mode: cors`: a fetch no page started (a page's own is
 * `same-origin`, an address typed in the bar is `navigate`). The web app's own pages call the same routes without it, from their own
 * origin, and are let through. Outside it: the health check, sign-in (Better Auth's own endpoints, which tell an
 * outdated extension who is signed in, in which language), and the webhooks other services call (Stripe, Email
 * intake's MTA), which never send it.
 */
import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_OUTDATED, EXTENSION_OUTDATED, isServedApiVersion, MOBILE_CLIENT } from "@jobhub/shared";

const OUTSIDE_PREFIXES = ["/api/health", "/api/auth", "/api/billing/webhook", "/api/email-intake/inbound"];

/** A browser extension's origin: `chrome-extension://<id>` (Chrome, Edge), `moz-extension://…`, `safari-web-extension://…`. */
const EXTENSION_ORIGIN = /^[a-z-]+-extension:\/\//i;

/** Whether a request falls under the contract with the extension (see above). */
export function underApiContract(pathname: string, headers: Headers): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (OUTSIDE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  return headers.has(API_VERSION_HEADER) || fromExtension(headers) || fromApp(headers);
}

/** The Jobbbox app names itself in API_CLIENT_HEADER. */
function fromApp(headers: Headers): boolean {
  return headers.get(API_CLIENT_HEADER) === MOBILE_CLIENT;
}

function fromExtension(headers: Headers): boolean {
  if (EXTENSION_ORIGIN.test(headers.get("origin") ?? "")) return true;
  return headers.get("sec-fetch-site") === "none" && headers.get("sec-fetch-mode") === "cors";
}

/** What a refused client reads: its stable code, the store page to update from (null while none is set), the API Version served. */
export interface ClientOutdatedBody {
  error: typeof EXTENSION_OUTDATED | typeof APP_OUTDATED;
  storeUrl: string | null;
  apiVersion: number;
}

/** The status a refused client is answered with. */
export const UPGRADE_REQUIRED = 426;

/**
 * The body of the 426 answer for a request under the contract whose API Version is not served (older than the one
 * before, or none); null when it may go on. `storeUrl` is read only then, and only for the extension: the Platform
 * Setting EXTENSION_STORE_URL.
 */
export function apiVersionRefusal(pathname: string, headers: Headers, storeUrl: () => string | null): ClientOutdatedBody | null {
  if (!underApiContract(pathname, headers) || isServedApiVersion(headers.get(API_VERSION_HEADER))) return null;
  if (fromApp(headers)) return { error: APP_OUTDATED, storeUrl: null, apiVersion: API_VERSION };
  return { error: EXTENSION_OUTDATED, storeUrl: storeUrl(), apiVersion: API_VERSION };
}
