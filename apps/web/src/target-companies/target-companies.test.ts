import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompanyRegister, RegisteredCompany } from "../company-dossiers/french-register";
import { migrateProfiles } from "../profiles";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { companyKeyOf, createTargetCompanies, migrateTargetCompanies, type TargetCompanies } from "./index";

const connectionString = process.env.DATABASE_URL;
const NOW = new Date("2026-10-26T08:00:00Z");
const LATER = new Date("2026-11-30T08:00:00Z");

const acme = { siret: "55210055400013", name: "ACME INDUSTRIE", hiringScore: 82.5, city: "Lyon", activity: "Fabrication de machines" };
const beta = { siret: "38012986600025", name: "BETA LOGISTIQUE", hiringScore: 64, city: "Vénissieux" };
const gamma = { siret: "41234567800011", name: "GAMMA CONSEIL", hiringScore: 70 };

/** The register listing `companies` under any name. */
const register = (companies: Partial<RegisteredCompany>[]): CompanyRegister => ({
  search: async () => ({ companies: companies.map((company) => ({ siren: "", name: "", active: true, financials: [], executiveRoles: [], ...company })), soleTraderNamed: false }),
});

describe("companyKeyOf", () => {
  it("knows a company by its SIREN, from an establishment's SIRET too, else by its name without case, accents or legal form", () => {
    expect(companyKeyOf({ siret: "55210055400013", name: "ACME" })).toBe("siren:552100554");
    expect(companyKeyOf({ siren: "552100554", name: "Acme" })).toBe("siren:552100554");
    expect(companyKeyOf({ name: "Société Générale SA" })).toBe("name:societe generale");
  });
});

describe.skipIf(!connectionString)("Target Companies (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  let targets: TargetCompanies;
  let profileId: string;
  let otherProfileId: string;

  async function newProfile(candidateId: string): Promise<string> {
    await database.query("INSERT INTO candidate (id) VALUES ($1) ON CONFLICT DO NOTHING", [candidateId]);
    const { rows } = await database.query<{ id: string }>(
      "INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'DAF', 'Directeur financier', ARRAY['Lyon']) RETURNING id",
      [candidateId],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_target_companies");
    database = throwaway.pool;
    // The candidate table as far as Profiles need it.
    await database.query("CREATE TABLE IF NOT EXISTS candidate (id text PRIMARY KEY)");
    await migrateProfiles(database);
    await migrateTargetCompanies(database);
    await migrateTargetCompanies(database);
    targets = createTargetCompanies(database, { now: () => NOW, register: register([{ siren: "552100554", name: "ACME INDUSTRIE" }]) });
    profileId = await newProfile("candidate-1");
    otherProfileId = await newProfile("candidate-2");
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  it("keeps La Bonne Boite's companies for the Profile, with what they were fetched for and when", async () => {
    expect(await targets.lastRefresh(profileId)).toBeNull();

    await targets.refresh("candidate-1", profileId, { key: "directeur financier|lyon", companies: [acme, beta] }, NOW);

    expect(await targets.lastRefresh(profileId)).toEqual({ key: "directeur financier|lyon", at: NOW });
    const listed = await targets.list(profileId);
    expect(listed.map(({ name, companyKey, origin, hiringScore, city }) => ({ name, companyKey, origin, hiringScore, city })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "ACME INDUSTRIE", companyKey: "siren:552100554", origin: "la_bonne_boite", hiringScore: 82.5, city: "Lyon" },
      { name: "BETA LOGISTIQUE", companyKey: "siren:380129866", origin: "la_bonne_boite", hiringScore: 64, city: "Vénissieux" },
    ]);
    expect(await targets.list(otherProfileId)).toEqual([]);
  });

  it("drops the companies La Bonne Boite no longer gives, but never brings back one set aside", async () => {
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
    const betaId = (await targets.list(profileId)).find((company) => company.name === "BETA LOGISTIQUE")!.id;
    expect(await targets.setAside("candidate-1", profileId, betaId)).toBe(true);

    await targets.refresh("candidate-1", profileId, { key: "k2", companies: [beta, gamma] }, LATER);

    expect((await targets.list(profileId)).map((company) => company.name).sort()).toEqual(["GAMMA CONSEIL"]);
    expect(await targets.lastRefresh(profileId)).toEqual({ key: "k2", at: LATER });
  });

  it("adds the Candidate's own company as the company register lists it, kept through La Bonne Boite's refreshes", async () => {
    const added = await targets.add("candidate-1", profileId, "acme");
    expect(added).toMatchObject({ ok: true, company: { name: "ACME INDUSTRIE", companyKey: "siren:552100554", origin: "candidate", hiringScore: null } });

    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [] }, LATER);

    expect((await targets.list(profileId)).map(({ name, origin }) => ({ name, origin }))).toEqual([{ name: "ACME INDUSTRIE", origin: "candidate" }]);
  });

  it("keeps a company the register does not list under the name given, and refuses one listed already or another's Profile", async () => {
    const unregistered = createTargetCompanies(database, { now: () => NOW, register: register([]) });

    expect(await unregistered.add("candidate-1", profileId, "  Tisserands   du Rhône ")).toMatchObject({ ok: true, company: { name: "Tisserands du Rhône", companyKey: "name:tisserands du rhone" } });
    expect(await unregistered.add("candidate-1", profileId, "TISSERANDS DU RHONE")).toEqual({ ok: false, error: "exists" });
    expect(await unregistered.add("candidate-1", otherProfileId, "Tisserands")).toEqual({ ok: false, error: "invalid" });
    expect(await unregistered.add("candidate-1", profileId, "  ")).toEqual({ ok: false, error: "invalid" });
    expect(await unregistered.setAside("candidate-2", profileId, (await unregistered.list(profileId))[0]!.id)).toBe(false);
  });

  it("records the visits of Job discovery", async () => {
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
    const [first] = await targets.list(profileId);

    await targets.visited(profileId, [first!.id], LATER);

    expect((await targets.list(profileId)).find((company) => company.id === first!.id)!.lastVisitedAt).toEqual(LATER);
  });

  it("keeps one careers site per company, for every Profile", async () => {
    await targets.keepCareersSite("siren:552100554", "https://boards.greenhouse.io/acme", NOW);
    await targets.keepCareersSite("siren:552100554", "https://jobs.lever.co/acme", LATER);

    expect(await targets.careersSites(["siren:552100554", "siren:380129866"])).toEqual(new Map([["siren:552100554", "https://jobs.lever.co/acme"]]));
    expect(await targets.careersSites([])).toEqual(new Map());
  });

  it("goes with its Profile", async () => {
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme] }, NOW);
    await targets.keepCareersSite("siren:552100554", "https://boards.greenhouse.io/acme", NOW);

    await database.query("DELETE FROM profile WHERE id = $1", [profileId]);

    expect(await targets.list(profileId)).toEqual([]);
    expect(await targets.lastRefresh(profileId)).toBeNull();
    expect((await targets.careersSites(["siren:552100554"])).size).toBe(1);
  });
});
