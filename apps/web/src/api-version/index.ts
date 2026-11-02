/**
 * The API Version's guard (#564, ADR-0063): `src/proxy.ts` asks it about every request. A request under the contract
 * between the extension and the web app states a served API Version in API_VERSION_HEADER, or is answered
 * `426 Upgrade Required` with EXTENSION_OUTDATED, the store page to update from, and the API Version served.
 *
 * Under the contract: a request to `/api/` from a browser extension, or that states an API Version, from anywhere. An
 * extension's request is known by its Origin (`chrome-extension://…`), which the browser sends on a POST, or, on a GET,
 * which carries none, by `Sec-Fetch-Site: none` with `Sec-Fetch-Mode: cors`: a fetch no page started (a page's own is
 * `same-origin`, an address typed in the bar is `navigate`). The web app's own pages call the same routes without it, from their own
 * origin, and are let through. Outside it: the health check, sign-in (Better Auth's own endpoints, which tell an
 * outdated extension who is signed in, in which language), and the webhooks other services call (Stripe, Email
 * intake's MTA), which never send it.
 */
import { API_VERSION, API_VERSION_HEADER, EXTENSION_OUTDATED, isServedApiVersion } from "@jobhub/shared";

const OUTSIDE_PREFIXES = ["/api/health", "/api/auth", "/api/billing/webhook", "/api/email-intake/inbound"];

/** A browser extension's origin: `chrome-extension://<id>` (Chrome, Edge), `moz-extension://…`, `safari-web-extension://…`. */
const EXTENSION_ORIGIN = /^[a-z-]+-extension:\/\//i;

/** Whether a request falls under the contract with the extension (see above). */
export function underApiContract(pathname: string, headers: Headers): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (OUTSIDE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  return headers.has(API_VERSION_HEADER) || fromExtension(headers);
}

function fromExtension(headers: Headers): boolean {
  if (EXTENSION_ORIGIN.test(headers.get("origin") ?? "")) return true;
  return headers.get("sec-fetch-site") === "none" && headers.get("sec-fetch-mode") === "cors";
}

/** What a refused extension reads: the stable code, the store page to update from (null while none is set), the API Version served. */
export interface ExtensionOutdatedBody {
  error: typeof EXTENSION_OUTDATED;
  storeUrl: string | null;
  apiVersion: number;
}

/** The status a refused extension is answered with. */
export const UPGRADE_REQUIRED = 426;

/**
 * The body of the 426 answer for a request under the contract whose API Version is not served (older than the one
 * before, or none); null when it may go on. `storeUrl` is read only then: the Platform Setting EXTENSION_STORE_URL.
 */
export function apiVersionRefusal(pathname: string, headers: Headers, storeUrl: () => string | null): ExtensionOutdatedBody | null {
  if (!underApiContract(pathname, headers) || isServedApiVersion(headers.get(API_VERSION_HEADER))) return null;
  return { error: EXTENSION_OUTDATED, storeUrl: storeUrl(), apiVersion: API_VERSION };
}
