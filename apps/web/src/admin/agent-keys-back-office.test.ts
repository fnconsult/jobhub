import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentKeys, migrateAgentKeys, type AgentKeys } from "../agent-keys";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { backOfficeAccess, BACK_OFFICE_ROLES } from "./access";
import { createAgentKeysBackOffice, type AgentKeysBackOffice } from "./agent-keys-back-office";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";

describe("who may handle Agent Keys (#1139)", () => {
  it("super-admins only", () => {
    for (const role of BACK_OFFICE_ROLES) {
      expect(backOfficeAccess([role]).can("agentKeys", "read"), role).toBe(role === "super-admin");
      expect(backOfficeAccess([role]).can("agentKeys", "write"), role).toBe(role === "super-admin");
    }
  });
});

describe.skipIf(!connectionString)("« Clés d'agent » in the Back Office: created and revoked, each in the Back Office Audit by its name (#1139; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let now: Date;
  let keys: AgentKeys;
  let backOffice: BackOffice;
  let agentKeys: AgentKeysBackOffice;
  let sophie: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    await migrateAgentKeys(testAuth.database);
    await migrateBackOfficeAudit(testAuth.database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(testAuth.database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    now = new Date("2026-11-26T09:00:00Z");
    keys = createAgentKeys(testAuth.database, { now: () => now });
    agentKeys = createAgentKeysBackOffice(keys, backOffice);
    const cookie = await signInWithMagicLink(testAuth, "sophie@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    sophie = { id: user.id, email: user.email };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("records a key created by its name, scope and expiry, never its value", async () => {
    const created = await agentKeys.create(sophie, { name: "triage-beta", scope: "signalements", days: "90" });
    if (!created.ok) throw new Error("not created");

    expect(await backOffice.journal()).toEqual([
      expect.objectContaining({
        actor: { candidateId: sophie.id, email: "sophie@jobbbox.fr" },
        section: "agent_keys",
        target: "triage-beta",
        action: "added",
        before: null,
        after: { scope: "signalements", expiresAt: "2027-02-24T09:00:00.000Z" },
        outcome: "succeeded",
      }),
    ]);
    expect(JSON.stringify(await backOffice.journal())).not.toContain(created.value);
  });

  it("records a key revoked, once", async () => {
    const created = await agentKeys.create(sophie, { name: "triage-beta", scope: "signalements", days: 30 });
    if (!created.ok) throw new Error("not created");
    now = new Date("2026-11-27T09:00:00Z");

    expect(await agentKeys.revoke(sophie, created.key.id)).toEqual({ ok: true, key: { ...created.key, revokedAt: now } });
    expect(await agentKeys.revoke(sophie, created.key.id)).toMatchObject({ ok: true });
    expect(await agentKeys.revoke(sophie, "0b6c2f1e-9999-4999-8999-999999999999")).toEqual({ ok: false, error: "not_found" });

    const journal = await backOffice.journal();
    expect(journal).toHaveLength(2);
    expect(journal[0]).toMatchObject({ section: "agent_keys", target: "triage-beta", action: "revoked", before: { revokedAt: null }, after: { revokedAt: "2026-11-27T09:00:00.000Z" } });
  });

  it("records nothing for a key refused", async () => {
    expect(await agentKeys.create(sophie, { name: "Triage Beta", scope: "signalements", days: 30 })).toEqual({ ok: false, errors: [{ field: "name", code: "invalid" }] });
    await agentKeys.create(sophie, { name: "triage-beta", scope: "signalements", days: 30 });
    expect(await agentKeys.create(sophie, { name: "triage-beta", scope: "signalements", days: 30 })).toEqual({ ok: false, refused: "name_taken" });

    expect(await backOffice.journal()).toHaveLength(1);
  });
});
