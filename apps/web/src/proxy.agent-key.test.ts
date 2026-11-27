import { NextRequest, type NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { BACK_OFFICE_PAGES } from "./admin/back-office-nav";
import { proxy } from "./proxy";

const KEY = `jbx_agent_${"a".repeat(43)}`;
const asked = (path: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`https://app.jobbbox.example${path}`, { headers: { accept: "text/html", ...headers } }));

/** The request headers the proxy passes on to the page or route (Next's middleware override), by name. */
function forwarded(response: NextResponse): Map<string, string | null> {
  const names = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  return new Map(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]));
}

/** What the proxy answers, apart from the request headers it passes on. */
const answer = (response: NextResponse) => ({
  status: response.status,
  location: response.headers.get("location"),
  rewrite: response.headers.get("x-middleware-rewrite"),
  next: response.headers.get("x-middleware-next"),
  setCookie: response.headers.get("set-cookie"),
});

describe("the proxy and an Agent Key (#1139, #1172, ADR-0118)", () => {
  it("ignores the key outside its scope: /api/health and a public page are answered as without one", async () => {
    for (const path of ["/api/health", "/", "/legal/cgu", "/en/legal/cgu", "/aide"]) {
      const withKey = await asked(path, { authorization: `Bearer ${KEY}` });
      const without = await asked(path);

      expect(answer(withKey), path).toEqual(answer(without));
      expect(withKey.status, path).not.toBe(403);
      expect(forwarded(withKey).has("authorization"), path).toBe(false);
      expect(forwarded(withKey), path).toEqual(forwarded(without));
    }
  });

  it("opens no page of the Back Office with the key: the page gets the request without it, as an anonymous one, or with the cookie's session alone", async () => {
    for (const page of [...Object.values(BACK_OFFICE_PAGES).map((each) => each.href), "/admin"]) {
      const response = await asked(page, { authorization: `Bearer ${KEY}`, cookie: "jobhub_session=s" });

      expect(response.status, page).not.toBe(403);
      expect(response.headers.get("set-cookie"), page).toBeNull();
      const headers = forwarded(response);
      expect(headers.has("authorization"), page).toBe(false);
      expect(headers.get("cookie"), page).toBe("jobhub_session=s");
    }
  });

  it("keeps the key on its scope's routes, where each call checks it", async () => {
    const response = await asked("/admin/api/signalements", { authorization: `Bearer ${KEY}` });

    expect(forwarded(response).get("authorization")).toBe(`Bearer ${KEY}`);
  });
});
