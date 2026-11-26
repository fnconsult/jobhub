import { describe, expect, it } from "vitest";
import { BACK_OFFICE_PAGES } from "../admin/back-office-nav";
import { agentCall, agentKeyRefusal, bearerKey } from "./http";
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

  it("opens no Back Office page: the proxy answers 403 to every one of them, and to every other route", async () => {
    const pages = Object.values(BACK_OFFICE_PAGES).map((page) => page.href.split("?")[0]!);
    expect(pages.length).toBeGreaterThan(10);
    for (const path of [...pages, "/admin", "/admin/parametres", "/admin/connexion", "/admin/api/autre", "/admin/api/signalementsx", "/api/admin/assistant", "/api/signalements", "/compte", "/"]) {
      const refused = agentKeyRefusal(path, withKey());
      expect(refused?.status, path).toBe(403);
      expect(refused?.headers.get("cache-control")).toBe("no-store");
      expect(await refused?.json()).toEqual({ error: "out_of_scope" });
    }
  });

  it("lets its scope's routes through to be checked there, and anything without a key", () => {
    for (const path of ["/admin/api/signalements", "/admin/api/signalements/0b6c2f1e-1111-4111-8111-111111111111", "/admin/api/signalements/0b6c2f1e-1111-4111-8111-111111111111/statut"])
      expect(agentKeyRefusal(path, withKey()), path).toBeNull();
    expect(agentKeyRefusal("/admin/parametres", new Headers())).toBeNull();
    expect(agentKeyRefusal("/admin/parametres", new Headers({ authorization: "Bearer another-token" }))).toBeNull();
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

    it("answers 401, 403 and 429 as the key's check says, never cached", async () => {
      for (const [authorization, status, error] of [
        [{ ok: false, status: 401, reason: "revoked" }, 401, "unauthorized"],
        [{ ok: false, status: 403, reason: "out_of_scope" }, 403, "out_of_scope"],
        [{ ok: false, status: 429, reason: "rate_limited" }, 429, "rate_limited"],
      ] as const) {
        const called = await agentCall(request("/admin/api/signalements"), "signalements", keysAnswering(authorization).keys);
        if (called.ok) throw new Error("let through");
        expect(called.response.status).toBe(status);
        expect(called.response.headers.get("cache-control")).toBe("no-store");
        expect(await called.response.json()).toEqual({ error });
      }
    });

    it("is refused out of scope when the route is not one of its scope's", async () => {
      const { keys, asked } = keysAnswering({ ok: false, status: 403, reason: "out_of_scope" });

      await agentCall(request("/admin/api/autre"), "signalements", keys);
      expect(asked).toEqual([[KEY, "out_of_scope", { method: "GET", path: "/admin/api/autre" }]]);
    });
  });
});
