import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_OUTDATED, EXTENSION_OUTDATED, EXTENSION_VERSION_HEADER, MOBILE_CLIENT } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { apiVersionRefusal, fromExtension, fromJobbboxApp, underApiContract } from ".";

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const STORE = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";
/** Every route the extension calls (apps/extension/src/jobbbox-api.ts, job-sites.ts). */
const EXTENSION_ROUTES = ["/api/job-offers", "/api/cv/draft", "/api/match-score", "/api/profiles", "/api/applications", "/api/job-sites"];

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

/** The guard as `src/proxy.ts` asks it. */
const refusal = (pathname: string, values: Record<string, string>) => apiVersionRefusal(pathname, headers(values), () => STORE);

describe("the API Version's guard (#564)", () => {
  it.each(EXTENSION_ROUTES)("serves %s to an extension stating the current API Version", (route) => {
    expect(refusal(route, { origin: EXTENSION, [API_VERSION_HEADER]: String(API_VERSION) })).toBeNull();
  });

  it.each(EXTENSION_ROUTES)("answers %s 426 with the stable code and the store page to an extension stating none", (route) => {
    expect(refusal(route, { origin: EXTENSION })).toEqual({ error: EXTENSION_OUTDATED, storeUrl: STORE, apiVersion: API_VERSION });
  });

  it("refuses an API Version no longer served, from an extension or anywhere else stating one", () => {
    // N and N−1 for any N: packages/shared/src/api-version.test.ts. N is 1 today, so 0 is the one no longer served.
    const at = (version: string, origin = EXTENSION) => refusal("/api/job-offers", { origin, [API_VERSION_HEADER]: version });
    expect(at(String(API_VERSION))).toBeNull();
    expect(at(String(API_VERSION - 1))).toMatchObject({ error: EXTENSION_OUTDATED });
    expect(at(String(API_VERSION - 1), "https://app.jobbbox.fr")).toMatchObject({ error: EXTENSION_OUTDATED });
    expect(at("beta")).toMatchObject({ error: EXTENSION_OUTDATED });
  });

  it("names no store page while none is set", () => {
    expect(apiVersionRefusal("/api/profiles", headers({ origin: EXTENSION }), () => null)).toMatchObject({ storeUrl: null });
  });

  it("knows an extension's GET, which carries no Origin, by the fetch no page started", () => {
    // What Chrome sends on an extension's GET to a host it is granted (#564): no Origin, Sec-Fetch-Site none, mode cors.
    expect(refusal("/api/job-sites", { "sec-fetch-site": "none", "sec-fetch-mode": "cors" })).toMatchObject({ error: EXTENSION_OUTDATED });
    expect(refusal("/api/job-sites", { "sec-fetch-site": "none", "sec-fetch-mode": "cors", [API_VERSION_HEADER]: String(API_VERSION) })).toBeNull();
  });

  it("lets the web app's own pages call the same routes without it", () => {
    for (const route of EXTENSION_ROUTES) {
      expect(refusal(route, { origin: "https://app.jobbbox.fr", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })).toBeNull();
      expect(refusal(route, { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })).toBeNull();
      // An address typed in the browser's bar.
      expect(refusal(route, { "sec-fetch-site": "none", "sec-fetch-mode": "navigate" })).toBeNull();
      // A server or a script, which says nothing.
      expect(refusal(route, {})).toBeNull();
    }
  });

  it("knows the extensions of Chrome and Edge, Firefox and Safari by their origin", () => {
    for (const origin of [EXTENSION, "moz-extension://5f1b0e3a-1111-4c2d-9e8f-000000000000", "safari-web-extension://ABCD"]) {
      expect(underApiContract("/api/job-offers", headers({ origin }))).toBe(true);
    }
  });

  it("tells the extension's request from the web's and the app's, which « Suivre » in the Side Panel records as an Arrival « Extension » (#819)", () => {
    expect(fromExtension(headers({ origin: EXTENSION }))).toBe(true);
    expect(fromExtension(headers({ origin: "moz-extension://5b1c2d3e-0000-4000-8000-000000000000" }))).toBe(true);
    expect(fromExtension(headers({ origin: "https://jobbbox.ai" }))).toBe(false);
    expect(fromExtension(headers({ [API_CLIENT_HEADER]: MOBILE_CLIENT }))).toBe(false);
  });

  it("leaves out the webhooks, the health check, sign-in and the pages", () => {
    for (const route of ["/api/billing/webhook", "/api/email-intake/inbound", "/api/health", "/api/auth/get-session", "/api/auth/sign-out", "/compte", "/"]) {
      expect(refusal(route, { origin: EXTENSION })).toBeNull();
      expect(refusal(route, { origin: EXTENSION, [API_VERSION_HEADER]: "0" })).toBeNull();
    }
  });

  it("reads the store page only for a refusal", () => {
    let reads = 0;
    apiVersionRefusal("/api/job-offers", headers({ origin: EXTENSION, [API_VERSION_HEADER]: String(API_VERSION) }), () => (reads++, STORE));
    expect(reads).toBe(0);
  });

  describe("the Jobbbox app, a mobile client (#684, ADR-0076)", () => {
    /** What the app sends on every call: no Origin and no Sec-Fetch headers (a native fetch), its client and its API Version. */
    const app = (version?: string) => ({ [API_CLIENT_HEADER]: MOBILE_CLIENT, ...(version === undefined ? {} : { [API_VERSION_HEADER]: version }) });
    /** The GETs the app reads its cards with, and a route it writes with. */
    const APP_ROUTES = ["/api/applications", "/api/applications/abc", "/api/job-searches", "/api/job-digests", "/api/agenda", "/api/coaching", "/api/profiles", "/api/coach/conversations"];

    it.each(APP_ROUTES)("knows the app's request to %s by its client header, as it knows the extension's by its origin", (route) => {
      expect(underApiContract(route, headers(app()))).toBe(true);
    });

    it.each(APP_ROUTES)("serves %s to the app stating the current API Version", (route) => {
      expect(refusal(route, app(String(API_VERSION)))).toBeNull();
    });

    it("answers an outdated app 426 with the app's own code, never the extension's store page", () => {
      // The store pages of the app (App Store, Play) come with its builds (#704): none is named yet.
      expect(refusal("/api/applications", app())).toEqual({ error: APP_OUTDATED, storeUrl: null, apiVersion: API_VERSION });
      expect(refusal("/api/agenda", app(String(API_VERSION - 1)))).toEqual({ error: APP_OUTDATED, storeUrl: null, apiVersion: API_VERSION });
    });

    it("leaves the app's sign-in, the health check and the webhooks out, as for the extension", () => {
      for (const route of ["/api/health", "/api/auth/get-session", "/api/billing/webhook"]) expect(refusal(route, app())).toBeNull();
    });

    it("ignores a client header naming no client it knows", () => {
      expect(underApiContract("/api/applications", headers({ [API_CLIENT_HEADER]: "desktop" }))).toBe(false);
    });

    it("tells the app's request from the web's, which an Acceptance records as its origin (#689)", () => {
      expect(fromJobbboxApp(headers(app(String(API_VERSION))))).toBe(true);
      expect(fromJobbboxApp(headers({ origin: "https://jobbbox.ai" }))).toBe(false);
      expect(fromJobbboxApp(headers({ [API_CLIENT_HEADER]: "desktop" }))).toBe(false);
    });
  });
});

