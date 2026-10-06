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

describe.skipIf(!connectionString)("Profiles (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let profiles: Profiles;
  let candidateId: string;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = (testAuth.auth.options.database as import("pg").Pool);
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
      searchCriteria: { targetRole: "Directrice financière", location: "Lyon", minSalary: 120000, contractType: "cdi", remoteWork: "hybrid" },
      masterCv: { version: 1, content: masterCv },
    });
    expect(await profiles.list(candidateId)).toEqual([{ id: created.profile.id, name: "Directrice financière" }]);
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

  it("never shows a Candidate someone else's Profile", async () => {
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
    const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

    expect(created.ok && (await profiles.get(otherId, created.profile.id))).toBeNull();
    expect(await profiles.list(otherId)).toEqual([]);
    expect(await profiles.get(candidateId, "not-a-uuid")).toBeNull();
  });
});
