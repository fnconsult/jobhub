import { createAiLayer, type AiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { CompanyRegisterUnavailable, type CompanyRegister, type RegisteredCompany } from "./french-register";
import { createCompanyDossiers, migrateCompanyDossiers, type CompanyDossiers } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** A made-up company as the register adapter gives it. */
const acme: RegisteredCompany = {
  siren: "552100554",
  name: "ACME INDUSTRIE",
  acronym: "ACME",
  active: true,
  legalForm: "SAS",
  activity: "28.29B",
  address: "12 RUE DE LA REPUBLIQUE 69002 LYON",
  headcount: { min: 250, max: 499 },
  category: "ETI",
  financials: [{ year: 2024, revenue: 45_500_000, netIncome: -300_000 }],
  executiveRoles: ["Président de SAS", "Directeur Général"],
};

/** Another company registered under ACME INDUSTRIE: a small one, as homonyms of large employers are. */
const smallHomonym: RegisteredCompany = {
  siren: "814000001",
  name: "ACME INDUSTRIE",
  active: true,
  category: "PME",
  financials: [],
  executiveRoles: [],
};

/** A register that answers every query with the same companies (or, for a SIREN in `bySiren`, with that one), and records the queries. */
function fakeRegister(companies: RegisteredCompany[] = []) {
  const queries: string[] = [];
  const register: CompanyRegister & {
    queries: string[];
    companies: RegisteredCompany[];
    bySiren: Record<string, RegisteredCompany>;
    soleTraderNamed: boolean;
    down: boolean;
  } = {
    queries,
    companies,
    bySiren: {},
    soleTraderNamed: false,
    down: false,
    async search(query) {
      queries.push(query);
      if (register.down) throw new CompanyRegisterUnavailable("down");
      const listed = register.bySiren[query.replace(/\s/g, "")];
      return { companies: listed ? [listed] : register.companies, soleTraderNamed: register.soleTraderNamed };
    },
  };
  return register;
}

describe.skipIf(!connectionString)("Company Dossiers (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let jobOffers: JobOffers;
  let applications: Applications;
  let dossiers: CompanyDossiers;
  let register: ReturnType<typeof fakeRegister>;
  let mistral: FakeProvider;
  let perplexity: FakeProvider;
  let ai: AiLayer;
  let candidateId: string;
  let otherCandidateId: string;
  let profileId: string;
  /** What the offer analysis answers: is the posting from a recruiting agency, and for whom. */
  let analysis: { recruitingAgency: boolean; presumedEmployer: string | null } | string;
  let webAnswer: string;
  let webSources: string[];

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** Saves a Job Offer with these details as an Application of the Candidate. */
  async function applicationFor(details: { employer?: string; content?: string; title?: string }, owner = candidateId, ownerProfileId = profileId) {
    const captured = await jobOffers.capture({
      title: details.title ?? "DAF H/F",
      content: details.content ?? `Poste de DAF ${Math.random()}`,
      employer: details.employer,
      location: "Lyon",
    });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    const saved = await applications.save(owner, { jobOfferId: captured.jobOffer.id, profileId: ownerProfileId });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateCompanyDossiers(database);
    const profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    register = fakeRegister([acme]);
    analysis = { recruitingAgency: false, presumedEmployer: null };
    webAnswer = "{}";
    webSources = ["https://example.com/about"];
    mistral = createFakeProvider({ id: "mistral", reply: () => (typeof analysis === "string" ? analysis : JSON.stringify(analysis)) });
    perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", sources: ["https://example.com/about"] });
    perplexity.search = async (query) => {
      perplexity.queries.push(query);
      return { answer: webAnswer, sources: webSources, model: "fake", usage: { inputTokens: 1, outputTokens: 1 } };
    };
    ai = createAiLayer({ providers: [mistral, perplexity], routes: { offer_analysis: "mistral", web_search: "perplexity" }, usage: createMemoryUsageLog() });
    dossiers = createCompanyDossiers(database, { applications, register, ai });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    profileId = created.profile.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("French employers", () => {
    it("matches the employer to its SIREN in the register and shows its identity, address and financials", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie SAS" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({
        ok: true,
        state: {
          status: "built",
          dossier: {
            source: "french_register",
            reliability: "official",
            employer: "Acme Industrie SAS",
            siren: "552100554",
            name: "ACME INDUSTRIE",
            legalForm: "SAS",
            activity: "28.29B",
            address: "12 RUE DE LA REPUBLIQUE 69002 LYON",
            headcount: { min: 250, max: 499 },
            financials: [{ year: 2024, revenue: 45_500_000, netIncome: -300_000 }],
          },
        },
      });
      expect(register.queries).toEqual(["Acme Industrie SAS"]);
      expect(perplexity.queries).toEqual([]);
    });

    it("gives the dossier without financials when the register publishes none", async () => {
      register.companies = [{ ...acme, financials: [] }];
      const applicationId = await applicationFor({ employer: "ACME" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { siren: "552100554", financials: [] } } });
    });

    it("never takes a fuzzy match: a company with another name is not the employer", async () => {
      register.companies = [{ ...acme, name: "ACME INDUSTRIE SERVICES", acronym: undefined }];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "web", reliability: "less_reliable" } } });
      expect(JSON.stringify(result)).not.toContain("552100554");
    });

    it("never picks between several companies registered under the employer's name", async () => {
      register.companies = [acme, { ...acme, siren: "999888777" }];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "web" } } });
    });

    it("takes the one large company among the small ones registered under the employer's name", async () => {
      register.companies = [smallHomonym, acme, { ...smallHomonym, siren: "814000002", category: undefined }];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "french_register", siren: "552100554" } } });
      expect(perplexity.queries).toEqual([]);
    });

    it("prefers the company registered under the employer's name to one whose acronym it is", async () => {
      const store: RegisteredCompany = { ...acme, siren: "814000004", name: "ACME HYPERMARCHES", acronym: "ACME INDUSTRIE", category: "GE" };
      register.companies = [smallHomonym, acme, store];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { dossier: { source: "french_register", siren: "552100554" } } });
    });

    it("never picks between small companies registered under the employer's name", async () => {
      register.companies = [{ ...smallHomonym, headcount: { min: 20, max: 49 } }, { ...smallHomonym, siren: "814000002" }];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "web" } } });
    });

    it("tells the employer apart from its French subsidiary", async () => {
      const subsidiary: RegisteredCompany = { ...acme, siren: "814000003", name: "ACME INDUSTRIE FRANCE", acronym: undefined };
      register.companies = [acme, subsidiary];

      const parent = await dossiers.build(candidateId, await applicationFor({ employer: "Acme Industrie" }));
      const french = await dossiers.build(candidateId, await applicationFor({ employer: "Acme Industrie France" }));

      expect(parent).toMatchObject({ ok: true, state: { dossier: { source: "french_register", siren: "552100554" } } });
      expect(french).toMatchObject({ ok: true, state: { dossier: { source: "french_register", siren: "814000003" } } });
    });

    describe("known by another name than the registered one (Michelin, BlaBlaCar)", () => {
      /** The group, registered under a longer name than it is known by; homonyms hold the short name. */
      const group: RegisteredCompany = { ...acme, siren: "855200887", name: "COMPAGNIE GENERALE DES ETABLISSEMENTS ACME", acronym: "CGEA", category: "GE" };

      it("takes the SIREN the web search gives once the register lists it under a name bearing the employer's", async () => {
        register.companies = [smallHomonym];
        register.bySiren = { [group.siren]: group };
        webAnswer = JSON.stringify({ country: "France", siren: "855 200 887", website: "acme.example" });
        const applicationId = await applicationFor({ employer: "Acme" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({
          ok: true,
          state: { dossier: { source: "french_register", reliability: "official", employer: "Acme", siren: "855200887", name: group.name } },
        });
        expect(register.queries).toEqual(["Acme", "855200887"]);
      });

      it("takes it when the employer's name is the company's shop sign", async () => {
        register.companies = [];
        register.bySiren = { "491904546": { ...acme, siren: "491904546", name: "COMUTO", acronym: undefined, shopSigns: ["ACMECAR"] } };
        webAnswer = JSON.stringify({ country: "France", siren: "491904546" });
        const applicationId = await applicationFor({ employer: "AcmeCar" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({ ok: true, state: { dossier: { source: "french_register", siren: "491904546", name: "COMUTO" } } });
      });

      it("keeps the web dossier when the SIREN given is listed under a name that does not bear the employer's", async () => {
        register.companies = [];
        register.bySiren = { "521724336": { ...acme, siren: "521724336", name: "LBC FRANCE", acronym: undefined } };
        webAnswer = JSON.stringify({ country: "France", siren: "521724336" });
        const applicationId = await applicationFor({ employer: "Acmecoin" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({ ok: true, state: { dossier: { source: "web", reliability: "less_reliable", country: "France" } } });
        expect(JSON.stringify(result)).not.toContain("521724336");
      });

      it("keeps the web dossier when the SIREN given is only a small company's whose name holds the employer's among other words", async () => {
        register.companies = [];
        register.bySiren = { [group.siren]: { ...group, category: "PME" } };
        webAnswer = JSON.stringify({ siren: group.siren });
        const applicationId = await applicationFor({ employer: "Acme" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({ ok: true, state: { dossier: { source: "web" } } });
      });
    });

    it("matches the SIREN the Candidate gives as the employer", async () => {
      register.companies = [acme, { ...acme, siren: "999888777" }];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "552 100 554" });

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "french_register", siren: "552100554" } } });
    });

    it("suggests contact roles by the employer's size, and lists executives by role only", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({
        ok: true,
        state: { dossier: { suggestedContactRoles: ["hiring_manager", "talent_acquisition", "hr_director"], executiveRoles: ["Président de SAS", "Directeur Général"] } },
      });
    });

    it("keeps the dossier for the next visit", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie" });
      await dossiers.build(candidateId, applicationId);

      const state = await dossiers.get(candidateId, applicationId);

      expect(state).toMatchObject({ status: "built", dossier: { siren: "552100554", builtAt: expect.any(Date) } });
    });

    it("changes nothing when the register is unavailable", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie" });
      register.down = true;

      expect(await dossiers.build(candidateId, applicationId)).toEqual({ ok: false, error: "unavailable" });
      expect(await dossiers.get(candidateId, applicationId)).toEqual({ status: "not_built" });
    });
  });

  describe("foreign employers", () => {
    it("builds a dossier from web sources, labelled less reliable, keeping only the facts asked for", async () => {
      register.companies = [];
      webAnswer = JSON.stringify({
        country: "Allemagne",
        headquarters: "Berlin",
        industry: "Robotique",
        headcount: "1 200 salariés",
        revenue: "300 M€ (2024)",
        website: "acme-robotics.example",
        ceo: "Hans Müller",
      });
      const applicationId = await applicationFor({ employer: "Acme Robotics GmbH" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toEqual({
        ok: true,
        state: {
          status: "built",
          dossier: {
            source: "web",
            reliability: "less_reliable",
            employer: "Acme Robotics GmbH",
            builtAt: expect.any(Date),
            country: "Allemagne",
            address: "Berlin",
            industry: "Robotique",
            headcount: "1 200 salariés",
            revenue: "300 M€ (2024)",
            website: "https://acme-robotics.example",
            sources: ["https://example.com/about"],
            suggestedContactRoles: ["hiring_manager", "talent_acquisition", "hr_director"],
          },
        },
      });
      expect(perplexity.queries[0]).toContain("« Acme Robotics GmbH »");
      expect(JSON.stringify(result)).not.toContain("Müller");
    });

    it("drops web facts that name a person or give a street address", async () => {
      register.companies = [];
      webAnswer = JSON.stringify({
        country: "États-Unis",
        headquarters: "Home office of John Smith, 12 Elm St, Austin",
        industry: "Software, founded by Jane Doe",
        headcount: "Jane Doe and 3 employees",
        revenue: "2 M$",
      });
      const applicationId = await applicationFor({ employer: "PersonLeak Inc" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { dossier: { source: "web", country: "États-Unis", revenue: "2 M$" } } });
      const dossier = JSON.stringify(result);
      expect(dossier).not.toMatch(/Smith|Doe|Elm/);
    });

    it("never gives a person's profile as the company's website", async () => {
      register.companies = [];
      for (const website of ["https://www.linkedin.com/in/sarah-connor", "facebook.com/sarah.connor", "javascript:alert(1)"]) {
        webAnswer = JSON.stringify({ country: "United Kingdom", headcount: "about 40 employees", website });
        const applicationId = await applicationFor({ employer: "Leaky Consulting Ltd" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({ ok: true, state: { dossier: { source: "web", country: "United Kingdom" } } });
        expect(JSON.stringify(result)).not.toMatch(/connor|javascript/i);
      }
    });

    it("keeps a LinkedIn company page as the website", async () => {
      register.companies = [];
      webAnswer = JSON.stringify({ website: "https://www.linkedin.com/company/leaky-consulting" });
      const applicationId = await applicationFor({ employer: "Leaky Consulting Ltd" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { dossier: { website: "https://www.linkedin.com/company/leaky-consulting" } } });
    });

    it("keeps only web pages as sources, never a person's profile", async () => {
      register.companies = [];
      webSources = [
        "https://www.linkedin.com/in/john-smith-austin",
        "https://fr.linkedin.com/pub/jane-doe/1/2/3",
        "https://www.facebook.com/john.smith",
        "javascript:alert(1)",
        "not a url",
        "https://www.linkedin.com/company/personleak",
        "https://personleak.example/about",
      ];
      const applicationId = await applicationFor({ employer: "PersonLeak Inc" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({
        ok: true,
        state: { dossier: { sources: ["https://www.linkedin.com/company/personleak", "https://personleak.example/about"] } },
      });
    });

    it("still gives a labelled dossier with its sources when the web answer is not readable", async () => {
      register.companies = [];
      webAnswer = "Je n'ai rien trouvé de fiable.";
      const applicationId = await applicationFor({ employer: "Obscure Ltd" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({
        ok: true,
        state: { status: "built", dossier: { source: "web", reliability: "less_reliable", sources: ["https://example.com/about"] } },
      });
    });
  });

  describe("Presumed Employer", () => {
    it("only proposes the Presumed Employer of a recruiting agency's posting, without looking anything up", async () => {
      analysis = { recruitingAgency: true, presumedEmployer: "Acme Industrie" };
      const applicationId = await applicationFor({ employer: "Cabinet Recrutement Conseil", content: "Notre client, leader lyonnais de l'équipement..." });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toEqual({
        ok: true,
        state: { status: "awaiting_confirmation", presumedEmployer: "Acme Industrie", agency: "Cabinet Recrutement Conseil" },
      });
      expect(register.queries).toEqual([]);
      expect(perplexity.queries).toEqual([]);
      expect(mistral.calls[0]!.messages[0]!.content).toContain("Notre client, leader lyonnais");
    });

    it("keeps waiting for the Candidate's confirmation when the dossier is built again", async () => {
      analysis = { recruitingAgency: true, presumedEmployer: "Acme Industrie" };
      const applicationId = await applicationFor({ employer: "Cabinet Recrutement Conseil" });
      await dossiers.build(candidateId, applicationId);

      const again = await dossiers.build(candidateId, applicationId);

      expect(again).toMatchObject({ ok: true, state: { status: "awaiting_confirmation" } });
      expect(await dossiers.get(candidateId, applicationId)).toMatchObject({ status: "awaiting_confirmation", presumedEmployer: "Acme Industrie" });
      expect(register.queries).toEqual([]);
      expect(perplexity.queries).toEqual([]);
    });

    it("builds the dossier once the Candidate confirms the Presumed Employer, and keeps it as the employer", async () => {
      analysis = { recruitingAgency: true, presumedEmployer: "Acme Industrie" };
      const applicationId = await applicationFor({ employer: "Cabinet Recrutement Conseil" });
      await dossiers.build(candidateId, applicationId);

      const confirmed = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "Acme Industrie" });
      const rebuilt = await dossiers.build(candidateId, applicationId);

      expect(confirmed).toMatchObject({ ok: true, state: { status: "built", dossier: { employer: "Acme Industrie", siren: "552100554" } } });
      expect(rebuilt).toMatchObject({ ok: true, state: { status: "built", dossier: { employer: "Acme Industrie", siren: "552100554" } } });
      expect(register.queries).toEqual(["Acme Industrie", "Acme Industrie"]);
    });

    it("lets the Candidate name another employer than the one presumed", async () => {
      analysis = { recruitingAgency: true, presumedEmployer: "Acme Industrie" };
      register.companies = [];
      const applicationId = await applicationFor({ employer: "Cabinet Recrutement Conseil" });
      await dossiers.build(candidateId, applicationId);

      const result = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "Globex Corp" });

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { employer: "Globex Corp", source: "web" } } });
      expect(perplexity.queries[0]).toContain("« Globex Corp »");
    });

    it("asks the Candidate to name the employer when the Job Offer names none", async () => {
      const applicationId = await applicationFor({});

      expect(await dossiers.build(candidateId, applicationId)).toEqual({ ok: true, state: { status: "employer_unknown" } });
      expect(register.queries).toEqual([]);
    });

    it("treats an unreadable offer analysis as a posting by the employer itself", async () => {
      analysis = "désolé";
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      expect(await dossiers.build(candidateId, applicationId)).toMatchObject({ ok: true, state: { status: "built", dossier: { siren: "552100554" } } });
    });

    it("refuses a SIREN the register lists no company under, without searching the web", async () => {
      register.companies = [];
      const applicationId = await applicationFor({});

      const result = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "988 402 277" });

      expect(result).toEqual({ ok: false, errors: [{ field: "employer", code: "not_a_company" }] });
      expect(perplexity.queries).toEqual([]);
      expect(await dossiers.get(candidateId, applicationId)).toEqual({ status: "not_built" });
    });

    it("refuses a sole trader's name, a private person's, without searching the web", async () => {
      register.companies = [];
      register.soleTraderNamed = true;
      const applicationId = await applicationFor({});

      const result = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "Damien Dupont" });

      expect(result).toEqual({ ok: false, errors: [{ field: "employer", code: "not_a_company" }] });
      expect(perplexity.queries).toEqual([]);
    });

    it("asks the Candidate to name the employer when the Job Offer's employer is a sole trader", async () => {
      register.companies = [];
      register.soleTraderNamed = true;
      const applicationId = await applicationFor({ employer: "Damien Dupont" });

      expect(await dossiers.build(candidateId, applicationId)).toEqual({ ok: true, state: { status: "employer_unknown" } });
      expect(perplexity.queries).toEqual([]);
    });

    it("names the missing employer", async () => {
      const applicationId = await applicationFor({});

      expect(await dossiers.confirmEmployer(candidateId, applicationId, { employer: "  " })).toEqual({
        ok: false,
        errors: [{ field: "employer", code: "required" }],
      });
    });
  });

  it("shows and builds a dossier only for the Candidate's own Application", async () => {
    const applicationId = await applicationFor({ employer: "Acme Industrie" });

    expect(await dossiers.get(otherCandidateId, applicationId)).toBeNull();
    expect(await dossiers.build(otherCandidateId, applicationId)).toEqual({ ok: false, error: "not_found" });
    expect(await dossiers.confirmEmployer(otherCandidateId, applicationId, { employer: "Acme" })).toEqual({ ok: false, error: "not_found" });
    expect(await dossiers.get(candidateId, "not-an-id")).toBeNull();
    expect(register.queries).toEqual([]);
  });
});
