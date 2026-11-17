import type { MasterCvContent } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createProfiles, migrateProfiles, type Profiles } from "./index";
import { newProfileStart, profilePlanQuota, profileUpgradePrompt } from "./plan-quota";

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
const draft = (targetRole: string) => ({ masterCv, searchCriteria: { targetRole, locations: ["Lyon"] } });
/** A Profile born during its onboarding and not finished (#999): « Création à terminer ». */
const unfinished = (targetRole: string) => ({ ...draft(targetRole), onboarding: "in_progress" });

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

  describe("how /profils/nouveau opens (#1048)", () => {
    const born = async (input: unknown) => {
      const created = await profiles.create(marie, input);
      if (!created.ok) throw new Error("fixture Profile refused");
      return created.profile.id;
    };

    it("resumes the Profile « Création à terminer » instead of the Upgrade Prompt when the Plan Quota is reached", async () => {
      const id = await born(unfinished("DAF"));

      expect(await newProfileStart(t.billing, profiles, marie, "fr")).toEqual({ start: "resume", profileId: id });
    });

    it("resumes the most recent of several unfinished Profiles", async () => {
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, profiles: 2 });
      await born(unfinished("DAF"));
      const latest = await born(unfinished("Consultante"));

      expect(await newProfileStart(t.billing, profiles, marie, "fr")).toEqual({ start: "resume", profileId: latest });
    });

    it("never resumes an archived Profile", async () => {
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, profiles: 3 });
      const older = await born(unfinished("DAF"));
      await born(draft("Consultante"));
      const archived = await born(unfinished("Contrôleuse de gestion"));
      await profiles.archive(marie, archived);
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, profiles: 2 });

      expect(await newProfileStart(t.billing, profiles, marie, "fr")).toEqual({ start: "resume", profileId: older });
    });

    it("shows the Upgrade Prompt as before when finished Profiles reach the quota", async () => {
      const id = await born(unfinished("DAF"));
      expect(await profiles.finishOnboarding(marie, id, { basedOnVersion: 1, masterCv })).toMatchObject({ ok: true });

      expect(await newProfileStart(t.billing, profiles, marie, "fr")).toEqual({
        start: "upgrade",
        prompt: await profileUpgradePrompt(t.billing, profiles, marie, "fr"),
      });
      expect(await newProfileStart(t.billing, profiles, marie, "en")).toMatchObject({ start: "upgrade", prompt: { upgradeTo: "standard" } });
    });

    it("starts a new onboarding while the Plan leaves room, even with an unfinished Profile", async () => {
      await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, profiles: 2 });
      await born(unfinished("DAF"));

      expect(await newProfileStart(t.billing, profiles, marie, "fr")).toEqual({ start: "onboarding" });
    });

    it("leaves the Plan Quota count unchanged: the unfinished Profile still counts", async () => {
      await born(unfinished("DAF"));
      await newProfileStart(t.billing, profiles, marie, "fr");

      expect(await profileUpgradePrompt(t.billing, profiles, marie, "fr")).toMatchObject({ upgradeTo: "standard" });
      expect(await profiles.canAddProfile(marie)).toBe(false);
      expect(await profiles.create(marie, unfinished("Consultante"))).toEqual({ ok: false, error: "plan_quota_reached" });
      expect(await profiles.list(marie)).toHaveLength(1);
    });
  });
});
