import type { MasterCvContent } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createProfiles, migrateProfiles, type Profiles } from "./index";
import { profilePlanQuota, profileUpgradePrompt } from "./plan-quota";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};
const draft = (targetRole: string) => ({ masterCv, searchCriteria: { targetRole, location: "Lyon" } });

describe.skipIf(!connectionString)("Profiles under the Plan Quota (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let profiles: Profiles;
  let marie: string;

  beforeEach(async () => {
    t = await startTestBilling();
    await migrateProfiles(t.database);
    profiles = createProfiles(t.database, { profileQuota: profilePlanQuota(t.billing) });
    marie = (await t.signUp("marie.dupont@example.fr")).id;
  });
  afterEach(async () => {
    await t.stop();
  });

  it("lets a Free Candidate hold one active Profile, then prompts them to upgrade to Standard", async () => {
    const first = await profiles.create(marie, draft("DAF"));
    expect(first.ok).toBe(true);
    expect(await profileUpgradePrompt(t.billing, profiles, marie, "en")).toMatchObject({ upgradeTo: "standard", href: "/abonnement" });

    expect(await profiles.create(marie, draft("Consultante"))).toEqual({ ok: false, error: "plan_quota_reached" });
    expect(await profileUpgradePrompt(t.billing, profiles, marie, "fr")).toMatchObject({
      upgradeTo: "standard",
      action: expect.stringContaining("Standard"),
      href: "/abonnement",
    });
  });

  it("has no prompt while the Plan leaves room, and counts only active Profiles", async () => {
    expect(await profileUpgradePrompt(t.billing, profiles, marie, "fr")).toBeNull();

    const first = await profiles.create(marie, draft("DAF"));
    if (!first.ok) throw new Error("fixture Profile refused");
    await profiles.archive(marie, first.profile.id);

    expect(await profileUpgradePrompt(t.billing, profiles, marie, "fr")).toBeNull();
    expect(await profiles.create(marie, draft("Consultante"))).toMatchObject({ ok: true });
  });

  it("follows the Plan's quota as Administrators change it; no limit when it is unlimited", async () => {
    await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, profiles: null });

    for (const role of ["DAF", "Consultante", "Contrôleuse de gestion"]) expect(await profiles.create(marie, draft(role))).toMatchObject({ ok: true });
    expect(await profileUpgradePrompt(t.billing, profiles, marie, "fr")).toBeNull();
  });
});
