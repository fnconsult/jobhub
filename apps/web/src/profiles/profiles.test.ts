import type { MasterCvContent } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createProfiles, migrateProfiles, type Profiles } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "25 ans d'expérience dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const criteria = { targetRole: "Directrice financière", location: "Lyon" };

describe.skipIf(!connectionString)("Profiles (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: import("pg").Pool;
  let profiles: Profiles;
  let candidateId: string;

  async function createdProfile(name = "Directrice financière", candidate = candidateId) {
    const created = await profiles.create(candidate, { masterCv, searchCriteria: { ...criteria, targetRole: name } });
    if (!created.ok) throw new Error("could not create the Profile");
    return created.profile;
  }

  async function otherCandidate() {
    const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as import("pg").Pool;
    await migrateProfiles(database);
    profiles = createProfiles(database);
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    candidateId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("creates a Profile from a reviewed CV, with its Search Criteria and version 1 of its Master CV", async () => {
    const created = await profiles.create(candidateId, {
      masterCv,
      searchCriteria: { targetRole: "Directrice financière", location: "Lyon", minSalary: 120000, contractType: "cdi", remoteWork: "hybrid" },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await profiles.get(candidateId, created.profile.id)).toEqual({
      id: created.profile.id,
      name: "Directrice financière",
      archived: false,
      searchCriteria: { targetRole: "Directrice financière", location: "Lyon", minSalary: 120000, contractType: "cdi", remoteWork: "hybrid" },
      masterCv: { version: 1, content: masterCv },
    });
    expect(await profiles.list(candidateId)).toEqual([{ id: created.profile.id, name: "Directrice financière", archived: false }]);
  });

  it("keeps salary, contract type and remote work optional, and trims what the Candidate typed", async () => {
    const created = await profiles.create(candidateId, {
      masterCv: { ...masterCv, skills: ["  IFRS ", "", "SAP"], experience: [...masterCv.experience, { title: " ", employer: "", location: "", period: "", description: "" }] },
      searchCriteria: { targetRole: "  DAF  ", location: "Lyon" },
    });

    expect(created.ok && created.profile.searchCriteria).toEqual({ targetRole: "DAF", location: "Lyon" });
    expect(created.ok && created.profile.masterCv.content.skills).toEqual(["IFRS", "SAP"]);
    expect(created.ok && created.profile.masterCv.content.experience).toEqual(masterCv.experience);
  });

  it("refuses a draft without a target role or a location, naming the fields to fix", async () => {
    const created = await profiles.create(candidateId, {
      masterCv,
      searchCriteria: { targetRole: " ", location: "", contractType: "stage", minSalary: -5 },
    });

    expect(created).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: "searchCriteria.targetRole", code: "required" },
        { field: "searchCriteria.location", code: "required" },
        { field: "searchCriteria.contractType", code: "invalid" },
        { field: "searchCriteria.minSalary", code: "invalid" },
      ]),
    });
    expect(await profiles.list(candidateId)).toEqual([]);
  });

  it("calls a filled salary that is not a whole number invalid, not missing", async () => {
    for (const minSalary of ["110,000", "55 000,00", "55k", "abc"]) {
      const created = await profiles.create(candidateId, {
        masterCv,
        searchCriteria: { targetRole: "DAF", location: "Lyon", minSalary },
      });
      expect(created).toEqual({ ok: false, errors: [{ field: "searchCriteria.minSalary", code: "invalid" }] });
    }
  });

  it("refuses something that is not a CV draft at all", async () => {
    expect(await profiles.create(candidateId, "hello")).toMatchObject({ ok: false });
    expect(await profiles.create(candidateId, { searchCriteria: { targetRole: "DAF", location: "Lyon" } })).toMatchObject({
      ok: false,
      errors: [{ field: "masterCv", code: "required" }],
    });
  });

  describe("editing the Master CV", () => {
    async function createProfile() {
      const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
      if (!created.ok) throw new Error("could not create the Profile");
      return created.profile;
    }

    it("saves an edited Master CV as its next version", async () => {
      const profile = await createProfile();
      const edited = {
        ...masterCv,
        experience: [
          { title: "Contrôleuse de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "" },
          ...masterCv.experience,
        ],
        skills: ["SAP", "IFRS", "Consolidation"],
        languages: [],
      };

      const saved = await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: edited });

      expect(saved).toEqual({ ok: true, profile: { ...profile, masterCv: { version: 2, content: edited } } });
      expect((await profiles.get(candidateId, profile.id))?.masterCv).toEqual({ version: 2, content: edited });
    });

    it("refuses edits made on a version that is no longer the current one, so no save is silently lost", async () => {
      const profile = await createProfile();
      await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: { ...masterCv, headline: "DAF" } });

      const stale = await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: { ...masterCv, summary: "Autre" } });

      expect(stale).toEqual({ ok: false, conflict: { currentVersion: 2 } });
      expect((await profiles.get(candidateId, profile.id))?.masterCv.content.headline).toBe("DAF");
    });

    it("does not create a version when nothing changed", async () => {
      const profile = await createProfile();

      const saved = await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: { ...masterCv, skills: [" IFRS", "SAP", ""] } });

      expect(saved).toEqual({ ok: true, profile });
    });

    it("refuses something that is not a Master CV, and never edits someone else's Profile", async () => {
      const profile = await createProfile();
      const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
      const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

      expect(await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: { fullName: "X" } })).toMatchObject({ ok: false, errors: expect.any(Array) });
      expect(await profiles.saveMasterCv(otherId, profile.id, { basedOnVersion: 1, content: masterCv })).toBeNull();
      expect(await profiles.saveMasterCv(candidateId, "not-a-uuid", { basedOnVersion: 1, content: masterCv })).toBeNull();
      expect((await profiles.get(candidateId, profile.id))?.masterCv.version).toBe(1);
    });

    it("lists every version of the Master CV, newest first", async () => {
      const profile = await createProfile();
      const v2 = { ...masterCv, headline: "DAF" };
      await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: v2 });

      const versions = await profiles.masterCvVersions(candidateId, profile.id);

      expect(versions).toEqual([
        { version: 2, savedAt: expect.any(Date), restoredFrom: null, content: v2 },
        { version: 1, savedAt: expect.any(Date), restoredFrom: null, content: masterCv },
      ]);
    });

    it("restores a previous version as a new version, keeping the history", async () => {
      const profile = await createProfile();
      await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 1, content: { ...masterCv, headline: "DAF" } });
      await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: 2, content: { ...masterCv, headline: "DAF groupe" } });

      const restored = await profiles.restoreMasterCv(candidateId, profile.id, 1);

      expect(restored?.masterCv).toEqual({ version: 4, content: masterCv });
      expect((await profiles.get(candidateId, profile.id))?.masterCv).toEqual({ version: 4, content: masterCv });
      expect((await profiles.masterCvVersions(candidateId, profile.id))?.map(({ version, restoredFrom }) => [version, restoredFrom])).toEqual([
        [4, 1],
        [3, null],
        [2, null],
        [1, null],
      ]);
    });

    it("restoring the current version changes nothing", async () => {
      const profile = await createProfile();

      expect(await profiles.restoreMasterCv(candidateId, profile.id, 1)).toEqual(profile);
      expect(await profiles.masterCvVersions(candidateId, profile.id)).toHaveLength(1);
    });

    it("never shows or restores the versions of someone else's Profile, nor a version that does not exist", async () => {
      const profile = await createProfile();
      const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
      const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

      expect(await profiles.masterCvVersions(otherId, profile.id)).toBeNull();
      expect(await profiles.restoreMasterCv(otherId, profile.id, 1)).toBeNull();
      expect(await profiles.restoreMasterCv(candidateId, profile.id, 7)).toBeNull();
      expect(await profiles.masterCvVersions(candidateId, "not-a-uuid")).toBeNull();
    });
  });

  it("never shows a Candidate someone else's Profile", async () => {
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
    const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

    expect(created.ok && (await profiles.get(otherId, created.profile.id))).toBeNull();
    expect(await profiles.list(otherId)).toEqual([]);
    expect(await profiles.get(candidateId, "not-a-uuid")).toBeNull();
  });

  describe("renaming", () => {
    it("renames a Profile, trimming the name, without touching its Search Criteria", async () => {
      const profile = await createdProfile();

      const renamed = await profiles.rename(candidateId, profile.id, { name: "  DAF industrie  " });

      expect(renamed).toMatchObject({ ok: true, profile: { id: profile.id, name: "DAF industrie" } });
      expect(await profiles.get(candidateId, profile.id)).toMatchObject({ name: "DAF industrie", searchCriteria: criteria });
      expect(await profiles.list(candidateId)).toEqual([{ id: profile.id, name: "DAF industrie", archived: false }]);
    });

    it("needs a name of at most 120 characters", async () => {
      const profile = await createdProfile();

      expect(await profiles.rename(candidateId, profile.id, { name: "  " })).toEqual({ ok: false, errors: [{ field: "name", code: "required" }] });
      expect(await profiles.rename(candidateId, profile.id, {})).toEqual({ ok: false, errors: [{ field: "name", code: "required" }] });
      expect(await profiles.rename(candidateId, profile.id, { name: "x".repeat(121) })).toEqual({ ok: false, errors: [{ field: "name", code: "invalid" }] });
      expect((await profiles.get(candidateId, profile.id))?.name).toBe("Directrice financière");
    });

    it("never renames someone else's Profile", async () => {
      const profile = await createdProfile();

      expect(await profiles.rename(await otherCandidate(), profile.id, { name: "Piraté" })).toEqual({ ok: false, error: "not_found" });
      expect(await profiles.rename(candidateId, "not-a-uuid", { name: "DAF" })).toEqual({ ok: false, error: "not_found" });
      expect((await profiles.get(candidateId, profile.id))?.name).toBe("Directrice financière");
    });
  });

  describe("archiving", () => {
    it("archives a Profile without losing it, and restores it", async () => {
      const kept = await createdProfile("Directrice financière");
      const old = await createdProfile("Consultante transformation");

      expect(await profiles.archive(candidateId, old.id)).toMatchObject({ ok: true, profile: { id: old.id, archived: true } });
      expect(await profiles.list(candidateId)).toEqual([
        { id: kept.id, name: "Directrice financière", archived: false },
        { id: old.id, name: "Consultante transformation", archived: true },
      ]);
      expect(await profiles.get(candidateId, old.id)).toMatchObject({ archived: true, masterCv: { version: 1, content: masterCv } });

      expect(await profiles.restore(candidateId, old.id)).toMatchObject({ ok: true, profile: { id: old.id, archived: false } });
      expect((await profiles.list(candidateId)).map((profile) => profile.archived)).toEqual([false, false]);
    });

    it("never archives or restores someone else's Profile", async () => {
      const profile = await createdProfile();
      const other = await otherCandidate();

      expect(await profiles.archive(other, profile.id)).toEqual({ ok: false, error: "not_found" });
      expect(await profiles.restore(other, profile.id)).toEqual({ ok: false, error: "not_found" });
      expect(await profiles.archive(candidateId, "not-a-uuid")).toEqual({ ok: false, error: "not_found" });
      expect((await profiles.get(candidateId, profile.id))?.archived).toBe(false);
    });
  });

  describe("duplicating", () => {
    it("copies the Search Criteria and the current Master CV into a new Profile under the chosen name", async () => {
      const created = await profiles.create(candidateId, {
        masterCv,
        searchCriteria: { ...criteria, minSalary: 120000, contractType: "cdi", remoteWork: "hybrid" },
      });
      if (!created.ok) throw new Error("could not create the Profile");
      const original = created.profile;
      await database.query(`INSERT INTO master_cv_version (profile_id, version, content) VALUES ($1, 2, $2)`, [
        original.id,
        { ...masterCv, summary: "Version revue." },
      ]);

      const duplicated = await profiles.duplicate(candidateId, original.id, { name: " Consultante transformation " });

      expect(duplicated.ok).toBe(true);
      if (!duplicated.ok) return;
      expect(duplicated.profile.id).not.toBe(original.id);
      expect(await profiles.get(candidateId, duplicated.profile.id)).toEqual({
        id: duplicated.profile.id,
        name: "Consultante transformation",
        archived: false,
        searchCriteria: { ...criteria, minSalary: 120000, contractType: "cdi", remoteWork: "hybrid" },
        masterCv: { version: 1, content: { ...masterCv, summary: "Version revue." } },
      });
      expect(await profiles.get(candidateId, original.id)).toMatchObject({ name: "Directrice financière", masterCv: { version: 2 } });
      expect((await profiles.list(candidateId)).map((profile) => profile.name)).toEqual(["Directrice financière", "Consultante transformation"]);
    });

    it("needs a name, and never duplicates someone else's Profile", async () => {
      const profile = await createdProfile();

      expect(await profiles.duplicate(candidateId, profile.id, { name: "" })).toEqual({ ok: false, errors: [{ field: "name", code: "required" }] });
      expect(await profiles.duplicate(await otherCandidate(), profile.id, { name: "Copie" })).toEqual({ ok: false, error: "not_found" });
      expect(await profiles.duplicate(candidateId, "not-a-uuid", { name: "Copie" })).toEqual({ ok: false, error: "not_found" });
      expect(await profiles.list(candidateId)).toHaveLength(1);
    });
  });
});
