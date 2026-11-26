import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { BACK_OFFICE_PAGES } from "./admin/back-office-nav";
import { proxy } from "./proxy";

const KEY = `jbx_agent_${"a".repeat(43)}`;

describe("the proxy and an Agent Key (#1139, ADR-0118)", () => {
  it("opens no HTML page of the Back Office with the key: 403 before the page runs, never a session", async () => {
    for (const page of [...Object.values(BACK_OFFICE_PAGES).map((each) => each.href), "/admin"]) {
      const response = await proxy(new NextRequest(`https://app.jobbbox.example${page}`, { headers: { authorization: `Bearer ${KEY}`, accept: "text/html" } }));

      expect(response.status, page).toBe(403);
      expect(response.headers.get("content-type"), page).toMatch(/application\/json/);
      expect(response.headers.get("set-cookie"), page).toBeNull();
    }
  });
});
