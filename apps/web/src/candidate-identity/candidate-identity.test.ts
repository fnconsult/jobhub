import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { candidateIdentityOf } from "./index";

const masterCv: MasterCvContent = {
  fullName: "DUPONT Marie",
  headline: "Directrice financière",
  email: "m.dupont@perso.example",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};

describe.skipIf(!connectionString)("what the AI layer takes out of a Candidate's calls (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    profiles = createProfiles(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("is the account's email and name alone without a Profile", async () => {
    const marie = await signIn("marie.dupont@example.fr");
    await database.query(`UPDATE candidate SET name = 'Marie Dupont' WHERE id = $1`, [marie]);

    expect(await candidateIdentityOf(database)(marie)).toEqual({ fullName: ["Marie Dupont"], firstName: "Marie", email: ["marie.dupont@example.fr"], phone: [], address: [] });
  });

  it("adds the latest Master CV's identity block, its location only when it is a postal address", async () => {
    const marie = await signIn("marie.dupont@example.fr");
    const created = await profiles.create(marie, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    // "DUPONT Marie": the family name in capitals, as French CVs write it.
    expect(await candidateIdentityOf(database)(marie)).toMatchObject({ fullName: ["DUPONT Marie"], firstName: "Marie", phone: ["06 12 34 56 78"], address: [] });

    await profiles.saveMasterCv(marie, created.profile.id, { basedOnVersion: 1, content: { ...masterCv, fullName: "Marie Dupont", location: "12 rue des Lilas, 69003 Lyon" } });

    expect(await candidateIdentityOf(database)(marie)).toMatchObject({
      fullName: ["Marie Dupont"],
      firstName: "Marie",
      email: ["marie.dupont@example.fr", "m.dupont@perso.example"],
      address: ["12 rue des Lilas, 69003 Lyon"],
    });
  });

  it("is null for an id with no account", async () => {
    expect(await candidateIdentityOf(database)("nobody")).toBeNull();
  });
});
