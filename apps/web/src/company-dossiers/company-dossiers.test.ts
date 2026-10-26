import { AiProviderError, createAiLayer, type AiLayer, type TextInput } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider, type MemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent, ProvenanceEvent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { servedTasks, taskAgent } from "../task-playbooks/test-support";
import { CompanyRegisterUnavailable, type CompanyRegister, type RegisteredCompany } from "./french-register";
import { createCompanyDossiers, dossierSites, migrateCompanyDossiers, type CompanyDossiers } from "./index";

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

/** Whether a text call is the company-facts-search agent reading the pages found (#405). */
const readsPages = (input: TextInput) => input.messages.some((message) => message.content.includes("<pages>"));

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
  let analysis: { recruitingAgency: boolean; presumedEmployer: string | null; presumedEmployerDescription?: string | null } | string;
  /** What the company-facts-search task Playbook's agent writes, reading the pages (#405). */
  let webAnswer: string;
  /** The pages the company web search returns, as a Search provider lists them; and their addresses. */
  let webPages: string;
  let webSources: string[];
  let usage: MemoryUsageLog;
  /** What the Company News search answers, or an error it fails with; its queries are kept apart from the company search's. */
  let newsAnswer: string | Error;
  let newsQueries: string[];

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
    webPages = "About\nhttps://example.com/about\nA company.";
    webSources = ["https://example.com/about"];
    mistral = createFakeProvider({
      id: "mistral",
      models: ["fake-mistral", "mistral-small-latest"],
      reply: (input) => (readsPages(input) ? webAnswer : typeof analysis === "string" ? analysis : JSON.stringify(analysis)),
    });
    perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", sources: ["https://example.com/about"] });
    newsAnswer = JSON.stringify({ articles: [] });
    newsQueries = [];
    perplexity.search = async (asked) => {
      const query = [asked].flat().join("\n");
      if (query.startsWith("Articles de presse")) {
        newsQueries.push(query);
        if (newsAnswer instanceof Error) throw newsAnswer;
        return { answer: newsAnswer, sources: [], model: "fake", usage: { inputTokens: 1, outputTokens: 1 } };
      }
      perplexity.queries.push(query);
      return { answer: webPages, sources: webSources, model: "fake", usage: { inputTokens: 1, outputTokens: 1 } };
    };
    usage = createMemoryUsageLog();
    ai = createAiLayer({ providers: [mistral, perplexity], routes: { offer_analysis: "mistral", web_search: "perplexity" }, usage });
    dossiers = createCompanyDossiers(database, { applications, register, ai });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
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

      expect(await dossiers.build(candidateId, applicationId)).toEqual({ ok: false, error: "unavailable", reason: "provider_unavailable" });
      expect(await dossiers.get(candidateId, applicationId)).toEqual({ status: "not_built" });
    });

    it("says why when the AI layer could not answer: its Failure Reason, never the provider's words (#367)", async () => {
      const applicationId = await applicationFor({ employer: "Globex Robotics" });
      register.companies = [];
      perplexity.search = async () => {
        throw new AiProviderError("perplexity", "429 Too Many Requests: slow down, Marie Dupont", 429);
      };

      expect(await dossiers.build(candidateId, applicationId)).toEqual({ ok: false, error: "unavailable", reason: "rate_limited" });
      expect(await dossiers.get(candidateId, applicationId)).toEqual({ status: "not_built" });
    });
  });

  describe("without the key of the active Search provider (#399)", () => {
    beforeEach(() => {
      ai = createAiLayer({ providers: [mistral], routes: { offer_analysis: "mistral", web_search: "perplexity" }, usage: createMemoryUsageLog() });
      dossiers = createCompanyDossiers(testAuth.auth.options.database as Pool, { applications, register, ai });
    });

    it("refuses a foreign employer's dossier, saying web search is unavailable, and changes nothing", async () => {
      const applicationId = await applicationFor({ employer: "Globex Robotics GmbH" });
      register.companies = [];

      expect(await dossiers.build(candidateId, applicationId)).toEqual({ ok: false, error: "web_search_unavailable" });
      expect(await dossiers.get(candidateId, applicationId)).toEqual({ status: "not_built" });
      expect(perplexity.queries).toEqual([]);
    });

    it("still builds a French employer's dossier from the register, without Company News", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie SAS" });

      expect(await dossiers.build(candidateId, applicationId)).toMatchObject({ ok: true, state: { status: "built", dossier: { siren: "552100554", news: [] } } });
    });
  });

  describe("foreign employers", () => {
    it("reads the facts in the pages the web search returned with the company-facts-search task Playbook's agent, its call kept in Provenance and AI Usage (#405)", async () => {
      register.companies = [];
      webPages = "About Globex\nhttps://globex.example/about\nIndustrial robotics, Munich, Germany. CEO: Hans Müller.";
      webSources = ["https://globex.example/about"];
      webAnswer = JSON.stringify({ country: "Allemagne", headquarters: "Munich", industry: "Robotique industrielle", siren: null });
      const applicationId = await applicationFor({ employer: "Globex GmbH" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({
        ok: true,
        state: {
          dossier: { source: "web", reliability: "less_reliable", country: "Allemagne", address: "Munich", industry: "Robotique industrielle", sources: ["https://globex.example/about"] },
          provenance: {
            steps: [
              { kind: "ai", activity: "think", task: "offer_analysis" },
              { kind: "tool", tool: "recherche-entreprises" },
              { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", count: 2 },
              { kind: "ai", activity: "read", task: "offer_analysis", provider: "mistral", outcome: "ok", count: 1 },
            ],
          },
        },
      });
      // The agent read the pages; the search was asked for pages only, never the JSON.
      const reading = mistral.calls.filter(readsPages);
      expect(reading).toHaveLength(1);
      expect(reading[0]!.messages.at(-1)!.content).toContain("Industrial robotics, Munich, Germany.");
      expect(perplexity.queries[0]).toMatch(/^« Globex GmbH » entreprise/);
      expect(perplexity.queries[0]).not.toMatch(/JSON/);
      expect(JSON.stringify(result)).not.toContain("Müller");
      expect(usage.entries.map((entry) => entry.task)).toEqual(["offer_analysis", "web_search", "offer_analysis", "web_search"]);
    });

    it("runs the reading on the Playbook Agent the served version names (#405)", async () => {
      register.companies = [];
      webAnswer = JSON.stringify({ country: "Allemagne" });
      const database = testAuth.auth.options.database as Pool;
      const content = "## requête\n\nSociété {{entreprise}}\n\n## lecture\n\nLis les pages.";
      const taskPlaybooks = servedTasks({ "company-facts-search": { content, agent: taskAgent("mistral", "mistral-small-latest") } });
      const served = createCompanyDossiers(database, { applications, register, ai, taskPlaybooks });

      const result = await served.build(candidateId, await applicationFor({ employer: "Globex GmbH" }));

      expect(result).toMatchObject({ ok: true, state: { dossier: { country: "Allemagne" } } });
      expect(perplexity.queries[0]).toBe("Société « Globex GmbH »");
      const [reading] = mistral.calls.filter(readsPages);
      expect(reading).toMatchObject({ model: "mistral-small-latest", system: expect.stringMatching(/^Lis les pages\./) });
    });

    it("with a version 1 served (production, until a person validates version 2) searches as before and reads no page: a Search provider's pages then give no facts (#405)", async () => {
      register.companies = [];
      webPages = "About Globex\nhttps://globex.example/about\nIndustrial robotics, Munich, Germany.";
      webAnswer = JSON.stringify({ country: "Allemagne" });
      const database = testAuth.auth.options.database as Pool;
      const taskPlaybooks = servedTasks({ "company-facts-search": { content: "Fiche d'entreprise de {{entreprise}}." } });
      const served = createCompanyDossiers(database, { applications, register, ai, taskPlaybooks });

      const result = await served.build(candidateId, await applicationFor({ employer: "Globex GmbH" }));

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "web", reliability: "less_reliable", sources: ["https://example.com/about"] } } });
      if (!result.ok || result.state.status !== "built" || result.state.dossier.source !== "web") throw new Error("no web dossier");
      expect(result.state.dossier).not.toHaveProperty("country");
      expect(perplexity.queries[0]).toMatch(/^Fiche d'entreprise de « Globex GmbH »\. Réponds uniquement par un objet JSON/);
      expect(mistral.calls.filter(readsPages)).toEqual([]);
    });

    it("changes nothing when the agent could not read the pages: its Failure Reason, as for the search (#405)", async () => {
      register.companies = [];
      const generate = mistral.generate!;
      mistral.generate = async (input) => {
        if (readsPages(input)) throw new AiProviderError("mistral", "503 Service Unavailable", 503);
        return generate(input);
      };
      const applicationId = await applicationFor({ employer: "Globex GmbH" });

      expect(await dossiers.build(candidateId, applicationId)).toMatchObject({ ok: false, error: "unavailable" });
      expect(await dossiers.get(candidateId, applicationId)).toEqual({ status: "not_built" });
    });

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
            news: [],
            newsSearched: true,
          },
          provenance: expect.objectContaining({ v: 1 }),
        },
      });
      expect(perplexity.queries[0]).toContain("« Acme Robotics GmbH »");
      expect(JSON.stringify(result)).not.toContain("Müller");
      // Its Company News is searched with its website, to tell it apart from namesakes.
      expect(newsQueries).toHaveLength(1);
      expect(newsQueries[0]).toContain("« Acme Robotics GmbH »");
      expect(newsQueries[0]).toContain("site web acme-robotics.example");
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

    describe("unnamed (the posting only describes the agency's client)", () => {
      const description = "Entreprise française spécialisée dans l'agencement et l'aménagement de pharmacies (nom non précisé)";

      it("proposes no name, and keeps the description apart from it", async () => {
        analysis = { recruitingAgency: true, presumedEmployer: null, presumedEmployerDescription: description };
        const applicationId = await applicationFor({ employer: "Talents Business" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toEqual({
          ok: true,
          state: { status: "awaiting_confirmation", presumedEmployer: null, presumedEmployerDescription: description, agency: "Talents Business" },
        });
        expect(await dossiers.get(candidateId, applicationId)).toMatchObject({ presumedEmployer: null, presumedEmployerDescription: description });
      });

      it("never takes a description the analysis gives as the name for a name", async () => {
        analysis = { recruitingAgency: true, presumedEmployer: description };
        const applicationId = await applicationFor({ employer: "Talents Business" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({ ok: true, state: { status: "awaiting_confirmation", presumedEmployer: null, presumedEmployerDescription: description } });
      });

      it.each([
        "Groupe industriel international (confidentiel)",
        "Client non communiqué",
        "Acteur majeur de la distribution pharmaceutique en France et en Europe",
      ])("reads %j as a description, not a name", async (given) => {
        analysis = { recruitingAgency: true, presumedEmployer: given };
        const applicationId = await applicationFor({ employer: "Talents Business" });

        expect(await dossiers.build(candidateId, applicationId)).toMatchObject({ state: { presumedEmployer: null, presumedEmployerDescription: given } });
      });

      it.each(["Société Générale", "Compagnie Générale des Établissements Michelin", "Groupe SEB", "552 100 554"])("keeps %j as a name", async (given) => {
        analysis = { recruitingAgency: true, presumedEmployer: given };
        const applicationId = await applicationFor({ employer: "Talents Business" });

        const result = await dossiers.build(candidateId, applicationId);

        expect(result).toMatchObject({ state: { presumedEmployer: given } });
        expect(result).not.toHaveProperty("state.presumedEmployerDescription");
      });

      it("builds the dossier from the employer name the Candidate types, never from the description", async () => {
        analysis = { recruitingAgency: true, presumedEmployer: description };
        const applicationId = await applicationFor({ employer: "Talents Business" });
        await dossiers.build(candidateId, applicationId);

        const result = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "Acme Industrie" });

        expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { employer: "Acme Industrie", siren: "552100554" } } });
        expect(register.queries).toEqual(["Acme Industrie"]);
        expect(perplexity.queries).toEqual([]);
      });
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

  describe("Company News", () => {
    /** The day `days` before today, YYYY-MM-DD. */
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const article = (fields: Record<string, unknown>) => ({ outlet: "Les Echos", date: daysAgo(30), url: "https://news.example/a", namesPerson: false, ...fields });

    it("searches the employer's news when the dossier is built, by its registered name, and keeps it with the dossier", async () => {
      newsAnswer = JSON.stringify({
        articles: [
          article({ title: "Acme Industrie ouvre une usine à Lyon", url: "https://news.example/usine", date: daysAgo(10) }),
          article({ title: "Acme Industrie publie ses résultats", url: "https://news.example/resultats", date: daysAgo(40) }),
          article({ title: "Acme Industrie déménage", url: "https://news.example/ancien", date: daysAgo(400) }),
          article({ title: "Pauline Martin quitte Acme Industrie", url: "https://news.example/depart" }),
        ],
      });
      const applicationId = await applicationFor({ employer: "Acme" });

      const result = await dossiers.build(candidateId, applicationId);

      const news = [
        { title: "Acme Industrie ouvre une usine à Lyon", outlet: "Les Echos", publishedAt: daysAgo(10), url: "https://news.example/usine" },
        { title: "Acme Industrie publie ses résultats", outlet: "Les Echos", publishedAt: daysAgo(40), url: "https://news.example/resultats" },
      ];
      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { source: "french_register", news } } });
      expect(newsQueries).toHaveLength(1);
      expect(newsQueries[0]).toContain("raison sociale « ACME INDUSTRIE »");
      expect(JSON.stringify(result)).not.toContain("Pauline");
      expect(await dossiers.get(candidateId, applicationId)).toMatchObject({ status: "built", dossier: { news } });
    });

    it("drops a title the dossier's own safeguards take for one about a person", async () => {
      newsAnswer = JSON.stringify({ articles: [article({ title: "Acme Industrie, l'entreprise fondée par un ingénieur lyonnais, grandit" })] });
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      expect(await dossiers.build(candidateId, applicationId)).toMatchObject({ ok: true, state: { dossier: { news: [] } } });
    });

    it("still builds the dossier, without news, when the news search fails", async () => {
      newsAnswer = new Error("HTTP 503");
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({ ok: true, state: { status: "built", dossier: { siren: "552100554", news: [] } } });
      expect(newsQueries).toHaveLength(1);
    });

    it("searches the news again when the dossier is built again", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie" });
      await dossiers.build(candidateId, applicationId);
      newsAnswer = JSON.stringify({ articles: [article({ title: "Acme Industrie recrute 200 personnes en 2027" })] });

      const result = await dossiers.build(candidateId, applicationId);

      expect(newsQueries).toHaveLength(2);
      expect(result).toMatchObject({ ok: true, state: { dossier: { news: [{ title: "Acme Industrie recrute 200 personnes en 2027" }] } } });
    });

    it("searches no news for an employer that is not a company, nor before the Candidate confirms a Presumed Employer", async () => {
      register.soleTraderNamed = true;
      register.companies = [];
      await dossiers.build(candidateId, await applicationFor({ employer: "Damien Dupont" }));
      analysis = { recruitingAgency: true, presumedEmployer: "Acme Industrie" };
      await dossiers.build(candidateId, await applicationFor({ employer: "Cabinet Talents" }));

      expect(newsQueries).toEqual([]);
    });

    it("gives a dossier built before Company News no news", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie" });
      const database = testAuth.auth.options.database as Pool;
      await database.query(`INSERT INTO company_dossier (application_id, dossier) VALUES ($1, $2)`, [
        applicationId,
        { source: "web", reliability: "less_reliable", employer: "Acme", builtAt: "2026-01-01T09:00:00.000Z", suggestedContactRoles: [], sources: [] },
      ]);

      expect(await dossiers.get(candidateId, applicationId)).toMatchObject({ status: "built", dossier: { employer: "Acme", news: [] } });
    });
  });

  it("words both web searches as their served version 1 task Playbooks say, the employer cleaned, the JSON asked and no person named (ADR-0026)", async () => {
    const database = testAuth.auth.options.database as Pool;
    const taskPlaybooks = servedTasks({
      "company-facts-search": { content: "Fiche courte de {{entreprise}}." },
      "company-news-search": { content: "Articles de presse sur {{entreprise}}, 2 au plus." },
    });
    const served = createCompanyDossiers(database, { applications, register, ai, taskPlaybooks });
    const applicationId = await applicationFor({ employer: "Globex Ltd" });

    await served.build(candidateId, applicationId);

    expect(perplexity.queries[0]).toMatch(/^Fiche courte de « Globex Ltd »\. Réponds uniquement par un objet JSON avec les clés .*Ne nomme aucune personne\.$/);
    expect(newsQueries[0]).toMatch(/^Articles de presse sur « Globex Ltd », 2 au plus\. Réponds uniquement par un objet JSON .*N'inclus aucun article dont le titre nomme une personne\.$/);
    expect(taskPlaybooks.reads).toEqual(expect.arrayContaining(["company-facts-search", "company-news-search"]));
  });

  it("searches on the web-search provider each served task Playbook names, else the configured one (ADR-0026)", async () => {
    const database = testAuth.auth.options.database as Pool;
    const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu", answer: "{}" });
    const withTavily = createAiLayer({ providers: [mistral, perplexity, tavily], routes: { offer_analysis: "mistral", web_search: "perplexity" }, usage: createMemoryUsageLog() });
    const taskPlaybooks = servedTasks({
      "company-facts-search": { content: "Fiche courte de {{entreprise}}.", search: { provider: "tavily", model: null } },
      "company-news-search": { content: "Articles de presse sur {{entreprise}}, 2 au plus." },
    });
    const served = createCompanyDossiers(database, { applications, register, ai: withTavily, taskPlaybooks });

    await served.build(candidateId, await applicationFor({ employer: "Globex Ltd" }));

    expect(tavily.queries).toEqual([expect.stringMatching(/^Fiche courte de « Globex Ltd »/)]);
    expect(perplexity.queries).toEqual([]);
    expect(newsQueries).toEqual([expect.stringMatching(/^Articles de presse sur « Globex Ltd »/)]);
  });

  describe("Provenance (ADR-0034, #335)", () => {
    const REGISTER_PAGE = "https://annuaire-entreprises.data.gouv.fr/entreprise/552100554";

    it("keeps what served a new dossier: the offer read, the register searched, the news searched, with the register's page and the articles as its sites", async () => {
      newsAnswer = JSON.stringify({
        articles: [{ title: "Acme Industrie ouvre une usine", outlet: "Les Echos", date: new Date().toISOString().slice(0, 10), url: "https://news.example/usine?utm_source=feed", namesPerson: false }],
      });
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      const result = await dossiers.build(candidateId, applicationId);

      const provenance = {
        v: 1,
        steps: [
          { kind: "ai", activity: "think", task: "offer_analysis", provider: "mistral", outcome: "ok", count: 1 },
          { kind: "tool", activity: "search", tool: "recherche-entreprises", outcome: "ok", count: 1 },
          { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", outcome: "ok", count: 1 },
        ],
        sites: [
          { kind: "web", domain: "annuaire-entreprises.data.gouv.fr", links: [REGISTER_PAGE] },
          { kind: "web", domain: "news.example", links: ["https://news.example/usine"] },
        ],
      };
      expect(result).toMatchObject({ ok: true, state: { status: "built", provenance } });
      expect(await dossiers.get(candidateId, applicationId)).toMatchObject({ status: "built", provenance });
    });

    it("keeps the web pages a dossier from the web was built from as its sites, never a person's profile", async () => {
      register.companies = [];
      webSources = ["https://globex.example/about?ref=search", "https://www.linkedin.com/in/jean-dupont"];
      const applicationId = await applicationFor({ employer: "Globex Corp" });

      const result = await dossiers.build(candidateId, applicationId);

      expect(result).toMatchObject({
        ok: true,
        state: {
          provenance: {
            steps: [
              { kind: "ai", task: "offer_analysis" },
              { kind: "tool", tool: "recherche-entreprises" },
              { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", count: 2 },
              { kind: "ai", activity: "read", task: "offer_analysis", provider: "mistral" },
            ],
            sites: [{ kind: "web", domain: "globex.example", links: ["https://globex.example/about"] }],
          },
        },
      });
    });

    it("joins the offer's reading that presumed the employer with the dossier built once the Candidate confirms it", async () => {
      analysis = { recruitingAgency: true, presumedEmployer: "Acme Industrie" };
      const applicationId = await applicationFor({ employer: "Cabinet Recrutement Conseil" });
      await dossiers.build(candidateId, applicationId);

      const confirmed = await dossiers.confirmEmployer(candidateId, applicationId, { employer: "Acme Industrie" });

      expect(confirmed).toMatchObject({
        ok: true,
        state: { provenance: { steps: [{ task: "offer_analysis" }, { tool: "recherche-entreprises" }, { task: "web_search" }], sites: [{ links: [REGISTER_PAGE] }] } },
      });
    });

    it("tells each step as it starts and ends", async () => {
      const events: ProvenanceEvent[] = [];
      const applicationId = await applicationFor({ employer: "Acme Industrie" });

      await dossiers.build(candidateId, applicationId, { onEvent: (event) => events.push(event) });

      expect(events.map((event) => [event.type, event.step.activity])).toEqual([
        ["step_started", "think"],
        ["step_ended", "think"],
        ["step_started", "search"],
        ["step_ended", "search"],
        ["step_started", "web_search"],
        ["step_ended", "web_search"],
      ]);
    });

    it("shows a dossier built before Provenance was kept as none, and the sites its own source names", async () => {
      const applicationId = await applicationFor({ employer: "Acme Industrie" });
      const other = await applicationFor({ employer: "Globex Corp" });
      const database = testAuth.auth.options.database as Pool;
      const built = { reliability: "official", employer: "Acme", builtAt: "2026-01-01T09:00:00.000Z", suggestedContactRoles: [] };
      await database.query(`INSERT INTO company_dossier (application_id, dossier) VALUES ($1, $2), ($3, $4)`, [
        applicationId,
        { ...built, source: "french_register", siren: "552100554", name: "ACME INDUSTRIE", financials: [], executiveRoles: [], news: [{ title: "Acme", outlet: "Les Echos", publishedAt: "2025-12-01", url: "https://news.example/a" }] },
        other,
        { ...built, source: "web", reliability: "less_reliable", sources: ["https://globex.example/about", "https://www.linkedin.com/in/jean-dupont"] },
      ]);

      const fromRegister = await dossiers.get(candidateId, applicationId);
      const fromWeb = await dossiers.get(candidateId, other);

      expect(fromRegister).toMatchObject({ status: "built", provenance: null });
      if (fromRegister?.status !== "built" || fromWeb?.status !== "built") throw new Error("not built");
      expect(dossierSites(fromRegister.dossier)).toEqual([
        { kind: "web", domain: "annuaire-entreprises.data.gouv.fr", links: [REGISTER_PAGE] },
        { kind: "web", domain: "news.example", links: ["https://news.example/a"] },
      ]);
      expect(dossierSites(fromWeb.dossier)).toEqual([{ kind: "web", domain: "globex.example", links: ["https://globex.example/about"] }]);
    });

    describe("Stop", () => {
      /** The web search stops the build when it is asked `what` (the news, or any search). */
      function stoppedBy(stop: AbortController, what: "news" | "any") {
        const search = perplexity.search!;
        perplexity.search = async (query, options) => {
          if (what === "news" && ![query].flat().join("\n").startsWith("Articles de presse")) return search(query, options);
          stop.abort();
          throw stop.signal.reason;
        };
      }

      it("keeps the finished parts when stopped during the news search: the dossier's facts, its news not searched", async () => {
        const stop = new AbortController();
        const applicationId = await applicationFor({ employer: "Acme Industrie" });
        stoppedBy(stop, "news");

        const result = await dossiers.build(candidateId, applicationId, { signal: stop.signal });

        const state = {
          status: "built",
          dossier: { siren: "552100554", news: [], newsSearched: false },
          provenance: { steps: [{ task: "offer_analysis", outcome: "ok" }, { tool: "recherche-entreprises", outcome: "ok" }, { task: "web_search", outcome: "stopped" }] },
        };
        expect(result).toMatchObject({ ok: false, error: "stopped", state });
        expect(await dossiers.get(candidateId, applicationId)).toMatchObject(state);
      });

      it("keeps nothing new when stopped before the dossier's facts were found: the dossier stays as it was", async () => {
        register.companies = [];
        const applicationId = await applicationFor({ employer: "Globex Corp" });
        await dossiers.build(candidateId, applicationId);
        const before = await dossiers.get(candidateId, applicationId);
        const stop = new AbortController();
        stoppedBy(stop, "any");

        const result = await dossiers.build(candidateId, applicationId, { signal: stop.signal });

        expect(result).toEqual({ ok: false, error: "stopped", state: before });
        expect(await dossiers.get(candidateId, applicationId)).toEqual(before);
      });

      it("keeps nothing when stopped while the offer is read", async () => {
        const stop = new AbortController();
        mistral.generate = async () => {
          stop.abort();
          throw stop.signal.reason;
        };
        const applicationId = await applicationFor({ employer: "Acme Industrie" });

        const result = await dossiers.build(candidateId, applicationId, { signal: stop.signal });

        expect(result).toEqual({ ok: false, error: "stopped", state: { status: "not_built" } });
        expect(register.queries).toEqual([]);
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
