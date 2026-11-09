import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { backfillIdentityNames, createIdentityNames, migrateIdentityNames, type IdentityNames } from "./index";

const masterCv: MasterCvContent = {
  fullName: "DUPONT Marie",
  headline: "Directrice financière",
  email: "m.dupont@perso.example",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};

describe.skipIf(!connectionString)("the Candidate's Given Name, Family Name and Preferred Name (needs Postgres: DATABASE_URL, #918)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let identity: IdentityNames;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const id = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
    return { id, cookie };
  }

  async function withCv(candidateId: string, fullName: string) {
    const created = await profiles.create(candidateId, { masterCv: { ...masterCv, fullName }, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
  }

  const accountNameOf = async (candidateId: string) => (await database.query<{ name: string }>(`SELECT name FROM candidate WHERE id = $1`, [candidateId])).rows[0]?.name;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    profiles = createProfiles(database);
    identity = createIdentityNames(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("a new account has none of the three", async () => {
    const { id } = await signIn("marie.dupont@example.fr");
    expect(await identity.of(id)).toEqual({ givenName: null, familyName: null, preferredName: null });
    expect(await identity.of("nobody")).toBeNull();
  });

  it("an existing account « DUPONT Marie » (CV alone) gets Given Name Marie, Family Name Dupont, Preferred Name Marie; running the migration again changes nothing", async () => {
    const { id } = await signIn("marie.dupont@example.fr");
    await withCv(id, "DUPONT Marie");

    await migrateIdentityNames(database);

    expect(await identity.of(id)).toEqual({ givenName: "Marie", familyName: "Dupont", preferredName: "Marie" });
    expect(await accountNameOf(id)).toBe("Marie Dupont");

    // The Candidate clears their Preferred Name: the migration run again (the next deployment) leaves it cleared.
    await identity.save(id, { givenName: "Marie", familyName: "Dupont", preferredName: "" });
    await migrateIdentityNames(database);
    expect(await identity.of(id)).toEqual({ givenName: "Marie", familyName: "Dupont", preferredName: null });
  });

  it("takes the account's name before the Master CV's, and fills in only what is empty, whenever it runs", async () => {
    const { id: marie } = await signIn("marie.dupont@example.fr");
    await database.query(`UPDATE candidate SET name = 'Marie-Hélène Dupont' WHERE id = $1`, [marie]);
    await withCv(marie, "DUPONT Marie");
    const { id: luc } = await signIn("luc.bernard@example.fr");
    await database.query(`UPDATE candidate SET name = 'Luc Bernard', given_name = 'Lucien' WHERE id = $1`, [luc]);
    const { id: nobody } = await signIn("sans.nom@example.fr");

    expect(await backfillIdentityNames(database)).toBe(2);

    expect(await identity.of(marie)).toEqual({ givenName: "Marie-Hélène", familyName: "Dupont", preferredName: "Marie-Hélène" });
    expect(await identity.of(luc)).toEqual({ givenName: "Lucien", familyName: "Bernard", preferredName: "Lucien" });
    expect(await accountNameOf(luc)).toBe("Lucien Bernard");
    expect(await identity.of(nobody)).toEqual({ givenName: null, familyName: null, preferredName: null });
    expect(await accountNameOf(nobody)).toBe("");

    expect(await backfillIdentityNames(database)).toBe(0);
    expect(await identity.of(marie)).toEqual({ givenName: "Marie-Hélène", familyName: "Dupont", preferredName: "Marie-Hélène" });
  });

  it("the Candidate changes and clears each of the three, and the account's name follows « Prénom Nom »", async () => {
    const { id } = await signIn("marie.dupont@example.fr");

    expect(await identity.save(id, { givenName: "  Marie  ", familyName: "Dupont", preferredName: "Marie" })).toEqual({
      ok: true,
      names: { givenName: "Marie", familyName: "Dupont", preferredName: "Marie" },
    });
    expect(await accountNameOf(id)).toBe("Marie Dupont");

    await identity.save(id, { givenName: "Marie-Hélène", familyName: "Dupont", preferredName: "Malou" });
    expect(await identity.of(id)).toEqual({ givenName: "Marie-Hélène", familyName: "Dupont", preferredName: "Malou" });
    expect(await accountNameOf(id)).toBe("Marie-Hélène Dupont");

    await identity.save(id, { givenName: "", familyName: "Dupont", preferredName: "Malou" });
    expect(await identity.of(id)).toEqual({ givenName: null, familyName: "Dupont", preferredName: "Malou" });
    expect(await accountNameOf(id)).toBe("Dupont");

    await identity.save(id, { givenName: "Marie", familyName: " ", preferredName: "Malou" });
    expect(await identity.of(id)).toEqual({ givenName: "Marie", familyName: null, preferredName: "Malou" });
    expect(await accountNameOf(id)).toBe("Marie");

    await identity.save(id, { givenName: "", familyName: "", preferredName: "" });
    expect(await identity.of(id)).toEqual({ givenName: null, familyName: null, preferredName: null });
    expect(await accountNameOf(id)).toBe("");
  });

  it("refuses a name longer than 80 characters, once trimmed, and changes nothing", async () => {
    const { id } = await signIn("marie.dupont@example.fr");
    await identity.save(id, { givenName: "Marie", familyName: "Dupont", preferredName: "Marie" });

    expect(await identity.save(id, { givenName: "Marie", familyName: "D".repeat(81), preferredName: "Marie" })).toEqual({ ok: false, field: "familyName" });
    expect(await identity.of(id)).toEqual({ givenName: "Marie", familyName: "Dupont", preferredName: "Marie" });
    expect(await identity.save(id, { givenName: `  ${"M".repeat(80)}  `, familyName: "Dupont", preferredName: "Marie" })).toMatchObject({ ok: true });
  });

  it("the three are never set through Better Auth's own account update, which would leave the account's name behind", async () => {
    const { id, cookie } = await signIn("marie.dupont@example.fr");
    await testAuth.request("/api/auth/update-user", { cookie, body: { givenName: "Mallory", familyName: "X", preferredName: "Y" } });

    expect(await identity.of(id)).toEqual({ givenName: null, familyName: null, preferredName: null });
  });

  it("the session's Candidate carries the three", async () => {
    const { id, cookie } = await signIn("marie.dupont@example.fr");
    await identity.save(id, { givenName: "Marie", familyName: "Dupont", preferredName: "Malou" });

    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    expect(user).toMatchObject({ name: "Marie Dupont", givenName: "Marie", familyName: "Dupont", preferredName: "Malou" });
  });
});