describe("the Extension Version a call states, beside its API Version (#924)", () => {
  const at = (extensionVersion: string | null, apiVersion: string | null = String(API_VERSION), headersOf: Record<string, string> = { origin: EXTENSION }) =>
    apiVersionRefusal(
      "/api/job-offers",
      headers({ ...headersOf, ...(apiVersion === null ? {} : { [API_VERSION_HEADER]: apiVersion }), ...(extensionVersion === null ? {} : { [EXTENSION_VERSION_HEADER]: extensionVersion }) }),
      () => STORE,
      "0.3.0",
    );

  it("asks an extension older than the minimum Extension Version to update, though its API Version is served", () => {
    expect(at("0.2.9")).toEqual({ error: EXTENSION_OUTDATED, storeUrl: STORE, apiVersion: API_VERSION });
    expect(at("0.3.0")).toBeNull();
    expect(at("1.0.0")).toBeNull();
  });

  it("still asks an API Version no longer served to update, whatever Extension Version it states", () => {
    expect(at("9.0.0", null)).toMatchObject({ error: EXTENSION_OUTDATED });
  });

  it("judges an extension stating none, or none it can read, on its API Version alone", () => {
    expect(at(null)).toBeNull();
    expect(at("latest")).toBeNull();
  });

  it("reads it only from the extension: the web app's pages and the Jobbbox app are not judged on it", () => {
    expect(at("0.0.1", String(API_VERSION), { origin: "https://jobbbox.ai" })).toBeNull();
    expect(at("0.0.1", String(API_VERSION), { [API_CLIENT_HEADER]: MOBILE_CLIENT })).toBeNull();
  });
});
