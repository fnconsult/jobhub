import { describe, expect, it } from "vitest";
import type { AgentKey, AgentKeyCall } from "../agent-keys";
import { signalementsDigest, triagePass } from "./digest";

const NOW = new Date("2026-11-26T17:00:00Z");
const SINCE = new Date("2026-11-25T17:00:00Z");

const key = (more: Partial<AgentKey> = {}): AgentKey => ({
  id: "k1",
  name: "triage-beta",
  scope: "signalements",
  createdAt: new Date("2026-11-01T09:00:00Z"),
  expiresAt: new Date("2026-12-01T09:00:00Z"),
  revokedAt: null,
  lastUsedAt: null,
  ...more,
});
const call = (at: string, outcome: AgentKeyCall["outcome"]): AgentKeyCall => ({ at: new Date(at), method: "GET", path: "/admin/api/signalements", outcome });

describe("the day's triage pass, as the Livraison email says it (#1141)", () => {
  it("gives the time of the last call let through since the last email", () => {
    expect(triagePass([{ key: key({ lastUsedAt: new Date("2026-11-26T16:10:00Z") }), calls: [] }], SINCE, NOW)).toEqual({ ran: true, at: new Date("2026-11-26T16:10:00Z") });
  });

  it("says why it did not run: no key, a key expired or revoked (refused when it tried, or before), or no call today", () => {
    expect(triagePass([], SINCE, NOW)).toEqual({ ran: false, reason: "no_key" });
    expect(triagePass([{ key: key({ lastUsedAt: new Date("2026-11-20T16:00:00Z") }), calls: [call("2026-11-26T16:00:00Z", "expired")] }], SINCE, NOW)).toEqual({ ran: false, reason: "key_expired" });
    expect(triagePass([{ key: key(), calls: [call("2026-11-26T16:00:00Z", "revoked")] }], SINCE, NOW)).toEqual({ ran: false, reason: "key_revoked" });
    expect(triagePass([{ key: key({ expiresAt: new Date("2026-11-26T08:00:00Z") }), calls: [] }], SINCE, NOW)).toEqual({ ran: false, reason: "key_expired" });
    expect(triagePass([{ key: key({ revokedAt: new Date("2026-11-20T08:00:00Z") }), calls: [] }], SINCE, NOW)).toEqual({ ran: false, reason: "key_revoked" });
    expect(triagePass([{ key: key({ lastUsedAt: new Date("2026-11-24T16:00:00Z") }), calls: [] }], SINCE, NOW)).toEqual({ ran: false, reason: "no_call" });
  });
});

describe("the « Signalements » section of the Livraison email (#1141)", () => {
  it("is computed by Jobbbox from its own data: counts, issue numbers and links, the triage pass; never a text", async () => {
    const digest = await signalementsDigest({
      signalements: {
        countsSince: async (since) => {
          expect(since).toEqual(SINCE);
          return { newByType: { bug: 2, idee: 1, question: 0 }, issues: [{ number: 1201, kind: "opened", signalements: 2 }], readyWithDraft: 1 };
        },
      },
      agentKeys: { list: async () => [key({ lastUsedAt: new Date("2026-11-26T16:10:00Z") })], calls: async () => [] },
      environment: "staging",
      issueUrl: (number) => `https://github.com/fnconsult/jobhub/issues/${number}`,
      now: () => NOW,
    });

    expect(digest).toEqual({
      environment: "staging",
      newByType: { bug: 2, idee: 1, question: 0 },
      issues: [{ number: 1201, kind: "opened", signalements: 2, url: "https://github.com/fnconsult/jobhub/issues/1201" }],
      readyWithDraft: 1,
      triage: { ran: true, at: new Date("2026-11-26T16:10:00Z") },
    });
  });
});
