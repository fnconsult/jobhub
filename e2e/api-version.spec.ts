import { API_VERSION, API_VERSION_HEADER, EXTENSION_OUTDATED } from "@jobhub/shared";
import { expect, test, type APIRequestContext } from "@playwright/test";

// Issue #564 (ADR-0063): the API Version between the extension and the web app. The web app serves the current one
// and the one before (N and N−1, packages/shared/src/api-version.test.ts for any N; N is 1 today, so 0 is N−1's
// predecessor here); an older one, or none from an extension, is answered 426 with a stable code. The Side Panel's
// « Mettez à jour l'extension » is e2e/extension.spec.ts's.
const origin = process.env.E2E_WEB_ORIGIN!;
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

/** Every route the extension calls (apps/extension/src/jobbbox-api.ts, job-sites.ts), as it calls it. */
const EXTENSION_ROUTES: { method: "GET" | "POST"; path: string; data?: unknown }[] = [
  { method: "POST", path: "/api/job-offers", data: { source: {}, title: "DAF", content: "Poste." } },
  { method: "POST", path: "/api/cv/draft", data: {} },
  { method: "POST", path: "/api/match-score", data: { jobOfferId: "00000000-0000-0000-0000-000000000000" } },
  { method: "GET", path: "/api/profiles" },
  { method: "POST", path: "/api/profiles", data: {} },
  { method: "POST", path: "/api/applications", data: {} },
  { method: "GET", path: "/api/job-sites" },
];

const call = (request: APIRequestContext, route: (typeof EXTENSION_ROUTES)[number], headers: Record<string, string>) =>
  request.fetch(`${origin}${route.path}`, { method: route.method, headers, ...(route.data === undefined ? {} : { data: route.data }) });

test.describe("the API Version between the extension and the web app (#564)", () => {
  for (const route of EXTENSION_ROUTES) {
    test(`${route.method} ${route.path}: served in the current API Version; 426 in an older one, or none`, async ({ request }) => {
      const served = await call(request, route, { origin: EXTENSION, [API_VERSION_HEADER]: String(API_VERSION) });
      expect(served.status()).not.toBe(426);

      for (const headers of [{ origin: EXTENSION }, { origin: EXTENSION, [API_VERSION_HEADER]: String(API_VERSION - 1) }]) {
        const refused = await call(request, route, headers);
        expect(refused.status()).toBe(426);
        expect(await refused.json()).toMatchObject({ error: EXTENSION_OUTDATED, apiVersion: API_VERSION });
        expect(refused.headers()["cache-control"]).toBe("no-store");
      }
    });
  }

  test("an extension's GET, which carries no Origin, is known by the fetch no page started", async ({ request }) => {
    const route = EXTENSION_ROUTES.find(({ path }) => path === "/api/job-sites")!;
    const extensionGet = { "sec-fetch-site": "none", "sec-fetch-mode": "cors" };
    expect((await call(request, route, extensionGet)).status()).toBe(426);
    expect((await call(request, route, { ...extensionGet, [API_VERSION_HEADER]: String(API_VERSION) })).status()).toBe(200);
  });

  test("the web app's own pages call the same routes without it", async ({ request }) => {
    for (const route of EXTENSION_ROUTES) {
      expect((await call(request, route, { origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })).status(), route.path).not.toBe(426);
      expect((await call(request, route, {})).status(), route.path).not.toBe(426);
    }
  });

  test("the Stripe and Email intake webhooks need no API Version", async ({ request }) => {
    for (const path of ["/api/billing/webhook", "/api/email-intake/inbound"]) {
      for (const headers of [{}, { origin: EXTENSION }]) {
        const response = await request.post(`${origin}${path}`, { headers: { ...headers, "content-type": "application/json" }, data: "{}" });
        // Refused for their own reasons (no signature, no secret), never as an outdated extension.
        expect(response.status(), path).not.toBe(426);
      }
    }
  });

  test("/api/health names the API Version served", async ({ request }) => {
    expect(await (await request.get(`${origin}/api/health`)).json()).toMatchObject({ apiVersion: API_VERSION });
  });
});
