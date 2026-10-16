import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createBilling, migrateBilling, STARTING_PLAN_QUOTAS, type Billing } from "../billing";
import { createHumanCoaches, migrateHumanCoaches } from "../human-coaches";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";

describe.skipIf(!connectionString)("the Back Office and its Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let billing: Billing;
  let backOffice: BackOffice;
  let claire: BackOfficeActor;

  async function signUp(email: string): Promise<BackOfficeActor> {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id, email: user.email };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateBilling(database);
    await migrateHumanCoaches(database);
    await migrateBackOfficeAudit(database);
    billing = createBilling({ database, baseURL: "http://localhost:3000" });
    const profiles = createProfiles(database);
    const applications = createApplications(database, { jobOffers: createJobOffers(database), profiles });
    const humanCoaches = createHumanCoaches(database, {
      profiles,
      applications,
      tailoredDocuments: { get: async () => null },
      tailoredCvs: { get: async () => null },
    });
    backOffice = createBackOffice(database, { billing, humanCoaches });
    claire = await signUp("claire@jobbbox.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("editing a Plan Quota records one entry: who, before and after", async () => {
    const quotas = { ...STARTING_PLAN_QUOTAS.standard, matchScores: 40, jobDigest: "daily" as const };

    await backOffice.setPlanQuotas(claire, "standard", quotas);

    expect((await billing.planQuotas()).standard).toEqual(quotas);
    const journal = await backOffice.journal();
    expect(journal).toEqual([
      {
        id: expect.any(String),
        at: expect.any(Date),
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "plan_quotas",
        target: "standard",
        action: "updated",
        before: STARTING_PLAN_QUOTAS.standard,
        after: quotas,
      },
    ]);
  });

  it("adding and retiring a Human Coach each record one entry; a refused one records nothing", async () => {
    const sophie = { name: "Sophie Martin", email: "Sophie.Martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance", bio: "Ancienne DRH." };

    const added = await backOffice.addHumanCoach(claire, sophie);
    if (!added.ok) throw new Error("fixture refused");
    expect(await backOffice.addHumanCoach(claire, { ...sophie, bookingUrl: "https://calendly.com/sophie" })).toMatchObject({ ok: false });
    await backOffice.retireHumanCoach(claire, added.coach.id);
    await backOffice.retireHumanCoach(claire, added.coach.id);

    const coach = { id: added.coach.id, name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance", bio: "Ancienne DRH." };
    expect(await backOffice.journal()).toMatchObject([
      { section: "human_coaches", target: "sophie.martin@rh-conseil.fr", action: "retired", before: coach, after: null },
      { section: "human_coaches", target: "sophie.martin@rh-conseil.fr", action: "added", before: null, after: coach, actor: { candidateId: claire.id, email: "claire@jobbbox.fr" } },
    ]);
  });

  it("a write that fails records nothing", async () => {
    const refused = { ...STARTING_PLAN_QUOTAS.standard, profiles: -1 };

    await expect(backOffice.setPlanQuotas(claire, "standard", refused)).rejects.toThrow();

    expect(await backOffice.journal()).toEqual([]);
    expect((await billing.planQuotas()).standard).toEqual(STARTING_PLAN_QUOTAS.standard);
  });

  it("a change that cannot be recorded is not kept either", async () => {
    const unknownAdministrator = { id: "no-such-candidate", email: "ghost@jobbbox.fr" };

    await expect(backOffice.setPlanQuotas(unknownAdministrator, "standard", { ...STARTING_PLAN_QUOTAS.standard, profiles: 9 })).rejects.toThrow();

    expect((await billing.planQuotas()).standard).toEqual(STARTING_PLAN_QUOTAS.standard);
    expect(await backOffice.journal()).toEqual([]);
  });

  it("a replaced secret is recorded without its value", async () => {
    const secret = "sk-live-0123456789";

    await backOffice.record(
      claire,
      async () => secret,
      // As a careless caller could pass it: the value must still not be recorded.
      () => ({ section: "provider_secrets", target: "MISTRAL_API_KEY", action: "replaced", before: "sk-old", after: secret }) as never,
    );

    const [entry] = await backOffice.journal();
    expect(entry).toMatchObject({ section: "provider_secrets", target: "MISTRAL_API_KEY", action: "replaced", before: null, after: null });
    expect(JSON.stringify(entry)).not.toContain("sk-");
  });

  it("the Journal lists entries newest first, everything or one section", async () => {
    await backOffice.setPlanQuotas(claire, "free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 5 });
    const added = await backOffice.addHumanCoach(claire, { name: "Luc Bernard", email: "luc@rh-conseil.fr", bookingUrl: "https://cal.com/luc/seance" });
    if (!added.ok) throw new Error("fixture refused");
    await backOffice.setPlanQuotas(claire, "premium", { ...STARTING_PLAN_QUOTAS.premium, matchScores: 500 });

    expect((await backOffice.journal()).map((entry) => entry.target)).toEqual(["premium", "luc@rh-conseil.fr", "free"]);
    expect((await backOffice.journal({ section: "plan_quotas" })).map((entry) => entry.target)).toEqual(["premium", "free"]);
    expect((await backOffice.journal({ section: "human_coaches" })).map((entry) => entry.target)).toEqual(["luc@rh-conseil.fr"]);
    expect(await backOffice.journal({ section: "roles" })).toEqual([]);
  });
});
