import { describe, expect, it } from "vitest";
import { BACK_OFFICE_ROLES, backOfficeAccess } from "./access";
import { activityTabs, legacyActivityRedirect } from "./activity";

const tabs = (roles: Parameters<typeof backOfficeAccess>[0]) => activityTabs(backOfficeAccess(roles)).map((tab) => [tab.id, tab.href]);

describe("Activité's tabs (#404)", () => {
  it("are Recherches, Emails reçus, Appels IA, Actions des administrateurs and Extension for a super-admin, in that order", () => {
    expect(tabs(["super-admin"])).toEqual([
      ["discoveryRuns", "/admin/activite/recherches"],
      ["receivedEmails", "/admin/activite/emails-recus"],
      ["aiMessages", "/admin/activite/appels-ia"],
      ["audit", "/admin/activite/actions"],
      ["extensionEvents", "/admin/activite/extension"],
    ]);
  });

  it("are only those a role reads: Technique the Recherches, the Emails reçus, the Actions des administrateurs and Extension, Support the Recherches, the Emails reçus and Extension, others none", () => {
    expect(tabs(["platform-manager"])).toEqual([
      ["discoveryRuns", "/admin/activite/recherches"],
      ["receivedEmails", "/admin/activite/emails-recus"],
      ["audit", "/admin/activite/actions"],
      ["extensionEvents", "/admin/activite/extension"],
    ]);
    expect(tabs(["support"])).toEqual([
      ["discoveryRuns", "/admin/activite/recherches"],
      ["receivedEmails", "/admin/activite/emails-recus"],
      ["extensionEvents", "/admin/activite/extension"],
    ]);
    expect(tabs(["plans-manager"])).toEqual([]);
  });
});

describe("Activité › Extension (#925)", () => {
  it("is read by the Back Office Roles that already read Activité, and by no other", () => {
    const readers = BACK_OFFICE_ROLES.filter((role) => activityTabs(backOfficeAccess([role])).some((tab) => tab.id === "extensionEvents"));
    const activityReaders = BACK_OFFICE_ROLES.filter((role) => activityTabs(backOfficeAccess([role])).some((tab) => tab.id !== "extensionEvents"));

    expect(readers).toEqual(["super-admin", "platform-manager", "support"]);
    expect(readers).toEqual(activityReaders);
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
