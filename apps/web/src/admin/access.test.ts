import { describe, expect, it } from "vitest";
import { BACK_OFFICE_ROLES, backOfficeAccess, isBackOfficeRole, permanentSuperAdminsFromEnv } from "./access";

describe("permanent super-admins", () => {
  it("are the Jobbbox team members whose emails are listed in ADMIN_EMAILS, whatever the case", () => {
    const isPermanent = permanentSuperAdminsFromEnv({ ADMIN_EMAILS: " claire@jobbbox.fr, Paul@Jobbbox.fr " });

    expect(isPermanent({ email: "claire@jobbbox.fr", emailVerified: true })).toBe(true);
    expect(isPermanent({ email: "paul@jobbbox.fr", emailVerified: true })).toBe(true);
    expect(isPermanent({ email: "marie.dupont@example.fr", emailVerified: true })).toBe(false);
  });

  it("never include someone whose email address is not verified", () => {
    const isPermanent = permanentSuperAdminsFromEnv({ ADMIN_EMAILS: "claire@jobbbox.fr" });

    expect(isPermanent({ email: "claire@jobbbox.fr", emailVerified: false })).toBe(false);
  });

  it("are nobody when ADMIN_EMAILS is not set", () => {
    const isPermanent = permanentSuperAdminsFromEnv({});

    expect(isPermanent({ email: "", emailVerified: true })).toBe(false);
  });
});

