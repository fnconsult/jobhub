import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { DEFAULT_JOB_DISCOVERY_SETTINGS, type JobDiscoverySettings, type JobOffer, type SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { LaBonneBoite, LaBonneBoiteCompany, LaBonneBoiteSearch } from "../france-travail/la-bonne-boite";
import { createJobDiscovery, type JobDiscoveryBudget, type JobOfferStore } from "../index";
import { createTargetCompanies } from "./index";
import { memoryTargetCompanies, type MemoryTargetCompanyStore } from "./testing";

const NOW = new Date("2026-10-26T08:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const criteria: SearchCriteria = { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

const ACME: LaBonneBoiteCompany = { siret: "55210055400013", name: "ACME INDUSTRIE", hiringScore: 90, city: "Lyon" };
const BETA: LaBonneBoiteCompany = { siret: "38012986600025", name: "BETA LOGISTIQUE", hiringScore: 70, city: "Vénissieux" };

const greenhouseJob = (id: number, title: string, company: string, daysAgo = 3) => ({
  id,
  title,
  absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  company_name: company,
  location: { name: "Lyon" },
  first_published: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  content: `&lt;p&gt;${title} chez ${company}, à Lyon.&lt;/p&gt;`,
});

const json = (data: unknown) => ({ body: JSON.stringify(data), headers: { "content-type": "application/json" } });

/** A pretend Internet answering `pages` by URL, robots.txt allowing everything, and the URLs asked. */
function fakeWeb(pages: Record<string, { body: string; headers?: Record<string, string> }>) {
  const fetched: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    const page = pages[url];
    return page ? new Response(page.body, { headers: page.headers ?? { "content-type": "text/html" } }) : new Response("introuvable", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, fetched };
}

/** Job Offers kept in memory, deduplicated by source URL. */
function memoryJobOffers(): JobOfferStore & { all: JobOffer[] } {
  const all: JobOffer[] = [];
  return {
    all,
    async findBySourceUrl(url) {
      return all.find((offer) => offer.source.url === url) ?? null;
    },
    async capture(input, _by, trusted) {
      const same = all.find((offer) => offer.source.url === input.source.url);
      if (same) return { ok: true, jobOffer: same };
      const { provenance, ...facts } = trusted ?? {};
      void provenance;
      const jobOffer = { id: `offer-${all.length + 1}`, ...(input as Omit<JobOffer, "id">), ...facts };
      all.push(jobOffer);
      return { ok: true, jobOffer };
    },
  };
}

const lbb = (answer: LaBonneBoiteSearch): LaBonneBoite & { asked: number } => {
  const fake = {
    asked: 0,
    async search() {
      fake.asked++;
      return answer;
    },
  };
  return fake;
};

function setup(options: {
  /** What the web search finds for a query (by its text). */
  sources?: (query: string) => string[];
  pages?: Record<string, { body: string; headers?: Record<string, string> }>;
  laBonneBoite?: LaBonneBoite | null;
  store?: MemoryTargetCompanyStore;
  settings?: JobDiscoverySettings;
  budget?: Partial<JobDiscoveryBudget>;
  max?: number;
}) {
  const search = createFakeProvider({ id: "perplexity", residency: "outside_eu", sources: (query) => options.sources?.(query) ?? [] });
  const llm = createFakeProvider({ id: "anthropic", reply: '{"isJobOffer": false}' });
  const titles = createFakeProvider({ id: "mistral", reply: "{}" });
  const ai = createAiLayer({ providers: [search, llm, titles], routes: { web_search: "perplexity", offer_analysis: "anthropic", job_titles: "mistral" }, usage: createMemoryUsageLog() });
  const web = fakeWeb(options.pages ?? {});
  let time = NOW.getTime();
  const clock = { now: () => time, sleep: async (ms: number) => void (time += ms) };
  const store = options.store ?? memoryTargetCompanies();
  const laBonneBoite = options.laBonneBoite === undefined ? lbb({ ok: true, companies: [ACME, BETA], calls: 2 }) : options.laBonneBoite;
  const targets = createTargetCompanies({
    store,
    franceTravail: () => (laBonneBoite ? { laBonneBoite, romeo: null } : null),
    cityCodes: { cityCode: async () => "69123" },
    settings: () => ({ max: options.max ?? 5, revisitDays: 7 }),
  });
  const jobOffers = memoryJobOffers();
  const discovery = createJobDiscovery({
    ai,
    jobOffers,
    fetch: web.fetch,
    clock,
    budget: options.budget,
    targetCompanies: targets,
    ...(options.settings ? { settings: async () => options.settings! } : {}),
  });
  return { discovery, search, web, store, jobOffers };
}

const ACME_BOARD_API = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";

describe("Job discovery visits the Profile's Target Companies (#406)", () => {
  it("after the plan's queries and before the Job discovery sites, one web search « title + company » for each without a careers site", async () => {
    const { discovery, search } = setup({
      settings: { ...DEFAULT_JOB_DISCOVERY_SETTINGS, sites: [{ domain: "apec.fr", enabled: true }] } as JobDiscoverySettings,
    });

    const report = await discovery.discover({ candidateId: "candidate-1", profileId: "profile-1", criteria });

    expect(search.queries).toEqual([
      "Offre d'emploi « Directeur financier » à Lyon, CDI",
      'Job offer "Directeur financier" in Lyon, permanent contract',
      'Directeur financier "ACME INDUSTRIE"',
      'Directeur financier "BETA LOGISTIQUE"',
      "Offre d'emploi « Directeur financier » à Lyon, CDI",
    ]);
    expect(report.targetCompanies).toEqual({ laBonneBoite: "searched", calls: 2, visited: 2, offers: 0 });
  });

  it("finds a company's ATS board through that search, captures its posting, and keeps the board for every Profile", async () => {
    const store = memoryTargetCompanies();
    const posting = "https://job-boards.greenhouse.io/acme/jobs/1001";
    const { discovery, jobOffers, search, web } = setup({
      store,
      sources: (query) => (query.includes("ACME") ? [posting] : []),
      pages: { "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1001": json(greenhouseJob(1001, "Directeur administratif et financier (H/F)", "Acme Industrie")) },
    });

    const report = await discovery.discover({ candidateId: "candidate-1", profileId: "profile-1", criteria });

    expect(jobOffers.all.map((offer) => ({ url: offer.source.url, title: offer.title, employer: offer.employer }))).toEqual([
      { url: posting, title: "Directeur administratif et financier (H/F)", employer: "Acme Industrie" },
    ]);
    expect(report.targetCompanies.offers).toBe(1);
    expect(store.sites).toEqual(new Map([["siren:552100554", "https://job-boards.greenhouse.io/acme"]]));
    expect(web.fetched).not.toContain(posting);
    expect(search.queries.filter((query) => query.includes("ACME"))).toHaveLength(1);
  });

  it("reuses a careers site found for another Profile: its board is read, with no web search, and only postings for the job are captured", async () => {
    const store = memoryTargetCompanies();
    await store.keepCareersSite("siren:552100554", "https://job-boards.greenhouse.io/acme", NOW);
    const { discovery, jobOffers, search, web } = setup({
      store,
      pages: {
        [ACME_BOARD_API]: json({
          jobs: [
            greenhouseJob(2001, "Directrice financière Groupe", "Acme Industrie"),
            greenhouseJob(2002, "Commercial terrain", "Acme Industrie"),
            greenhouseJob(2003, "Directeur financier adjoint", "Acme Industrie", 45),
          ],
        }),
      },
    });

    const report = await discovery.discover({ candidateId: "candidate-2", profileId: "profile-2", criteria });

    expect(search.queries.some((query) => query.includes("ACME"))).toBe(false);
    expect(search.queries.filter((query) => query.includes("BETA"))).toHaveLength(1);
    expect(web.fetched).toContain(ACME_BOARD_API);
    expect(jobOffers.all.map((offer) => offer.source.url)).toEqual(["https://job-boards.greenhouse.io/acme/jobs/2001"]);
    expect(report.targetCompanies).toMatchObject({ visited: 2, offers: 1 });
  });

  it("records the visits, so the next run within the delay visits the others", async () => {
    const store = memoryTargetCompanies();
    const { discovery, search } = setup({ store, max: 1 });

    await discovery.discover({ candidateId: "candidate-1", profileId: "profile-1", criteria });
    await discovery.discover({ candidateId: "candidate-1", profileId: "profile-1", criteria });

    expect(search.queries.filter((query) => query.endsWith('"ACME INDUSTRIE"') || query.endsWith('"BETA LOGISTIQUE"'))).toEqual(['Directeur financier "ACME INDUSTRIE"', 'Directeur financier "BETA LOGISTIQUE"']);
  });

  it("goes on when La Bonne Boite is refused, like an unavailable source, and says so", async () => {
    const { discovery } = setup({ laBonneBoite: lbb({ ok: false, reason: "refused", detail: "token refused", calls: 1 }) });

    const report = await discovery.discover({ candidateId: "candidate-1", profileId: "profile-1", criteria });

    expect(report.targetCompanies).toEqual({ laBonneBoite: "refused", calls: 1, visited: 0, offers: 0 });
  });

  it("stays within the Job discovery budget", async () => {
    const { discovery, search } = setup({ budget: { seconds: 0 } });

    await discovery.discover({ candidateId: "candidate-1", profileId: "profile-1", criteria });

    expect(search.queries.some((query) => query.includes("ACME"))).toBe(false);
  });

  it("visits none without a Profile to visit them for", async () => {
    const laBonneBoite = lbb({ ok: true, companies: [ACME], calls: 2 });
    const { discovery } = setup({ laBonneBoite });

    const report = await discovery.discover({ candidateId: "candidate-1", criteria });

    expect(laBonneBoite.asked).toBe(0);
    expect(report.targetCompanies).toEqual({ laBonneBoite: "off", calls: 0, visited: 0, offers: 0 });
  });
});
