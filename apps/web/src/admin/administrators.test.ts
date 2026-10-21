import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { permanentSuperAdminsFromEnv } from "./access";
import { createAdministrators, migrateAdministratorRoles, type Administrators, type Person } from "./administrators";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice } from "./back-office";

describe.skipIf(!connectionString)("Administrators and their Back Office Roles (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let administrators: Administrators;
  // Claire is in ADMIN_EMAILS: a permanent super-admin.
  let claire: Person;
  let paul: Person;
  let marie: Person;

  async function signUp(email: string): Promise<Person> {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id, email: user.email, emailVerified: user.emailVerified };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateBackOfficeAudit(database);
    await migrateAdministratorRoles(database);
    await migrateAdministratorRoles(database); // safe to run again
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, { billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused }, humanCoaches: { add: unused, retire: unused } });
    administrators = createAdministrators(database, { backOffice, isPermanentSuperAdmin: permanentSuperAdminsFromEnv({ ADMIN_EMAILS: "claire@jobbbox.fr" }) });
    claire = await signUp("claire@jobbbox.fr");
    paul = await signUp("paul@jobbbox.fr");
    marie = await signUp("marie.dupont@example.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("an ADMIN_EMAILS member is a permanent super-admin with no role stored; anyone else has no access", async () => {
    const access = await administrators.access(claire);
    expect(access).toMatchObject({ roles: ["super-admin"], isAdministrator: true, isSuperAdmin: true, permanent: true });
    expect(access.can("roles", "write")).toBe(true);

    expect(await administrators.access(marie)).toMatchObject({ roles: [], isAdministrator: false, permanent: false });
  });

  it("a super-admin grants roles to an existing account by its email; the grant is in the Journal", async () => {
    const granted = await administrators.grant(claire, " Paul@Jobbbox.fr ", ["support", "coach-manager"]);

    expect(granted).toEqual({ ok: true });
    expect((await administrators.access(paul)).roles).toEqual(["coach-manager", "support"]);
    expect(await backOffice.journal()).toEqual([
      expect.objectContaining({
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "roles",
        target: "paul@jobbbox.fr",
        action: "added",
        before: null,
        after: { roles: ["coach-manager", "support"] },
      }),
    ]);

    // Granting more adds to what they hold.
    expect(await administrators.grant(claire, "paul@jobbbox.fr", ["support", "plans-manager"])).toEqual({ ok: true });
    expect((await administrators.access(paul)).roles).toEqual(["plans-manager", "coach-manager", "support"]);
    expect((await backOffice.journal())[0]).toMatchObject({
      action: "updated",
      before: { roles: ["coach-manager", "support"] },
      after: { roles: ["plans-manager", "coach-manager", "support"] },
    });
  });

  it("refuses an email with no account, and records the refusal: there are no pending grants", async () => {
    expect(await administrators.grant(claire, " Nobody@jobbbox.fr ", ["support"])).toEqual({ ok: false, error: "unknown_account" });
    expect(await backOffice.journal()).toMatchObject([
      { section: "roles", target: "nobody@jobbbox.fr", action: "refused", outcome: "failed", before: null, after: null, failure: { reason: "unknown_account", tried: "added", field: "email", technical: null } },
    ]);
  });

  it("refuses a grant with no known role", async () => {
    expect(await administrators.grant(claire, "paul@jobbbox.fr", [])).toEqual({ ok: false, error: "no_role" });
    expect(await administrators.grant(claire, "paul@jobbbox.fr", ["owner"])).toEqual({ ok: false, error: "no_role" });
    expect((await administrators.access(paul)).isAdministrator).toBe(false);
  });

  it("only super-admins grant: no other role can raise itself or anyone", async () => {
    await administrators.grant(claire, "paul@jobbbox.fr", ["plans-manager", "coach-manager", "support"]);

    expect(await administrators.grant(paul, "paul@jobbbox.fr", ["super-admin"])).toEqual({ ok: false, error: "forbidden" });
    expect(await administrators.grant(paul, "marie.dupont@example.fr", ["support"])).toEqual({ ok: false, error: "forbidden" });
    expect(await administrators.grant(marie, "marie.dupont@example.fr", ["super-admin"])).toEqual({ ok: false, error: "forbidden" });
    expect((await administrators.access(paul)).isSuperAdmin).toBe(false);
    expect((await administrators.access(marie)).isAdministrator).toBe(false);
  });

  it("a super-admin revokes a role; it is gone on the next request, and in the Journal", async () => {
    await administrators.grant(claire, "paul@jobbbox.fr", ["support", "coach-manager"]);

    expect(await administrators.revoke(claire, paul.id, "coach-manager")).toEqual({ ok: true });
    expect((await administrators.access(paul)).can("humanCoaches", "write")).toBe(false);
    expect((await backOffice.journal())[0]).toMatchObject({
      section: "roles",
      target: "paul@jobbbox.fr",
      action: "updated",
      before: { roles: ["coach-manager", "support"] },
      after: { roles: ["support"] },
    });

    expect(await administrators.revoke(claire, paul.id, "support")).toEqual({ ok: true });
    expect((await administrators.access(paul)).isAdministrator).toBe(false);
    expect((await backOffice.journal())[0]).toMatchObject({ action: "retired", before: { roles: ["support"] }, after: null });

    // Revoking a role nobody holds changes nothing, and records nothing.
    const entries = (await backOffice.journal()).length;
    expect(await administrators.revoke(claire, paul.id, "support")).toEqual({ ok: true });
    expect(await backOffice.journal()).toHaveLength(entries);
  });

  it("nobody removes their own super-admin role, and ADMIN_EMAILS members stay super-admins", async () => {
    await administrators.grant(claire, "paul@jobbbox.fr", ["super-admin"]);

    expect(await administrators.revoke(paul, paul.id, "super-admin")).toEqual({ ok: false, error: "own_super_admin" });
    expect(await administrators.revoke(paul, claire.id, "super-admin")).toEqual({ ok: false, error: "permanent" });
    expect((await administrators.access(paul)).isSuperAdmin).toBe(true);
    expect((await administrators.access(claire)).isSuperAdmin).toBe(true);

    // Another super-admin can.
    expect(await administrators.revoke(claire, paul.id, "super-admin")).toEqual({ ok: true });
    expect((await administrators.access(paul)).isAdministrator).toBe(false);
  });

  it("only super-admins revoke", async () => {
    await administrators.grant(claire, "paul@jobbbox.fr", ["plans-manager", "coach-manager", "support"]);
    await administrators.grant(claire, "marie.dupont@example.fr", ["support"]);

    expect(await administrators.revoke(paul, marie.id, "support")).toEqual({ ok: false, error: "forbidden" });
    expect(await administrators.revoke(marie, marie.id, "support")).toEqual({ ok: false, error: "forbidden" });
    expect((await administrators.access(marie)).roles).toEqual(["support"]);
  });

  it("an Administrator's roles go with their account", async () => {
    await administrators.grant(claire, "paul@jobbbox.fr", ["support"]);
    await database.query("DELETE FROM candidate WHERE id = $1", [paul.id]);

    expect((await database.query("SELECT 1 FROM administrator_role WHERE candidate_id = $1", [paul.id])).rowCount).toBe(0);
  });

  it("lists every Administrator with their roles, ADMIN_EMAILS members as permanent super-admins", async () => {
    await administrators.grant(claire, "paul@jobbbox.fr", ["support", "plans-manager"]);

    expect(await administrators.list()).toEqual([
      { candidateId: claire.id, email: "claire@jobbbox.fr", roles: ["super-admin"], permanent: true },
      { candidateId: paul.id, email: "paul@jobbbox.fr", roles: ["plans-manager", "support"], permanent: false },
    ]);
  });

  it("refuses an account whose email address is not verified: its roles would give no access", async () => {
    await database.query(`UPDATE candidate SET "emailVerified" = false WHERE id = $1`, [paul.id]);

    expect(await administrators.grant(claire, "paul@jobbbox.fr", ["support"])).toEqual({ ok: false, error: "unverified_account" });
    expect((await database.query("SELECT 1 FROM administrator_role WHERE candidate_id = $1", [paul.id])).rowCount).toBe(0);
    expect(await backOffice.journal()).toEqual([]);
  });

  describe("with no ADMIN_EMAILS", () => {
    let bare: Administrators;

    beforeEach(async () => {
      bare = createAdministrators(database, { backOffice, isPermanentSuperAdmin: permanentSuperAdminsFromEnv({}) });
    });

    it("two super-admins revoking each other at the same moment leave one super-admin", async () => {
      await administrators.grant(claire, "paul@jobbbox.fr", ["super-admin"]);
      await administrators.grant(claire, "marie.dupont@example.fr", ["super-admin"]);

      const results = await Promise.all([bare.revoke(paul, marie.id, "super-admin"), bare.revoke(marie, paul.id, "super-admin")]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "forbidden" }]);
      const remaining = [(await bare.access(paul)).isSuperAdmin, (await bare.access(marie)).isSuperAdmin];
      expect(remaining.filter(Boolean)).toHaveLength(1);
    });

    it("the last super-admin cannot be revoked", async () => {
      await administrators.grant(claire, "paul@jobbbox.fr", ["super-admin"]);

      expect(await bare.revoke(paul, paul.id, "super-admin")).toEqual({ ok: false, error: "last_super_admin" });
      expect((await bare.access(paul)).isSuperAdmin).toBe(true);
      expect((await backOffice.journal({ outcome: "failed" })).map(({ actor, target, action, failure }) => ({ by: actor.email, target, action, failure }))).toEqual([
        { by: "paul@jobbbox.fr", target: "paul@jobbbox.fr", action: "refused", failure: { reason: "last_super_admin", tried: "updated", field: "roles", technical: null } },
      ]);
    });

    it("a super-admin whose role was just revoked cannot grant any more", async () => {
      await administrators.grant(claire, "paul@jobbbox.fr", ["super-admin"]);
      await administrators.grant(claire, "marie.dupont@example.fr", ["super-admin"]);

      const [revoked, granted] = await Promise.all([bare.revoke(marie, paul.id, "super-admin"), bare.grant(paul, "paul@jobbbox.fr", ["support"])]);

      expect(revoked).toEqual({ ok: true });
      // Either the grant ran first, or it saw Paul was no longer a super-admin.
      if (granted.ok) expect((await bare.access(paul)).roles).toEqual(["support"]);
      else expect(granted).toEqual({ ok: false, error: "forbidden" });
      expect((await bare.access(paul)).isSuperAdmin).toBe(false);
    });
  });
});
