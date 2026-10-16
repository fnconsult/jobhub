import { describe, expect, it } from "vitest";
import { backOfficeAccess, permanentSuperAdminsFromEnv } from "./access";

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
    for (const resource of ["roles", "audit", "planQuotas", "plans", "humanCoaches", "coachMessageCost", "providerSecrets", "ssoProviders", "searchSites"] as const) {
      expect(access.can(resource, "read"), resource).toBe(true);
    }
    expect(access.can("roles", "write")).toBe(true);
    expect(access.can("providerSecrets", "write")).toBe(true);
    expect(access.can("searchSites", "write")).toBe(true);
  });

  it("a Plans manager runs Plans and Plan Quotas, nothing else", () => {
    const access = backOfficeAccess(["plans-manager"]);

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

    for (const resource of ["planQuotas", "plans", "humanCoaches", "coachMessageCost", "ssoProviders", "searchSites"] as const) {
      expect(access.can(resource, "read"), resource).toBe(true);
      expect(access.can(resource, "write"), resource).toBe(false);
    }
    expect(access.can("providerSecrets", "read")).toBe(false);
    expect(access.can("roles", "read")).toBe(false);
    expect(access.can("audit", "read")).toBe(false);
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
});
