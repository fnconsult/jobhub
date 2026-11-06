import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, MOBILE_CLIENT } from "@jobhub/shared";

import { WEB_APP_URL } from "./web-app-url";

/** The web app the app calls (ADR-0076), from src/web-app-url.ts, the only place the app reads its address (#704). */
export { WEB_APP_URL };

/** The full address of `path` (an `/api/*` route, a page) on the web app. */
export const webAppAddress = (path: string) => new URL(path, WEB_APP_URL).toString();

/**
 * What the app states on every call to the web app: the API Version it speaks and that it is the Jobbbox app, so an
 * outdated one is answered 426 (#684). A call made with the session also sends its cookie (`AppSession.cookie`, #685).
 */
export const webAppHeaders = (): Record<string, string> => ({ [API_VERSION_HEADER]: String(API_VERSION), [API_CLIENT_HEADER]: MOBILE_CLIENT });

/**
 * Whether `url` is on the web app (`webApp`, the build's own unless given): its origin alone, scheme, host and port, never
 * a subdomain or a look-alike. The one rule for every address the app gives the session to: a WebView opens it (ADR-0076,
 * src/web and src/web-pages), a Tailored Document is downloaded from it (#695); any other opens in the system browser.
 */
export function isOnWebApp(url: string, webApp: string = WEB_APP_URL): boolean {
  try {
    return new URL(url).origin === new URL(webApp).origin;
  } catch {
    return false;
  }
}

/** At most this many redirects are followed for one call: more is a loop. */
const MAX_REDIRECTS = 5;

/**
 * `fetch` for a call that carries the session, its cookie set by hand (`useApi()`, a Tailored Document's download):
 * to `address` on the web app (`webApp`) alone, and its redirects followed here, never by the system, so the cookie
 * never follows one to another host (#756). A redirect on the web app is followed with the same headers, a 303 (or a
 * 301 or 302 after a write) as a read without its body, as browsers do; one off the web app, one with no address to read
 * (`opaqueredirect`), or a call that leaves the web app rejects before anything is sent there; more than MAX_REDIRECTS
 * rejects too. Answers the web app's last answer, a redirect's never.
 */
export async function fetchOnWebApp(fetch: typeof globalThis.fetch, address: string, init: RequestInit = {}, webApp: string = WEB_APP_URL): Promise<Response> {
  let url = address;
  let request: RequestInit = init;
  for (let redirects = 0; ; redirects++) {
    if (!isOnWebApp(url, webApp)) throw new Error("A call with the session goes off the web app");
    const response = await fetch(url, { ...request, redirect: "manual" });
    if (response.type !== "opaqueredirect" && (response.status < 300 || response.status >= 400 || response.status === 304)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("A call with the session was redirected off the web app, or to no address");
    if (redirects === MAX_REDIRECTS) throw new Error(`A call with the session followed more than ${MAX_REDIRECTS} redirects`);
    url = new URL(location, url).toString();
    const method = (request.method ?? "GET").toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
      request = { ...request, method: method === "HEAD" ? "HEAD" : "GET", body: undefined };
    }
  }
}
