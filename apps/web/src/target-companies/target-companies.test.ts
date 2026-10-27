import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompanyRegister, RegisteredCompany } from "../company-dossiers/french-register";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { companyKeyOf, createTargetCompanies, migrateTargetCompanies, webSearchableName, type TargetCompanies } from "./index";

const connectionString = process.env.DATABASE_URL;
const NOW = new Date("2026-10-26T08:00:00Z");
const LATER = new Date("2026-11-30T08:00:00Z");

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

describe("webSearchableName: a Target Company's name goes to the web search only as a company's (ADR-0007)", () => {
  /** The register: ACME a company (SIREN 552100554), JEAN DUPONT a sole trader (SIREN 812345678); the queries asked. */
  const asked: string[] = [];
  const fake: CompanyRegister = {
    search: async (query) => {
      asked.push(query);
      const q = query.trim().toLowerCase();
      return {
        companies: q === "552100554" || q === "acme industrie" ? [{ siren: "552100554", name: "ACME INDUSTRIE", active: true, financials: [], executiveRoles: [] }] : [],
        soleTraderNamed: q === "812345678" || q === "jean dupont",
      };
    },
  };

  it("sends a company's name when the register lists its SIREN as a company, asking it by SIREN alone", async () => {
    asked.length = 0;
    expect(await webSearchableName(fake, { companyKey: "siren:552100554", name: "ACME" })).toEqual({ name: "ACME" });
    expect(asked).toEqual(["552100554"]);
  });

  it("never sends the name of a sole trader, nor of a SIREN the register does not list", async () => {
    asked.length = 0;
    expect(await webSearchableName(fake, { companyKey: "siren:812345678", name: "JEAN DUPONT" })).toEqual({ refused: "not_a_company" });
    expect(await webSearchableName(fake, { companyKey: "siren:999999999", name: "GHOST SARL" })).toEqual({ refused: "not_a_company" });
    expect(asked).toEqual(["812345678", "999999999"]);
  });

  it("for a name without SIREN, sends it unless the register lists it as a sole trader's or it holds a SIREN", async () => {
    expect(await webSearchableName(fake, { companyKey: "name:globex robotics", name: "Globex Robotics GmbH" })).toEqual({ name: "Globex Robotics GmbH" });
    expect(await webSearchableName(fake, { companyKey: "name:jean dupont", name: "Jean Dupont" })).toEqual({ refused: "not_a_company" });
    expect(await webSearchableName(fake, { companyKey: "name:812 345 678", name: "812 345 678" })).toEqual({ refused: "not_a_company" });
  });

  it("sends nothing when the register cannot answer", async () => {
    const down: CompanyRegister = {
      search: async () => {
        throw new Error("register down");
      },
    };
    expect(await webSearchableName(down, { companyKey: "siren:552100554", name: "ACME" })).toEqual({ refused: "register_unavailable" });
    expect(await webSearchableName(down, { companyKey: "name:globex robotics", name: "Globex Robotics" })).toEqual({ refused: "register_unavailable" });
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
    const created = await createProfiles(database).create(candidateId, { masterCv, searchCriteria: { targetRole: "Directeur financier", locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_target_companies");
    database = throwaway.pool;
    // The candidate table as far as Profiles need it.
    await database.query("CREATE TABLE IF NOT EXISTS candidate (id text PRIMARY KEY)");
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateJobSearches(database);
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

  it("keeps La Bonne Boite's headcount band for each company, none for the Candidate's own (#409)", async () => {
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [{ ...acme, headcount: { min: 250, max: 499 } }, { ...beta, headcount: { min: 10000 } }, gamma] }, NOW);
    await createTargetCompanies(database, { now: () => NOW, register: register([]) }).add("candidate-1", profileId, "Tisserands du Rhône");

    const headcounts = Object.fromEntries((await targets.list(profileId)).map((company) => [company.name, company.headcount]));
    expect(headcounts).toEqual({
      "ACME INDUSTRIE": { min: 250, max: 499 },
      "BETA LOGISTIQUE": { min: 10000, max: null },
      "GAMMA CONSEIL": null,
      "Tisserands du Rhône": null,
    });
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

  it("refuses a name the company register lists as a sole trader's, a private person's (ADR-0007)", async () => {
    const soleTrader = createTargetCompanies(database, { now: () => NOW, register: { search: async () => ({ companies: [], soleTraderNamed: true }) } });

    expect(await soleTrader.add("candidate-1", profileId, "Jean Dupont")).toEqual({ ok: false, error: "not_a_company" });
    expect(await soleTrader.list(profileId)).toEqual([]);
  });

  describe("on the Profile's page (#409)", () => {
    let jobOffers: JobOffers;
    let applications: Applications;
    beforeEach(() => {
      jobOffers = createJobOffers(database);
      applications = createApplications(database, { jobOffers, profiles: createProfiles(database) });
      targets = createTargetCompanies(database, { now: () => NOW, register: register([{ siren: "552100554", name: "ACME INDUSTRIE" }]), jobOffers, applications });
    });

    /** A Job Offer at `employer`, found by a Job Search of the Profile. */
    async function foundBy(profile: string, candidateId: string, title: string, employer: string): Promise<string> {
      const captured = await jobOffers.capture({ title, content: `${title} chez ${employer}`, employer, source: { url: `https://jobs.example/${encodeURIComponent(title + employer)}` } });
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      await database.query("INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at) VALUES ($1, $2, 'done', $3, $4)", [candidateId, profile, [captured.jobOffer.id], NOW]);
      return captured.jobOffer.id;
    }

    it("shows the Candidate's own first, then La Bonne Boite's by hiring score, none set aside nor « not a company »", async () => {
      await targets.refresh("candidate-1", profileId, { key: "k", companies: [beta, acme, gamma, { siret: "81234567800012", name: "JEAN DUPONT", hiringScore: 99 }] }, NOW);
      await createTargetCompanies(database, { now: () => NOW, register: register([]) }).add("candidate-1", profileId, "Tisserands du Rhône");
      const listed = await targets.list(profileId);
      await targets.setAside("candidate-1", profileId, listed.find((company) => company.name === "GAMMA CONSEIL")!.id);
      await targets.notACompany(profileId, [listed.find((company) => company.name === "JEAN DUPONT")!.id], NOW);

      const shown = await targets.onProfile("candidate-1", profileId);

      expect(shown?.map((company) => company.name)).toEqual(["Tisserands du Rhône", "ACME INDUSTRIE", "BETA LOGISTIQUE"]);
      expect(await targets.onProfile("candidate-2", profileId)).toBeNull();
    });

    it("lists the Job Offers the Profile's Job Searches found there, by the employer's name", async () => {
      await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
      const atAcme = await foundBy(profileId, "candidate-1", "Directeur financier", "Acme Industrie SAS");
      await foundBy(profileId, "candidate-1", "Contrôleur de gestion", "Autre Société");
      await foundBy(otherProfileId, "candidate-2", "Responsable comptable", "ACME INDUSTRIE");

      const shown = await targets.onProfile("candidate-1", profileId);

      expect(shown?.find((company) => company.name === "ACME INDUSTRIE")?.jobOffers).toEqual([{ id: atAcme, title: "Directeur financier" }]);
      expect(shown?.find((company) => company.name === "BETA LOGISTIQUE")?.jobOffers).toEqual([]);
    });

    it("prepares one Spontaneous Application per Target Company: the Profile's job at the company, no posting", async () => {
      await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
      const acmeId = (await targets.list(profileId)).find((company) => company.name === "ACME INDUSTRIE")!.id;

      const prepared = await targets.prepareSpontaneousApplication("candidate-1", profileId, acmeId);
      if (!prepared.ok) throw new Error("not prepared");
      const application = await applications.get("candidate-1", prepared.applicationId);
      expect(application).toMatchObject({ status: "to_apply", profile: { id: profileId }, jobOffer: { title: "Directeur financier", employer: "ACME INDUSTRIE", location: "Lyon" } });
      expect(application?.jobOffer.source.url).toBeUndefined();
      const shown = await targets.onProfile("candidate-1", profileId);
      expect(shown?.find((company) => company.id === acmeId)?.spontaneousApplicationId).toBe(prepared.applicationId);
      expect(shown?.find((company) => company.name === "BETA LOGISTIQUE")?.spontaneousApplicationId).toBeNull();

      // Prepared once: asked again, the same one.
      expect(await targets.prepareSpontaneousApplication("candidate-1", profileId, acmeId)).toEqual(prepared);
    });

    it("prepares it again once the Candidate deleted it, and never for another's Profile or a company set aside", async () => {
      await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
      const [first, second] = await targets.list(profileId);
      const prepared = await targets.prepareSpontaneousApplication("candidate-1", profileId, first!.id);
      if (!prepared.ok) throw new Error("not prepared");
      await database.query("DELETE FROM application WHERE id = $1", [prepared.applicationId]);

      expect((await targets.onProfile("candidate-1", profileId))?.find((company) => company.id === first!.id)?.spontaneousApplicationId).toBeNull();
      const again = await targets.prepareSpontaneousApplication("candidate-1", profileId, first!.id);
      expect(again.ok && again.applicationId).not.toBe(prepared.applicationId);

      expect(await targets.prepareSpontaneousApplication("candidate-2", profileId, second!.id)).toEqual({ ok: false, error: "not_found" });
      await targets.setAside("candidate-1", profileId, second!.id);
      expect(await targets.prepareSpontaneousApplication("candidate-1", profileId, second!.id)).toEqual({ ok: false, error: "not_found" });
    });
  });

  it("records the visits of Job discovery", async () => {
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
    const [first] = await targets.list(profileId);

    await targets.visited(profileId, [first!.id], LATER);

    expect((await targets.list(profileId)).find((company) => company.id === first!.id)!.lastVisitedAt).toEqual(LATER);
  });

  it("keeps the company register's « not a company » for the Profile's Target Company, through La Bonne Boite's refreshes", async () => {
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, NOW);
    const [first, second] = await targets.list(profileId);

    await targets.notACompany(profileId, [first!.id], LATER);
    await targets.refresh("candidate-1", profileId, { key: "k", companies: [acme, beta] }, LATER);

    const listed = await targets.list(profileId);
    expect(listed.find((company) => company.id === first!.id)!.notACompanyAt).toEqual(LATER);
    expect(listed.find((company) => company.id === second!.id)!.notACompanyAt).toBeNull();
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