describe("Back Office access", () => {
  it("a super-admin reads and changes everything", () => {
    const access = backOfficeAccess(["super-admin"]);

    expect(access.isAdministrator).toBe(true);
    for (const resource of ["roles", "audit", "planQuotas", "plans", "coupons", "humanCoaches", "coachMessageCost", "providerSecrets", "ssoProviders", "searchSites"] as const) {
      expect(access.can(resource, "read"), resource).toBe(true);
    }
    expect(access.can("roles", "write")).toBe(true);
    expect(access.can("providerSecrets", "write")).toBe(true);
    expect(access.can("searchSites", "write")).toBe(true);
  });

  it("a Plans manager runs Plans, Plan Quotas and Coupons, nothing else", () => {
    const access = backOfficeAccess(["plans-manager"]);

    expect(access.can("coupons", "write")).toBe(true);
    expect(access.can("planQuotas", "write")).toBe(true);
    expect(access.can("plans", "write")).toBe(true);
    expect(access.can("humanCoaches", "read")).toBe(false);
    expect(access.can("coachMessageCost", "read")).toBe(false);
    expect(access.can("roles", "read")).toBe(false);
    expect(access.can("audit", "read")).toBe(false);
    expect(access.can("searchSites", "read")).toBe(false);
  });

  it("a Coach manager runs Human Coaches and only reads the Coach Message Cost", () => {
    const access = backOfficeAccess(["coach-manager"]);

    expect(access.can("humanCoaches", "write")).toBe(true);
    expect(access.can("coachMessageCost", "read")).toBe(true);
    expect(access.can("coachMessageCost", "write")).toBe(false);
    expect(access.can("planQuotas", "read")).toBe(false);
  });

  it("Support reads every section but Provider Secrets and the team's own, and changes nothing", () => {
    const access = backOfficeAccess(["support"]);

    for (const resource of ["planQuotas", "plans", "coupons", "humanCoaches", "coachMessageCost", "ssoProviders", "searchSites"] as const) {
      expect(access.can(resource, "read"), resource).toBe(true);
      expect(access.can(resource, "write"), resource).toBe(false);
    }
    expect(access.can("providerSecrets", "read")).toBe(false);
    expect(access.can("roles", "read")).toBe(false);
    expect(access.can("audit", "read")).toBe(false);
  });

  it("only Help editors and super-admins act on the Unanswered Questions; Support reads them (#344)", () => {
    const helpEditor = backOfficeAccess(["help-editor"]);

    expect(helpEditor.isAdministrator).toBe(true);
    expect(helpEditor.can("unansweredQuestions", "read")).toBe(true);
    expect(helpEditor.can("unansweredQuestions", "write")).toBe(true);
    expect(helpEditor.can("coachingPlaybooks", "read")).toBe(false);
    expect(helpEditor.can("roles", "read")).toBe(false);
    expect(backOfficeAccess(["super-admin"]).can("unansweredQuestions", "write")).toBe(true);
    expect(backOfficeAccess(["support"]).can("unansweredQuestions", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("unansweredQuestions", "write")).toBe(false);
    for (const role of ["plans-manager", "coach-manager", "playbook-editor"] as const) {
      expect(backOfficeAccess([role]).can("unansweredQuestions", "read"), role).toBe(false);
    }
  });

  it("Support and super-admins read Signalements and change their status and reply; Help editors only read them; no other role sees them (#376)", () => {
    for (const role of ["support", "super-admin"] as const) {
      expect(backOfficeAccess([role]).can("signalements", "read"), role).toBe(true);
      expect(backOfficeAccess([role]).can("signalements", "write"), role).toBe(true);
    }
    expect(backOfficeAccess(["help-editor"]).can("signalements", "read")).toBe(true);
    expect(backOfficeAccess(["help-editor"]).can("signalements", "write")).toBe(false);
    for (const role of ["plans-manager", "coach-manager", "playbook-editor"] as const) {
      expect(backOfficeAccess([role]).can("signalements", "read"), role).toBe(false);
    }
  });

  it("super-admins and Support read the AI consumption; only super-admins read the AI Message Log (#218)", () => {
    expect(backOfficeAccess(["super-admin"]).can("aiUsage", "read")).toBe(true);
    expect(backOfficeAccess(["super-admin"]).can("aiMessages", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("aiUsage", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("aiUsage", "write")).toBe(false);
    expect(backOfficeAccess(["support"]).can("aiMessages", "read")).toBe(false);
    for (const role of ["plans-manager", "coach-manager"] as const) {
      expect(backOfficeAccess([role]).can("aiUsage", "read"), role).toBe(false);
      expect(backOfficeAccess([role]).can("aiMessages", "read"), role).toBe(false);
    }
  });

  it("a Playbook editor creates, edits, validates and archives Coaching Playbooks, nothing else; super-admins too; Support only reads them (#225)", () => {
    const editor = backOfficeAccess(["playbook-editor"]);

    expect(editor.isAdministrator).toBe(true);
    expect(editor.can("coachingPlaybooks", "write")).toBe(true);
    for (const resource of ["roles", "audit", "plans", "humanCoaches", "coachMessageCost", "providerSecrets", "aiMessages"] as const) {
      expect(editor.can(resource, "read"), resource).toBe(false);
    }
    expect(backOfficeAccess(["super-admin"]).can("coachingPlaybooks", "write")).toBe(true);
    expect(backOfficeAccess(["support"]).can("coachingPlaybooks", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("coachingPlaybooks", "write")).toBe(false);
    for (const role of ["plans-manager", "coach-manager"] as const) expect(backOfficeAccess([role]).can("coachingPlaybooks", "read"), role).toBe(false);
  });

  it("only super-admins change Guardrail settings and Guardrail messages; Support only reads them and their Guardrail Triggers (#228)", () => {
    expect(backOfficeAccess(["super-admin"]).can("guardrails", "write")).toBe(true);
    expect(backOfficeAccess(["support"]).can("guardrails", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("guardrails", "write")).toBe(false);
    for (const role of ["plans-manager", "coach-manager", "playbook-editor"] as const) expect(backOfficeAccess([role]).can("guardrails", "read"), role).toBe(false);
  });

  it("super-admins and Support read the Tools; no role changes them, no other role sees them (#233)", () => {
    expect(backOfficeAccess(["super-admin"]).can("tools", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("tools", "read")).toBe(true);
    for (const role of ["super-admin", "support"] as const) expect(backOfficeAccess([role]).can("tools", "write" as never), role).toBe(false);
    for (const role of ["plans-manager", "coach-manager", "playbook-editor"] as const) expect(backOfficeAccess([role]).can("tools", "read"), role).toBe(false);
  });

  it("super-admins read and change the Platform Settings; Support only reads them; no other role sees them (#298)", () => {
    expect(backOfficeAccess(["super-admin"]).can("platformSettings", "read")).toBe(true);
    expect(backOfficeAccess(["super-admin"]).can("platformSettings", "write")).toBe(true);
    expect(backOfficeAccess(["support"]).can("platformSettings", "read")).toBe(true);
    expect(backOfficeAccess(["support"]).can("platformSettings", "write")).toBe(false);
    for (const role of ["plans-manager", "coach-manager", "playbook-editor"] as const) expect(backOfficeAccess([role]).can("platformSettings", "read"), role).toBe(false);
  });

  it("Technique changes the non-secret settings, the search sites and the Tools' prices, sees keys without changing them, and reads the Dashboard and the Audit; never the AI Message Log (#397)", () => {
    const technique = backOfficeAccess(["platform-manager"]);

    expect(technique.isAdministrator).toBe(true);
    expect(technique.isSuperAdmin).toBe(false);
    // Writes: Platform Settings (the Tools' prices are Platform Settings on their Paramètres sheet), sources, sites and Job Sites.
    for (const resource of ["platformSettings", "searchSites"] as const) {
      expect(technique.can(resource, "read"), resource).toBe(true);
      expect(technique.can(resource, "write"), resource).toBe(true);
    }
    // Keys: seen by their source and last 4 characters only, never replaced, tested or cleared.
    expect(technique.can("providerSecrets", "read")).toBe(true);
    expect(technique.can("providerSecrets", "write")).toBe(false);
    // Reads: the Dashboard's figures (AI Usage, Tools), the Sign-in Providers' tab of Paramètres, and Actions des administrateurs.
    for (const resource of ["aiUsage", "tools", "ssoProviders", "audit"] as const) {
      expect(technique.can(resource, "read"), resource).toBe(true);
      expect(technique.can(resource, "write" as never), resource).toBe(false);
    }
    // Never Appels IA, and nothing outside the platform.
    for (const resource of ["aiMessages", "roles", "plans", "planQuotas", "coupons", "humanCoaches", "coachMessageCost", "coachingPlaybooks", "guardrails", "evalRuns", "unansweredQuestions", "signalements"] as const) {
      expect(technique.can(resource, "read"), resource).toBe(false);
    }
  });

  it("Technique is grantable like any Back Office Role; Support still only reads Paramètres and super-admins keep everything (#397)", () => {
    expect(BACK_OFFICE_ROLES).toContain("platform-manager");
    expect(isBackOfficeRole("platform-manager")).toBe(true);
    expect(backOfficeAccess(["support"]).can("platformSettings", "write")).toBe(false);
    expect(backOfficeAccess(["support"]).can("audit", "read")).toBe(false);
    for (const resource of ["platformSettings", "searchSites", "providerSecrets"] as const) expect(backOfficeAccess(["super-admin"]).can(resource, "write"), resource).toBe(true);
  });

  it("several roles add up", () => {
    const access = backOfficeAccess(["support", "coach-manager"]);

    expect(access.can("humanCoaches", "write")).toBe(true);
    expect(access.can("planQuotas", "read")).toBe(true);
    expect(access.can("planQuotas", "write")).toBe(false);
  });

  it("no role is no access at all", () => {
    const access = backOfficeAccess([]);

    expect(access.isAdministrator).toBe(false);
    expect(access.can("planQuotas", "read")).toBe(false);
  });

  it("only Playbook editors and super-admins start an Eval Run, whose AI calls cost; Support reads them (ADR-0023, #231)", () => {
    expect(backOfficeAccess(["playbook-editor"]).can("evalRuns", "write")).toBe(true);
    expect(backOfficeAccess(["super-admin"]).can("evalRuns", "write")).toBe(true);
    expect(backOfficeAccess(["support"]).can("evalRuns", "read")).toBe(true);
    for (const role of ["support", "plans-manager", "coach-manager"] as const) {
      expect(backOfficeAccess([role]).can("evalRuns", "write"), role).toBe(false);
    }
  });
});
