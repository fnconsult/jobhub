/**
 * The web app's API as the app calls it (ADR-0076): the same `/api/*` routes as the web pages, with the session's
 * cookie sent by hand (`@better-auth/expo` keeps it in the Keychain or Keystore; nothing else holds it, so the request
 * carries no other cookie), the app named in API_CLIENT_HEADER and its API Version in API_VERSION_HEADER (an outdated
 * app is answered 426, #704), and the app's origin, which the web app trusts for a write as it trusts its own pages'
 * (a native request has no Origin of its own).
 *
 *   const api = createApi({ baseURL, cookie: () => session.cookie() });
 *   await api.fetch("/api/coach", { method: "POST", body });     // the Response, whatever its status
 *   await api.read("/api/applications", applicationsResponseSchema); // a GET's body, parsed, or it throws
 */
import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_ORIGIN, MOBILE_CLIENT } from "@jobhub/shared";

export interface Api {
  /** `path` on the web app, as the app sends it; a JSON body unless the call says otherwise. Rejects offline. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** A GET of `path`, its JSON body parsed by `schema`; throws on any other status than a success, or a body the schema refuses. */
  read<T>(path: string, schema: { parse: (body: unknown) => T }): Promise<T>;
}

export function createApi({
  baseURL,
  cookie,
  fetch = globalThis.fetch,
}: {
  baseURL: string;
  /** The session cookie to send, as `@better-auth/expo` gives it (empty when signed out). */
  cookie: () => Promise<string>;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}): Api {
  const base = baseURL.replace(/\/$/, "");
  const api: Api = {
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
      headers.set("cookie", await cookie());
      headers.set("origin", APP_ORIGIN);
      headers.set(API_CLIENT_HEADER, MOBILE_CLIENT);
      headers.set(API_VERSION_HEADER, String(API_VERSION));
      return fetch(`${base}${path}`, { ...init, headers, credentials: "omit" });
    },
    async read(path, schema) {
      const response = await api.fetch(path);
      if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
      return schema.parse(await response.json());
    },
  };
  return api;
}
