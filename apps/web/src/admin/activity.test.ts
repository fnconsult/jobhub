import { describe, expect, it } from "vitest";
import { backOfficeAccess } from "./access";
import { activityTabs, legacyActivityRedirect } from "./activity";

const tabs = (roles: Parameters<typeof backOfficeAccess>[0]) => activityTabs(backOfficeAccess(roles)).map((tab) => [tab.id, tab.href]);

describe("Activité's tabs (#404)", () => {
  it("are Recherches, Emails reçus, Appels IA and Actions des administrateurs for a super-admin, in that order", () => {
    expect(tabs(["super-admin"])).toEqual([
      ["discoveryRuns", "/admin/activite/recherches"],
      ["receivedEmails", "/admin/activite/emails-recus"],
      ["aiMessages", "/admin/activite/appels-ia"],
      ["audit", "/admin/activite/actions"],
    ]);
  });

  it("are only those a role reads: Technique the Recherches, the Emails reçus and the Actions des administrateurs, Support the Recherches and the Emails reçus, others none", () => {
    expect(tabs(["platform-manager"])).toEqual([
      ["discoveryRuns", "/admin/activite/recherches"],
      ["receivedEmails", "/admin/activite/emails-recus"],
      ["audit", "/admin/activite/actions"],
    ]);
    expect(tabs(["support"])).toEqual([
      ["discoveryRuns", "/admin/activite/recherches"],
      ["receivedEmails", "/admin/activite/emails-recus"],
    ]);
    expect(tabs(["plans-manager"])).toEqual([]);
  });
});

describe("the former addresses of Journal and Journaux IA (#404)", () => {
  it("lead to their tab of Activité, with their filters", () => {
    expect(legacyActivityRedirect("journal", {})).toBe("/admin/activite/actions");
    expect(legacyActivityRedirect("journal", { section: "plan_quotas", outcome: "failed" })).toBe("/admin/activite/actions?section=plan_quotas&outcome=failed");
    expect(legacyActivityRedirect("journaux-ia", {})).toBe("/admin/activite/appels-ia");
    expect(legacyActivityRedirect("journaux-ia", { email: "marie@example.fr", outcome: "warning", ignored: ["a", "b"] })).toBe("/admin/activite/appels-ia?email=marie%40example.fr&outcome=warning");
  });

  it("lead one AI Message Log to the same call on Appels IA", () => {
    expect(legacyActivityRedirect("journaux-ia", {}, "0b6c2f1e-1111-4111-8111-111111111111")).toBe("/admin/activite/appels-ia/0b6c2f1e-1111-4111-8111-111111111111");
  });
});
