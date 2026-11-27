import { describe, expect, it } from "vitest";
import { BACK_OFFICE_PAGES } from "../admin/back-office-nav";
import { agentCall, bearerKey, withoutAgentKeyOutOfScope } from "./http";
import type { AgentKeys, Authorization } from "./index";

const KEY = `jbx_agent_${"a".repeat(43)}`;
const withKey = (value = KEY) => new Headers({ authorization: `Bearer ${value}` });

describe("an Agent Key over HTTP (#1139, ADR-0118)", () => {
  it("is read from Authorization: Bearer", () => {
    expect(bearerKey(withKey())).toBe(KEY);
    expect(bearerKey(new Headers({ authorization: `bearer  ${KEY} ` }))).toBe(KEY);
    expect(bearerKey(new Headers())).toBeNull();
    expect(bearerKey(new Headers({ authorization: `Basic ${KEY}` }))).toBeNull();
  });

  it("is ignored outside its scope's routes: the request goes on as if it carried none, on every Back Office page and every other route", () => {
    const pages = Object.values(BACK_OFFICE_PAGES).map((page) => page.href.split("?")[0]!);
    expect(pages.length).toBeGreaterThan(10);
    for (const path of [...pages, "/admin", "/admin/parametres", "/admin/connexion", "/admin/api/autre", "/admin/api/signalementsx", "/api/admin/assistant", "/api/signalements", "/api/health", "/compte", "/"]) {
      const headers = new Headers({ authorization: `Bearer ${KEY}`, cookie: "jobhub_session=s", accept: "text/html" });
      const forwarded = withoutAgentKeyOutOfScope(path, headers);
      expect(forwarded.get("authorization"), path).toBeNull();
      // The rest of the request, its session cookie included, goes on untouched.
      expect(forwarded.get("cookie"), path).toBe("jobhub_session=s");
      expect(forwarded.get("accept"), path).toBe("text/html");
      // The request's own headers are left as they were.
      expect(headers.get("authorization"), path).toBe(`Bearer ${KEY}`);
    }
  });

  it("is kept on its scope's routes, to be checked there, and any other Authorization goes on untouched", () => {
    for (const path of ["/admin/api/signalements", "/admin/api/signalements/0b6c2f1e-1111-4111-8111-111111111111", "/admin/api/signalements/0b6c2f1e-1111-4111-8111-111111111111/statut"])
      expect(withoutAgentKeyOutOfScope(path, withKey()).get("authorization"), path).toBe(`Bearer ${KEY}`);
    expect(withoutAgentKeyOutOfScope("/admin/parametres", new Headers()).get("authorization")).toBeNull();
    expect(withoutAgentKeyOutOfScope("/api/email-intake", new Headers({ authorization: "Bearer another-token" })).get("authorization")).toBe("Bearer another-token");
  });

  describe("a call in its scope", () => {
    const keysAnswering = (authorization: Authorization) => {
      const asked: unknown[] = [];
      const keys: Pick<AgentKeys, "authorize"> = {
        authorize: async (...args) => {
          asked.push(args);
          return authorization;
        },
      };
      return { keys, asked };
    };
    const request = (path: string, headers = withKey()) => new Request(`https://app.jobbbox.example${path}`, { headers });

    it("is checked against the database with its method and path", async () => {
      const key = { id: "k", name: "triage-beta", scope: "signalements" as const, createdAt: new Date(), expiresAt: new Date(), revokedAt: null, lastUsedAt: null };
      const { keys, asked } = keysAnswering({ ok: true, key });

      expect(await agentCall(request("/admin/api/signalements?statut=nouveau"), "signalements", keys)).toEqual({ ok: true, key });
      expect(asked).toEqual([[KEY, "signalements", { method: "GET", path: "/admin/api/signalements?statut=nouveau" }]]);
    });

    it("answers 401 and 429 as the key's check says, never cached", async () => {
      for (const [authorization, status, error] of [
        [{ ok: false, status: 401, reason: "revoked" }, 401, "unauthorized"],
        [{ ok: false, status: 401, reason: "out_of_scope" }, 401, "unauthorized"],
        [{ ok: false, status: 429, reason: "rate_limited" }, 429, "rate_limited"],
      ] as const) {
        const called = await agentCall(request("/admin/api/signalements"), "signalements", keysAnswering(authorization).keys);
        if (called.ok) throw new Error("let through");
        expect(called.response.status).toBe(status);
        expect(called.response.headers.get("cache-control")).toBe("no-store");
        expect(await called.response.json()).toEqual({ error });
      }
    });

    it("ignores the key when the route is not one of its scope's: checked as a call without one, answered as to an anonymous caller", async () => {
      const { keys, asked } = keysAnswering({ ok: false, status: 401, reason: "missing" });

      const called = await agentCall(request("/admin/api/autre"), "signalements", keys);
      expect(asked).toEqual([[null, "signalements", { method: "GET", path: "/admin/api/autre" }]]);
      if (called.ok) throw new Error("let through");
      expect(called.response.status).toBe(401);
      expect(await called.response.json()).toEqual({ error: "unauthorized" });
    });
  });
});
