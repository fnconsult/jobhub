import { AiProviderError, createAiLayer } from "@jobhub/ai";
import type { SearchOptions, ToolCall } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider, type MemoryUsageLog } from "@jobhub/ai/testing";
import { DEFAULT_JOB_DISCOVERY_SETTINGS, type IndustryReference, type Provenance, type ProvenanceEvent, type JobDiscoverySettings, type JobOffer, type SearchCriteria } from "@jobhub/shared";
import type { TaskPlaybookReader } from "@jobhub/web/task-playbooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FantasticJobs, FantasticJobsSearch } from "./fantastic-jobs";
import type { FranceTravail, FranceTravailSearch } from "./france-travail";
import { createJobDiscovery, JobDiscoveryError, type JobDiscoveryBudget, type JobOfferStore, type WebSearchSettings } from "./index";

/** Serves, for each id given, that text as version 2 with no Playbook Agent, searching where it says (none: the configured route); nothing for any other id. */
const servedTasks =
  (served: Record<string, { content: string; search?: { provider: "brave"; model: string | null } }>): TaskPlaybookReader =>
  async (id) =>
    served[id] ? { id, version: 2, content: served[id]!.content, agent: null, search: served[id]!.search ?? null } : null;

const criteria: SearchCriteria = {
  targetRole: "Directeur financier",
  locations: ["Lyon"],
  contractTypes: ["cdi"],
  remoteWorkOptions: ["hybrid"], sectors: [], subsectors: [], domains: [],
  minSalary: 110_000,
};

interface Page {
  /** How long the site takes to answer. */
  delayMs?: number;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

/** Time that passes only when the crawler waits, from `start`. */
function fakeClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}
type FakeClock = ReturnType<typeof fakeClock>;

/** A pretend Internet: every URL the crawler may request, and the requests it made. */
function fakeWeb(pages: Record<string, Page>, clock: FakeClock) {
  const requests: { url: string; userAgent: string | null; at: number }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, userAgent: new Headers(init?.headers).get("user-agent"), at: clock.now() });
    const page = pages[url];
    if (!page) return new Response("introuvable", { status: 404 });
    if (page.delayMs) await clock.sleep(page.delayMs);
    return new Response(page.body ?? "", {
      status: page.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...page.headers },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests, fetched: () => requests.map((r) => r.url) };
}

/** Job Offers kept in memory, deduplicated by source URL like the real store. */
function memoryJobOffers(existing: JobOffer[] = []): JobOfferStore & { all: JobOffer[]; captures: { input: object; trusted?: { provenance?: Provenance } }[] } {
  const all = [...existing];
  const captures: { input: object; trusted?: { provenance?: Provenance } }[] = [];
  return {
    all,
    captures,
    async findBySourceUrl(url) {
      return all.find((offer) => offer.source.url === url) ?? null;
    },
    async capture(input, _capturedBy, trusted) {
      captures.push({ input, trusted });
      // Like the real store, a Job Offer does not carry its Provenance: it is read apart.
      const facts = { ...trusted };
      delete facts.provenance;
      const offer = { ...(input as Omit<JobOffer, "id">), ...facts };
      const same = all.find((o) => o.source.url === offer.source.url || o.content === offer.content);
      if (same) return { ok: true, jobOffer: same, created: false };
      const jobOffer = { id: `offer-${all.length + 1}`, ...offer };
      all.push(jobOffer);
      return { ok: true, jobOffer, created: true };
    },
  };
}

function setup(options: {
  sources: string[] | ((query: string, options: SearchOptions) => string[]);
  /** The dates the search provider states for some sources. */
  sourceDates?: Record<string, Date>;
  /** The job title step's reply. Default: no variants. */
  titles?: string;
  /** How many pages of results the search provider gives a query. Default: 1. */
  searchPages?: number;
  /** How many queries one call of the search provider takes. Default: 1. */
  queriesPerCall?: number;
  /** The search provider's answer text. */
  answer?: string;
  pages: Record<string, Page>;
  reply?: string | (() => string);
  existing?: JobOffer[];
  budget?: Partial<JobDiscoveryBudget> | (() => Partial<JobDiscoveryBudget>);
  /** Tokens each LLM read uses. */
  llmUsage?: { inputTokens: number; outputTokens: number };
  /** When the run starts. Default: the epoch. */
  now?: Date;
  /** France Travail, when configured. */
  franceTravail?: FranceTravail;
  /** Fantastic.jobs, when its key is set. */
  fantasticJobs?: FantasticJobs;
  /** The Back Office's Job discovery sources and sites. */
  settings?: () => Promise<JobDiscoverySettings>;
  /** The task Playbooks served (ADR-0026). Default: none read, so no Job Offer Summary, and the built-in query wording. */
  taskPlaybooks?: TaskPlaybookReader;
  /** Another web-search provider configured, which a task Playbook may name. */
  otherSearch?: FakeProvider;
  /** Thrown by every search of the active Search provider. */
  searchFails?: Error;
  /** The fallback Search provider (ADR-0043). Default: none. */
  searchFallback?: "brave";
  /** The NAF and ROME-domain labels (#236). */
  industries?: () => Promise<IndustryReference>;
  /** Each web search waits for its signal to abort (#331). */
  searchPending?: boolean;
  /** The web search's settings (#402). Default: the code's. */
  search?: Partial<WebSearchSettings> | (() => Partial<WebSearchSettings>);
  /** The active Search provider's key is missing: web search is unavailable (#399). */
  searchKeyMissing?: boolean;
  /** The billed units each search call says it used (#403). Default: not said, one `web_search`. */
  searchTools?: ToolCall[];
}) {
  const search = createFakeProvider({ id: "perplexity", residency: "outside_eu", sources: options.sources, sourceDates: options.sourceDates, answer: options.answer, pages: options.searchPages, queriesPerCall: options.queriesPerCall, pending: options.searchPending, fail: options.searchFails, ...(options.searchTools ? { tools: options.searchTools } : {}) });
  const llm: FakeProvider = createFakeProvider({ id: "anthropic", reply: options.reply ?? '{"isJobOffer": false}', usage: options.llmUsage });
  const titles = createFakeProvider({ id: "mistral", reply: options.titles ?? "{}" });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({
    providers: [...(options.searchKeyMissing ? [] : [search]), llm, titles, ...(options.otherSearch ? [options.otherSearch] : [])],
    routes: { web_search: "perplexity", offer_analysis: "anthropic", job_titles: "mistral" },
    ...(options.searchFallback ? { searchFallback: options.searchFallback } : {}),
    usage,
  });
  const clock = fakeClock(options.now?.getTime());
  const web = fakeWeb(options.pages, clock);
  const jobOffers = memoryJobOffers(options.existing);
  const discovery = createJobDiscovery({ ai, jobOffers, fetch: web.fetch, clock, budget: options.budget, franceTravail: options.franceTravail, fantasticJobs: options.fantasticJobs, settings: options.settings, taskPlaybooks: options.taskPlaybooks, industries: options.industries, search: options.search });
  return { discovery, search, llm, titles, web, jobOffers, usage };
}

/** What AI Usage recorded, in €: each call's tokens and its tools' known fees (#403). */
const recordedEur = (usage: MemoryUsageLog) =>
  usage.entries.reduce((sum, entry) => sum + entry.costEur + entry.tools.reduce((fees, tool) => fees + (tool.costEur ?? 0), 0), 0);

const jobPostingPage = (posting: object) =>
  `<html><head><title>Offre</title><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    ...posting,
  })}</script></head><body><h1>Offre</h1></body></html>`;

const DAF_URL = "https://emplois.example.fr/offres/daf-lyon";

describe("Job discovery", () => {
  it("searches with the Search Criteria and captures the JobPosting each result page describes", async () => {
    const { discovery, search, jobOffers } = setup({
      sources: [DAF_URL],
      pages: {
        "https://emplois.example.fr/robots.txt": { body: "User-agent: *\nDisallow: /admin\n", headers: { "content-type": "text/plain" } },
        [DAF_URL]: {
          body: jobPostingPage({
            title: "Directeur administratif et financier H/F",
            description: "<p>Rattaché au DG, vous pilotez la finance.</p><ul><li>15 ans d&#39;expérience</li></ul>",
            hiringOrganization: { "@type": "Organization", name: "Groupe Seb" },
            jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Écully", postalCode: "69130" } },
            employmentType: "CDI",
            baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 110000, maxValue: 130000, unitText: "YEAR" } },
            skills: ["IFRS", "Consolidation"],
            experienceRequirements: { "@type": "OccupationalExperienceRequirements", monthsOfExperience: 180 },
          }),
        },
      },
    });

    const report = await discovery.discover({ candidateId: "candidate-1", criteria });

    // No title variants here: the Search Criteria title, in French then in English.
    expect(search.queries).toEqual([
      "Offre d'emploi « Directeur financier » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel",
      'Job offer "Directeur financier" in Lyon, permanent contract, hybrid remote work, salary from €110,000 gross per year',
    ]);
    expect(report.jobOffers).toEqual([
      {
        id: "offer-1",
        source: { url: DAF_URL },
        title: "Directeur administratif et financier H/F",
        content: "Rattaché au DG, vous pilotez la finance.\n\n15 ans d'expérience",
        employer: "Groupe Seb",
        location: "Écully (69130)",
        contractType: "cdi",
        salary: { min: 110_000, max: 130_000 },
        skills: ["IFRS", "Consolidation"],
        requiredExperienceYears: 15,
      },
    ]);
    expect(jobOffers.all).toHaveLength(1);
  });

  it("sends the web-search provider nothing but the Search Criteria, whatever the Candidate typed in them", async () => {
    const { discovery, search, titles } = setup({ sources: [], pages: {} });

    await discovery.discover({
      candidateId: "candidate-1",
      criteria: { targetRole: "DAF jean.dupont@mail.fr 06 12 34 56 78", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
    });

    expect(titles.calls.map((call) => call.messages)).toEqual([[{ role: "user", content: "DAF" }]]);
    expect(search.queries).toEqual(["Offre d'emploi « DAF » à Lyon", 'Job offer "DAF" in Lyon']);
  });

  describe("Sectors (#236)", () => {
    const industries = async (): Promise<IndustryReference> => ({
      sectors: [{ code: "K", label: { fr: "Activités financières et d'assurance", en: "Financial and insurance activities" } }],
      subsectors: [],
      domains: [],
    });
    const inFinance: SearchCriteria = { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: ["K"], subsectors: [], domains: [] };

    it("names the Sectors wanted by their labels, read at the start of the run, in each web search", async () => {
      const { discovery, search } = setup({ sources: [], pages: {}, industries });

      await discovery.discover({ candidateId: "candidate-1", criteria: inFinance });

      expect(search.queries).toEqual([
        "Offre d'emploi « Directeur financier » à Lyon, secteur Activités financières et d'assurance",
        'Job offer "Directeur financier" in Lyon, Financial and insurance activities sector',
      ]);
    });

    it("searches without naming them when their labels cannot be read", async () => {
      const { discovery, search } = setup({ sources: [], pages: {}, industries: () => Promise.reject(new Error("no database")) });

      await discovery.discover({ candidateId: "candidate-1", criteria: inFinance });

      expect(search.queries).toEqual(["Offre d'emploi « Directeur financier » à Lyon", 'Job offer "Directeur financier" in Lyon']);
    });
  });

  describe("searching with job title variants in French and English, page after page (#112)", () => {
    const posting = (title: string) => ({ body: jobPostingPage({ title, description: `Poste de ${title} à Lyon.` }) });
    const titles = JSON.stringify({ fr: ["DAF"], en: ["Chief Financial Officer"] });

    it("sends each planned query, given the Search Criteria title alone, and steers it to recent postings outside forbidden sites", async () => {
      const { discovery, search, titles: titleStep } = setup({ sources: [], pages: {}, titles });

      await discovery.discover({ candidateId: "candidate-1", criteria });

      expect(titleStep.calls.map((call) => call.messages)).toEqual([[{ role: "user", content: "Directeur financier" }]]);
      expect(search.queries).toEqual([
        "Offre d'emploi « Directeur financier » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel",
        'Job offer "Chief Financial Officer" in Lyon, permanent contract, hybrid remote work, salary from €110,000 gross per year',
        "Offre d'emploi « DAF » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel",
      ]);
      expect(search.searches.map((s) => s.filters)).toEqual(
        Array(3).fill({ excludeDomains: ["linkedin.com", "indeed.com", "indeed.fr", "glassdoor.com", "glassdoor.fr"], maxAgeDays: 30, country: "FR", maxResults: 20 }),
      );
    });

    it("searches as the web search's settings say, read at the start of each run: country, age, results, job titles and languages (#402)", async () => {
      let settings: Partial<WebSearchSettings> = { country: "BE", maxPostingAgeDays: 14, resultsPerQuery: 8, titlesPerLanguage: 1, queryLanguages: ["fr"] };
      const { discovery, search } = setup({ sources: [], pages: {}, titles, search: () => settings });

      await discovery.discover({ candidateId: "candidate-1", criteria });

      expect(search.queries).toEqual(["Offre d'emploi « Directeur financier » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel"]);
      expect(search.searches.map((s) => s.filters)).toEqual([
        { excludeDomains: ["linkedin.com", "indeed.com", "indeed.fr", "glassdoor.com", "glassdoor.fr"], maxAgeDays: 14, country: "BE", maxResults: 8 },
      ]);

      // Changed between two runs: the next one follows.
      settings = { resultsPerQuery: 5, queryLanguages: ["en"], titlesPerLanguage: 1 };
      await discovery.discover({ candidateId: "candidate-1", criteria });
      expect(search.searches.at(-1)!.filters).toMatchObject({ maxResults: 5, country: "FR", maxAgeDays: 30 });
      expect(search.queries.at(-1)).toMatch(/^Job offer "Chief Financial Officer"/);
    });

    it("searches a query's next page only while its last page gave a new readable posting", async () => {
      const results: Record<string, string[]> = {
        "fr 1": ["https://emplois.example.fr/offres/1"],
        "fr 2": ["https://emplois.example.fr/offres/2", "https://emplois.example.fr/offres/1"],
        "fr 3": ["https://emplois.example.fr/offres/1", "https://emplois.example.fr/offres/listes"],
        "en 1": ["https://emplois.example.fr/offres/2"],
      };
      const { discovery, search, jobOffers } = setup({
        searchPages: 5,
        sources: (query, { page }) => results[`${query.startsWith("Job offer") ? "en" : "fr"} ${page ?? 1}`] ?? [],
        pages: {
          "https://emplois.example.fr/offres/1": posting("DAF 1"),
          "https://emplois.example.fr/offres/2": posting("DAF 2"),
          "https://emplois.example.fr/offres/listes": { body: "<html><body><h1>12 offres DAF</h1></body></html>" },
        },
        titles: JSON.stringify({ en: ["CFO"] }),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      // fr p1: offer 1, new. en p1: offer 2, new. fr p2: offer 2 again (found by en p1), offer 1 again: nothing new, fr stops.
      // en p2: nothing. Neither query gets a third page.
      expect(search.searches.map((s) => `${s.query.startsWith("Job offer") ? "en" : "fr"} ${s.page ?? 1}`)).toEqual(["fr 1", "en 1", "fr 2", "en 2"]);
      expect(jobOffers.all.map((offer) => offer.title)).toEqual(["DAF 1", "DAF 2"]);
      expect(report.funnel).toMatchObject({ providerUrls: 2, fetched: 2, extracted: 2 });
    });

    it("batches the plan's queries per call as the Search provider takes them, and searches each site apart", async () => {
      const { discovery, search } = setup({
        queriesPerCall: 5,
        sources: [],
        pages: {},
        titles: JSON.stringify({ fr: ["DAF", "Directeur administratif"], en: ["CFO", "Finance Director", "Head of Finance"] }),
        settings: async () => ({ sources: { france_travail: true, fantastic_jobs: true, web_search: true, ats_apis: true }, sites: [{ domain: "apec.fr", enabled: true }] }),
      });

      await discovery.discover({ candidateId: "c", criteria });

      // 6 queries (3 titles in French and English): 5 in one call, then the last; the site's search on its own.
      expect(search.searches.map((s) => [s.queries.length, s.filters?.includeDomains])).toEqual([
        [5, undefined],
        [1, undefined],
        [1, ["apec.fr"]],
      ]);
    });

    it("searches no further once the run has its Job Offers", async () => {
      const { discovery, search } = setup({
        searchPages: 5,
        sources: (_query, { page }) => [`https://emplois.example.fr/offres/${page ?? 1}`],
        pages: { "https://emplois.example.fr/offres/1": posting("DAF 1"), "https://emplois.example.fr/offres/2": posting("DAF 2") },
        titles,
        budget: { jobOffers: 1 },
      });

      await discovery.discover({ candidateId: "c", criteria });

      expect(search.queries).toHaveLength(1);
    });
  });

  describe("reading pages politely (ADR-0002)", () => {
    const ROBOTS = "https://emplois.example.fr/robots.txt";
    const posting = jobPostingPage({ title: "DAF", description: "Poste de DAF à Lyon." });

    it("introduces itself and does not request a page its robots.txt disallows", async () => {
      const { discovery, web } = setup({
        sources: [DAF_URL],
        pages: { [ROBOTS]: { body: "User-agent: JobbboxBot\nDisallow: /offres/\n" }, [DAF_URL]: { body: posting } },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report).toMatchObject({ jobOffers: [], skipped: [{ url: DAF_URL, reason: "robots" }] });
      expect(web.fetched()).toEqual([ROBOTS]);
      expect(web.requests[0]!.userAgent).toMatch(/^JobbboxBot\//);
    });

    it("reads robots.txt once per site", async () => {
      const second = "https://emplois.example.fr/offres/daf-paris";
      const { discovery, web } = setup({
        sources: [DAF_URL, second],
        pages: { [ROBOTS]: { body: "" }, [DAF_URL]: { body: posting }, [second]: { body: jobPostingPage({ title: "DAF", description: "Poste à Paris." }) } },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toHaveLength(2);
      expect(web.fetched()).toEqual([ROBOTS, DAF_URL, second]);
    });

    it("waits the Crawl-delay robots.txt asks for between two requests to a site, and skips a site asking too much", async () => {
      const second = "https://emplois.example.fr/offres/daf-paris";
      const slow = "https://lent.example.fr/offre/1";
      const { discovery, web } = setup({
        sources: [DAF_URL, second, slow],
        pages: {
          [ROBOTS]: { body: "User-agent: *\nCrawl-delay: 2\n" },
          [DAF_URL]: { body: posting },
          [second]: { body: jobPostingPage({ title: "DAF", description: "Poste à Paris." }) },
          "https://lent.example.fr/robots.txt": { body: "User-agent: *\nCrawl-delay: 3600\n" },
          [slow]: { body: posting },
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      const site = web.requests.filter((request) => request.url.startsWith("https://emplois.example.fr/"));
      expect(site.map((request) => request.url)).toEqual([ROBOTS, DAF_URL, second]);
      expect(site[1]!.at - site[0]!.at).toBeGreaterThanOrEqual(2000);
      expect(site[2]!.at - site[1]!.at).toBeGreaterThanOrEqual(2000);
      expect(report.skipped).toEqual([{ url: slow, reason: "robots" }]);
      expect(web.fetched()).not.toContain(slow);
    });

    it("reads a site without robots.txt, but stays out of one whose robots.txt fails", async () => {
      const down = "https://panne.example.fr/offre/1";
      const { discovery, web } = setup({
        sources: [DAF_URL, down],
        pages: { [DAF_URL]: { body: posting }, "https://panne.example.fr/robots.txt": { status: 503 }, [down]: { body: posting } },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((o) => o.source.url)).toEqual([DAF_URL]);
      expect(report.skipped).toEqual([{ url: down, reason: "robots" }]);
      expect(web.fetched()).not.toContain(down);
    });

    it("skips a page whose robots meta tag says noindex", async () => {
      const { discovery } = setup({
        sources: [DAF_URL],
        pages: { [DAF_URL]: { body: posting.replace("<head>", '<head><meta name="robots" content="noindex, nofollow">') } },
      });

      expect((await discovery.discover({ candidateId: "c", criteria })).skipped).toEqual([{ url: DAF_URL, reason: "robots" }]);
    });

    it("never requests sites whose terms forbid crawling, such as LinkedIn and Indeed", async () => {
      const linkedin = "https://fr.linkedin.com/jobs/view/123";
      const indeed = "https://www.indeed.fr/viewjob?jk=abc";
      const { discovery, web } = setup({ sources: [linkedin, indeed], pages: {} });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped).toEqual([
        { url: linkedin, reason: "site_terms" },
        { url: indeed, reason: "site_terms" },
      ]);
      expect(web.fetched()).toEqual([]);
    });

    it("gives up on a Cloudflare challenge or a CAPTCHA, and never retries it", async () => {
      const cloudflare = "https://cf.example.fr/offre/1";
      const captcha = "https://captcha.example.fr/offre/2";
      const { discovery, web, llm } = setup({
        sources: [cloudflare, captcha],
        pages: {
          [cloudflare]: { status: 403, headers: { "cf-mitigated": "challenge", server: "cloudflare" }, body: "<title>Just a moment...</title>" },
          [captcha]: { body: '<html><body><div class="g-recaptcha" data-sitekey="x"></div></body></html>' },
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped).toEqual([
        { url: cloudflare, reason: "bot_protection" },
        { url: captcha, reason: "bot_protection" },
      ]);
      expect(web.fetched().filter((url) => url === cloudflare || url === captcha)).toEqual([cloudflare, captcha]);
      expect(llm.calls).toEqual([]);
    });

    it("reads a job page that only mentions a CAPTCHA for its apply form, like every Lever page", async () => {
      const lever = "https://jobs.lever.co/acme/2193db3f";
      const page = jobPostingPage({ title: "Directeur financier", description: "<p>Vous pilotez la finance du groupe.</p>" })
        .replace(
          "<head>",
          "<head><style>.g-recaptcha div,.h-captcha-spacing {display: block;} .application-form .h-captcha {margin: 0}</style>",
        )
        .replace(
          "</body>",
          '<form class="application-form"><div class="h-captcha" data-sitekey="x"></div></form>' +
            '<script src="https://js.hcaptcha.com/1/api.js" async></script>' +
            // Cloudflare's passive bot-management script, on every page it proxies.
            '<script>(function(){var a=document.createElement("script");a.src="/cdn-cgi/challenge-platform/scripts/jsd/main.js";})();</script></body>',
        );
      const { discovery, jobOffers } = setup({ sources: [lever], pages: { [lever]: { body: page } } });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped).toEqual([]);
      expect(jobOffers.all.map((offer) => offer.title)).toEqual(["Directeur financier"]);
    });

    it("stops at a login wall: a redirect to a sign-in page, a 401 or a password form", async () => {
      const redirected = "https://a.example.fr/offre/1";
      const unauthorised = "https://b.example.fr/offre/2";
      const form = "https://c.example.fr/offre/3";
      const { discovery, web } = setup({
        sources: [redirected, unauthorised, form],
        pages: {
          [redirected]: { status: 302, headers: { location: "/connexion?next=/offre/1" } },
          [unauthorised]: { status: 401 },
          [form]: { body: '<form><input name="email"><input type="password" name="pw"></form>' },
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped.map((s) => s.reason)).toEqual(["login_wall", "login_wall", "login_wall"]);
      expect(web.fetched()).not.toContain("https://a.example.fr/connexion?next=/offre/1");
    });

    it("follows a redirect only where robots.txt allows it", async () => {
      const moved = "https://ancien.example.fr/offre/1";
      const target = "https://nouveau.example.fr/offre/1";
      const { discovery, web } = setup({
        sources: [moved],
        pages: {
          [moved]: { status: 301, headers: { location: target } },
          "https://nouveau.example.fr/robots.txt": { body: "User-agent: *\nDisallow: /\n" },
          [target]: { body: posting },
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped).toEqual([{ url: moved, reason: "robots" }]);
      expect(web.fetched()).not.toContain(target);
    });

    it("never reaches private network addresses", async () => {
      const sources = ["http://127.0.0.1/admin", "http://localhost:8080/", "http://192.168.1.1/offre", "http://[::1]/", "ftp://example.fr/offre"];
      const { discovery, web } = setup({ sources, pages: {} });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped.map((s) => s.reason)).toEqual(["not_public", "not_public", "not_public", "not_public", "not_public"]);
      expect(web.fetched()).toEqual([]);
    });
  });

  describe("reading the posting", () => {
    it("asks the LLM to read a page without JobPosting data, and captures what it states", async () => {
      const { discovery, llm } = setup({
        sources: [DAF_URL],
        pages: {
          [DAF_URL]: {
            body: "<html><head><script>track()</script></head><body><nav>Accueil</nav><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF.</p></body></html>",
          },
        },
        reply:
          'Voici :\n```json\n{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF.", "employer": "Groupe Seb", "contractType": "cdi", "remoteWork": "sometimes", "salaryMin": 110000, "skills": ["IFRS", ""]}\n```',
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0]!.messages[0]!.content).toBe("<page>\nAccueil\n\nDAF H/F\n\nGroupe Seb recrute son DAF.\n</page>");
      expect(report.jobOffers).toEqual([
        {
          id: "offer-1",
          source: { url: DAF_URL },
          title: "DAF H/F",
          content: "Groupe Seb recrute son DAF.",
          employer: "Groupe Seb",
          contractType: "cdi",
          salary: { min: 110_000 },
          skills: ["IFRS"],
        },
      ]);
    });

    it("hands the store the Job Offer Summary the LLM wrote as a trusted fact, never as the posting's own input", async () => {
      const { discovery, jobOffers, llm } = setup({
        sources: [DAF_URL],
        pages: { [DAF_URL]: { body: "<html><body><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF.</p></body></html>" } },
        reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF.", "summary": "Groupe Seb recrute son DAF à Lyon."}',
        taskPlaybooks: servedTasks({ "job-offer-reading": { content: '- "summary" : deux phrases.' } }),
      });

      await discovery.discover({ candidateId: "c", criteria });

      expect(jobOffers.captures).toHaveLength(1);
      expect(jobOffers.captures[0]!.input).not.toHaveProperty("summary");
      expect(jobOffers.captures[0]!.trusted).toEqual({ summary: "Groupe Seb recrute son DAF à Lyon.", provenance: expect.any(Object) });
      expect(llm.calls[0]!.system).toMatch(/- "summary" : deux phrases\.$/);
    });

    it("writes no Job Offer Summary or sector while the job-offer-reading task Playbook is not served (ADR-0026)", async () => {
      const { discovery, jobOffers, llm } = setup({
        sources: [DAF_URL],
        pages: { [DAF_URL]: { body: "<html><body><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF.</p></body></html>" } },
        reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF.", "summary": "Groupe Seb recrute son DAF à Lyon.", "sector": "Industrie"}',
        taskPlaybooks: servedTasks({}),
      });

      await discovery.discover({ candidateId: "c", criteria });

      expect(jobOffers.captures[0]!.trusted).toEqual({ provenance: expect.any(Object) });
      expect(llm.calls[0]!.system).not.toMatch(/summary|sector/);
    });

    it("words its queries and asks for job titles as the served job-search-queries task Playbook says (ADR-0026)", async () => {
      const { discovery, search, titles } = setup({
        sources: [],
        pages: {},
        taskPlaybooks: servedTasks({
          "job-search-queries": { content: "## intitulés\n\nDonne des synonymes.\n\n## requête fr\n\nPoste « {{intitulé}} » vers {{lieu}}\n\n## requête en\n\n{{intitulé}} job in {{lieu}}" },
        }),
      });

      await discovery.discover({ candidateId: "c", criteria });

      expect(titles.calls[0]!.system).toMatch(/^Donne des synonymes\. Réponds uniquement par un objet JSON/);
      expect(search.queries[0]).toMatch(/^Poste « Directeur financier » vers Lyon, CDI/);
      expect(search.queries[1]).toMatch(/^Directeur financier job in Lyon, permanent contract/);
    });

    it("searches on the web-search provider the job-search-queries task Playbook names (ADR-0026)", async () => {
      const brave = createFakeProvider({ id: "brave", residency: "outside_eu" });
      const { discovery, search } = setup({
        sources: [],
        pages: {},
        otherSearch: brave,
        taskPlaybooks: servedTasks({
          "job-search-queries": {
            content: "## intitulés\n\nDonne des synonymes.\n\n## requête fr\n\nPoste « {{intitulé}} » vers {{lieu}}\n\n## requête en\n\n{{intitulé}} job in {{lieu}}",
            search: { provider: "brave", model: null },
          },
        }),
      });

      await discovery.discover({ candidateId: "c", criteria });

      expect(search.queries).toEqual([]);
      expect(brave.queries[0]).toMatch(/^Poste « Directeur financier » vers Lyon/);
    });

    it("goes on with the fallback Search provider once the active one fails, for the rest of the run, and says so (ADR-0043)", async () => {
      const brave = createFakeProvider({ id: "brave", residency: "outside_eu", sources: [DAF_URL] });
      const { discovery, search } = setup({
        sources: [],
        pages: { [DAF_URL]: { body: jobPostingPage({ title: "DAF", description: "Poste de DAF à Lyon." }) } },
        otherSearch: brave,
        searchFallback: "brave",
        searchFails: new AiProviderError("perplexity", "HTTP 429 rate limited", 429),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      // French then English: the first fails on Perplexity and is served by Brave, as is the second.
      expect(search.searches).toHaveLength(1);
      expect(brave.searches).toHaveLength(2);
      expect(report.searchFallback).toEqual({ from: "perplexity", to: "brave", reason: "rate_limited" });
      expect(report.jobOffers.map((offer) => offer.title)).toEqual(["DAF"]);
    });

    it("fails as before when the active Search provider fails and the fallback's key is missing", async () => {
      const { discovery } = setup({ sources: [], pages: {}, searchFallback: "brave", searchFails: new AiProviderError("perplexity", "HTTP 429", 429) });

      const failure = await discovery.discover({ candidateId: "c", criteria }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(JobDiscoveryError);
      expect((failure as JobDiscoveryError).partial.searchFallback).toBeNull();
    });

    it("does not call the LLM when the page has JobPosting data", async () => {
      const { discovery, llm } = setup({ sources: [DAF_URL], pages: { [DAF_URL]: { body: jobPostingPage({ title: "DAF", description: "Poste." }) } } });

      await discovery.discover({ candidateId: "c", criteria });

      expect(llm.calls).toEqual([]);
    });

    it("finds a JobPosting inside an @graph and converts a monthly salary to annual", async () => {
      const body = `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "Offre" },
          {
            "@type": ["JobPosting"],
            title: "Contrôleur de gestion",
            description: "Poste en télétravail.",
            jobLocationType: "TELECOMMUTE",
            employmentType: ["FULL_TIME", "FREELANCE"],
            baseSalary: { currency: "EUR", value: { value: "5 000", unitText: "MONTH" } },
          },
        ],
      })}</script>`;
      const { discovery } = setup({ sources: [DAF_URL], pages: { [DAF_URL]: { body } } });

      const [offer] = (await discovery.discover({ candidateId: "c", criteria })).jobOffers;

      expect(offer).toMatchObject({ title: "Contrôleur de gestion", remoteWork: "full_remote", contractType: "freelance", salary: { min: 60_000, max: 60_000 } });
    });

    it("skips a page the LLM says is not one job posting, and a list of several JobPostings", async () => {
      const list = "https://emplois.example.fr/offres?q=daf";
      const { discovery, llm } = setup({
        sources: [DAF_URL, list],
        pages: {
          [DAF_URL]: { body: "<p>Nos conseils pour réussir votre entretien.</p>" },
          [list]: { body: jobPostingPage({ title: "A", description: "a" }) + jobPostingPage({ title: "B", description: "b" }) },
        },
        reply: '{"isJobOffer": false}',
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report).toMatchObject({
        jobOffers: [],
        skipped: [
          { url: DAF_URL, reason: "not_a_job_offer" },
          { url: list, reason: "not_a_job_offer" },
        ],
      });
      expect(llm.calls).toHaveLength(1);
    });
  });

  describe("reading the job URLs the search provider's answer names", () => {
    const RAF_URL = "https://autre.example.fr/offre/raf-77";
    const answer =
      `Le groupe Seb recrute un DAF à Écully (${DAF_URL}). ` +
      `Voir aussi [Responsable administratif et financier, 70 k€](${RAF_URL}), et ${DAF_URL}.`;

    it("reads them after the provider's sources, once each", async () => {
      const ARTICLE = "https://blog.example.fr/marche-daf";
      const { discovery, web } = setup({
        sources: [ARTICLE, DAF_URL],
        answer,
        pages: { [ARTICLE]: { body: jobPostingPage({ title: "DAF", description: "Poste." }) }, [DAF_URL]: { body: jobPostingPage({ title: "DAF Lyon", description: "Poste à Lyon." }) } },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(web.fetched().filter((url) => !url.endsWith("/robots.txt"))).toEqual([ARTICLE, DAF_URL, RAF_URL]);
      expect(report.funnel.providerUrls).toBe(3);
    });

    it("never makes a Job Offer from the answer text alone", async () => {
      const { discovery, llm } = setup({ sources: [], answer, pages: { [DAF_URL]: { status: 410 } }, reply: '{"isJobOffer": true, "title": "RAF", "content": "Poste."}' });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toEqual([]);
      expect(report.skipped).toEqual([
        { url: DAF_URL, reason: "gone" },
        { url: RAF_URL, reason: "gone" },
      ]);
      expect(llm.calls).toEqual([]);
    });
  });

  describe("following a listing page to its postings", () => {
    const LISTING = "https://emplois.example.fr/offres?q=daf";
    const listing = (paths: string[]) =>
      `<html><body><h1>Offres DAF</h1><ul>${paths.map((path) => `<li><a href="${path}">Offre</a></li>`).join("")}</ul></body></html>`;
    const postingAt = (index: number): Page => ({ body: jobPostingPage({ title: `DAF ${index}`, description: `Poste de DAF numéro ${index}.` }) });
    const at = (path: string) => `https://emplois.example.fr${path}`;

    it("reads the postings a listing page links to, each through the polite-fetch checks, without the LLM reading the listing", async () => {
      const paths = ["/offres/1-daf-lyon", "/offres/2-daf-paris", "/offres/3-daf-nantes"];
      const { discovery, web, llm } = setup({
        sources: [LISTING],
        pages: {
          "https://emplois.example.fr/robots.txt": { body: "User-agent: *\nDisallow: /offres/2-\n" },
          [LISTING]: { body: listing(paths) },
          [at(paths[0]!)]: postingAt(1),
          [at(paths[1]!)]: postingAt(2),
          [at(paths[2]!)]: { status: 403, headers: { "cf-mitigated": "challenge" }, body: "<title>Just a moment...</title>" },
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((offer) => offer.source.url)).toEqual([at(paths[0]!)]);
      expect(report.skipped).toEqual([
        { url: LISTING, reason: "not_a_job_offer" },
        { url: at(paths[1]!), reason: "robots" },
        { url: at(paths[2]!), reason: "bot_protection" },
      ]);
      expect(web.fetched()).not.toContain(at(paths[1]!));
      expect(llm.calls).toEqual([]);
      expect(report.funnel).toEqual({ providerUrls: 1, fetched: 2, extracted: 1, alreadyStored: 0 });
    });

    it("follows one level only, and does not read a posting again when a later result names it", async () => {
      const paths = ["/offres/1-daf-lyon", "/offres/2-daf-paris", "/offres/3-tous-les-postes-daf"];
      const { discovery, web } = setup({
        sources: [LISTING, at(paths[0]!)],
        pages: {
          [LISTING]: { body: listing(paths) },
          [at(paths[0]!)]: postingAt(1),
          [at(paths[1]!)]: postingAt(2),
          [at(paths[2]!)]: { body: listing(["/offres/4-daf-nice", "/offres/5-daf-lille", "/offres/6-daf-metz"]) },
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toHaveLength(2);
      expect(web.fetched().filter((url) => url === at(paths[0]!))).toHaveLength(1);
      expect(web.fetched()).not.toContain(at("/offres/4-daf-nice"));
    });

    it("follows a listing page that asks not to be indexed but lets its links be followed", async () => {
      const paths = ["/offres/1-daf-lyon", "/offres/2-daf-paris", "/offres/3-daf-nantes"];
      const { discovery } = setup({
        sources: [LISTING],
        pages: {
          [LISTING]: { body: listing(paths).replace("<body>", '<head><meta name="robots" content="noindex, follow"></head><body>') },
          [at(paths[0]!)]: postingAt(1),
          [at(paths[1]!)]: postingAt(2),
          [at(paths[2]!)]: postingAt(3),
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toHaveLength(3);
      expect(report.skipped).toEqual([{ url: LISTING, reason: "robots" }]);
    });

    describe("counting followed links against the budget", () => {
      const paths = [1, 2, 3, 4, 5].map((index) => `/offres/${index}-daf`);
      const pages = (posting: (index: number) => Page) => ({
        [LISTING]: { body: listing(paths) },
        ...Object.fromEntries(paths.map((path, index) => [at(path), posting(index + 1)])),
      });

      it("stops following once the run has its Job Offers", async () => {
        const later = "https://autre.example.fr/offres/42-daf";
        const { discovery, web } = setup({ sources: [LISTING, later], pages: { ...pages(postingAt), [later]: postingAt(42) }, budget: { jobOffers: 2 } });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.jobOffers.map((offer) => offer.source.url)).toEqual([at(paths[0]!), at(paths[1]!)]);
        expect(web.fetched()).not.toContain(at(paths[2]!));
        expect(web.fetched()).not.toContain(later);
      });

      it("stops following once the run has lasted its time", async () => {
        // Each posting takes 40 s to answer: the second starts at 40 s, the third at 80 s, the fourth would at 120 s.
        const { discovery, web } = setup({ sources: [LISTING], pages: pages((index) => ({ ...postingAt(index), delayMs: 40_000 })) });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.jobOffers).toHaveLength(3);
        expect(web.fetched()).not.toContain(at(paths[3]!));
      });

      it("stops following once the run has spent its money", async () => {
        // Each LLM read: 10,000 × $5/M = $0.05, €0.043. Job titles and search: €0.0022. After two reads, €0.088.
        const { discovery, llm, web } = setup({
          sources: [LISTING],
          pages: pages(() => ({ body: "<html><body><h1>DAF H/F</h1><p>Poste de DAF.</p></body></html>" })),
          llmUsage: { inputTokens: 10_000, outputTokens: 0 },
        });

        await discovery.discover({ candidateId: "c", criteria });

        expect(llm.calls).toHaveLength(2);
        expect(web.fetched()).not.toContain(at(paths[2]!));
      });
    });
  });

  describe("reading Greenhouse, Lever and Ashby postings through their JSON APIs", () => {
    const GREENHOUSE = "https://job-boards.greenhouse.io/gitlab/jobs/8860302002";
    const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8860302002";
    const LEVER = "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b";
    const LEVER_API = "https://api.lever.co/v0/postings/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b";
    const ASHBY = "https://jobs.ashbyhq.com/ashby/86a60834-ba64-484d-9658-afa1bc97a957";
    const ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board/ashby";
    /** An API's answer: a saved fixture, with some fields changed. */
    const json = (name: string, changes: object = {}): Page => ({
      body: JSON.stringify({ ...JSON.parse(readFileSync(new URL(`./fixtures/ats/${name}`, import.meta.url), "utf8")), ...changes }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    const apis: Record<string, Page> = {
      "https://boards-api.greenhouse.io/robots.txt": { body: "User-agent: *\nDisallow: /embed/\n", headers: { "content-type": "text/plain" } },
      "https://api.lever.co/robots.txt": { body: "User-agent: *\nAllow: /\nCrawl-delay: 1\n", headers: { "content-type": "text/plain" } },
      "https://api.ashbyhq.com/robots.txt": { status: 401, body: "Unauthorized" },
      [GREENHOUSE_API]: json("greenhouse-job.json"),
      [LEVER_API]: json("lever-posting.json"),
      [ASHBY_API]: json("ashby-job-board.json"),
    };

    it("captures each posting from its ATS's API, with the posting date the ATS states, never reading its HTML page", async () => {
      const leverCreatedAt = new Date("2026-09-30T09:00:00Z");
      const { discovery, web, llm } = setup({
        sources: [GREENHOUSE, LEVER, ASHBY],
        pages: { ...apis, [LEVER_API]: json("lever-posting.json", { createdAt: leverCreatedAt.getTime() }) },
        now: new Date("2026-10-05T08:00:00Z"),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map(({ source, title, postedAt }) => ({ source, title, postedAt }))).toEqual([
        { source: { url: GREENHOUSE }, title: "Account Executive - France", postedAt: new Date("2026-10-02T15:31:50Z") },
        { source: { url: LEVER }, title: "Customer Success Manager", postedAt: leverCreatedAt },
        { source: { url: ASHBY }, title: "Mid Market Account Executive - EMEA (French Speaking)", postedAt: new Date("2026-09-08T16:27:26.694Z") },
      ]);
      expect(web.fetched()).not.toContain(GREENHOUSE);
      expect(web.fetched()).not.toContain(LEVER);
      expect(web.fetched()).not.toContain(ASHBY);
      expect(llm.calls).toEqual([]);
      expect(report.funnel).toMatchObject({ providerUrls: 3, fetched: 3, extracted: 3 });
    });

    it("drops a closed posting and one first published more than 30 days ago", async () => {
      const { discovery } = setup({
        sources: [GREENHOUSE, LEVER, ASHBY],
        pages: { ...apis, [GREENHOUSE_API]: { status: 404, body: '{"status":404,"error":"Job not found"}', headers: { "content-type": "application/json" } } },
        now: new Date("2026-10-05T08:00:00Z"),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((offer) => offer.source.url)).toEqual([ASHBY]);
      expect(report.skipped).toEqual([
        { url: GREENHOUSE, reason: "gone" },
        { url: LEVER, reason: "too_old" },
      ]);
    });

    it("asks the ATS politely: as itself, after robots.txt, never for a URL robots.txt disallows", async () => {
      // The page is then read under its own site's robots.txt, which here keeps crawlers out too.
      const disallowAll = { body: "User-agent: *\nDisallow: /\n", headers: { "content-type": "text/plain" } };
      const { discovery, web } = setup({
        sources: [LEVER],
        pages: {
          ...apis,
          "https://api.lever.co/robots.txt": { body: "User-agent: *\nDisallow: /v0/\n", headers: { "content-type": "text/plain" } },
          "https://jobs.lever.co/robots.txt": disallowAll,
        },
        now: new Date("2026-09-05T08:00:00Z"),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped).toEqual([{ url: LEVER, reason: "robots" }]);
      expect(web.fetched()).toEqual(["https://api.lever.co/robots.txt", "https://jobs.lever.co/robots.txt"]);
      expect(web.requests[0]!.userAgent).toMatch(/^JobbboxBot\//);
    });

    it("makes nothing of an API that does not answer JSON (an error page), and reads the posting's page instead", async () => {
      const { discovery, llm } = setup({
        sources: [GREENHOUSE],
        pages: {
          ...apis,
          [GREENHOUSE_API]: { body: "<html><body>Maintenance en cours, revenez plus tard.</body></html>" },
          [GREENHOUSE]: { body: jobPostingPage({ title: "Account Executive - France", description: "Développer le portefeuille français." }) },
        },
        now: new Date("2026-10-05T08:00:00Z"),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.skipped).toEqual([]);
      expect(report.jobOffers.map(({ title, content, postedAt }) => ({ title, content, postedAt }))).toEqual([
        { title: "Account Executive - France", content: "Développer le portefeuille français.", postedAt: undefined },
      ]);
      expect(llm.calls).toEqual([]);
    });

    describe("when the API cannot be read, reading the posting's page instead", () => {
      // A large employer's whole Ashby board: OpenAI's weighs 13 MB, past what the crawler downloads (3 MB).
      const hugeBoard: Page = { body: `{"jobs":[${" ".repeat(3 * 1024 * 1024)}]}`, headers: { "content-type": "application/json" } };
      const ashbyPage: Page = {
        body: jobPostingPage({ title: "Mid Market Account Executive", description: "Vendre la plateforme Ashby en France.", hiringOrganization: { name: "Ashby" } }),
      };

      it("captures from its HTML page a posting whose ATS board is too large to download", async () => {
        const { discovery, web } = setup({ sources: [ASHBY], pages: { ...apis, [ASHBY_API]: hugeBoard, [ASHBY]: ashbyPage }, now: new Date("2026-10-05T08:00:00Z") });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.skipped).toEqual([]);
        expect(report.jobOffers.map(({ source, title, postedAt }) => ({ source, title, postedAt }))).toEqual([
          { source: { url: ASHBY }, title: "Mid Market Account Executive", postedAt: undefined },
        ]);
        expect(web.fetched()).toContain(ASHBY);
      });

      it("reads the page of a posting whose API robots.txt keeps crawlers out, through the page's own robots.txt", async () => {
        const { discovery, web } = setup({
          sources: [ASHBY],
          pages: {
            ...apis,
            "https://api.ashbyhq.com/robots.txt": { body: "User-agent: *\nDisallow: /\n", headers: { "content-type": "text/plain" } },
            "https://jobs.ashbyhq.com/robots.txt": { body: "User-agent: *\nAllow: /\n", headers: { "content-type": "text/plain" } },
            [ASHBY]: ashbyPage,
          },
          now: new Date("2026-10-05T08:00:00Z"),
        });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.jobOffers.map((offer) => offer.title)).toEqual(["Mid Market Account Executive"]);
        expect(web.fetched()).toEqual(["https://api.ashbyhq.com/robots.txt", "https://jobs.ashbyhq.com/robots.txt", ASHBY]);
      });

      it("never reads the page of a posting whose ATS answers with a challenge (ADR-0002)", async () => {
        const challenge: Page = { status: 403, body: "<html><title>Just a moment...</title><body>Checking your browser</body></html>" };
        const { discovery, web } = setup({ sources: [ASHBY], pages: { ...apis, [ASHBY_API]: challenge, [ASHBY]: ashbyPage }, now: new Date("2026-10-05T08:00:00Z") });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.skipped).toEqual([{ url: ASHBY, reason: "bot_protection" }]);
        expect(web.fetched()).not.toContain(ASHBY);
      });

      it("downloads an employer's Ashby board once per run, however many of its postings the run reads", async () => {
        const OTHER = "https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2";
        const { discovery, web } = setup({
          sources: [ASHBY, OTHER],
          pages: { ...apis, [ASHBY_API]: hugeBoard, [ASHBY]: ashbyPage, [OTHER]: { body: jobPostingPage({ title: "Engineering Manager", description: "Encadrer une équipe." }) } },
          now: new Date("2026-10-05T08:00:00Z"),
        });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.jobOffers.map((offer) => offer.title)).toEqual(["Mid Market Account Executive", "Engineering Manager"]);
        expect(web.fetched().filter((url) => url === ASHBY_API)).toHaveLength(1);
      });
    });

    it("never lists an ATS board across employers: one request per posting, at its own employer", async () => {
      const { discovery, web } = setup({ sources: [GREENHOUSE, LEVER, ASHBY], pages: apis, now: new Date("2026-09-05T08:00:00Z") });

      await discovery.discover({ candidateId: "c", criteria });

      const apiRequests = web.fetched().filter((url) => !url.endsWith("/robots.txt"));
      expect(apiRequests).toEqual([GREENHOUSE_API, LEVER_API, ASHBY_API]);
    });
  });

  describe("keeping postings of the last 30 days: the freshness rule (#116)", () => {
    const NOW = new Date("2026-10-14T08:00:00Z");
    const RECENT = "https://emplois.example.fr/offres/recente";
    const OLD = "https://emplois.example.fr/offres/ancienne";
    const UNDATED = "https://emplois.example.fr/offres/sans-date";
    const posting = (title: string, more: object = {}): Page => ({ body: jobPostingPage({ title, description: `${title} : le poste.`, ...more }) });

    it("keeps a posting dated within 30 days with its Posting date, drops one dated older, and keeps an undated one", async () => {
      const { discovery } = setup({
        sources: [RECENT, OLD, UNDATED],
        pages: {
          [RECENT]: posting("DAF récent", { datePosted: "2026-09-20" }),
          [OLD]: posting("DAF ancien", { datePosted: "2026-09-13T09:30:00+02:00" }),
          [UNDATED]: posting("DAF sans date"),
        },
        now: NOW,
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map(({ title, postedAt }) => ({ title, postedAt }))).toEqual([
        { title: "DAF récent", postedAt: new Date("2026-09-20T00:00:00Z") },
        { title: "DAF sans date", postedAt: undefined },
      ]);
      expect(report.skipped).toEqual([{ url: OLD, reason: "too_old" }]);
    });

    it("drops a posting older than the maximum age the web search's settings say (#402)", async () => {
      const { discovery } = setup({
        sources: [RECENT, UNDATED],
        pages: { [RECENT]: posting("DAF récent", { datePosted: "2026-09-20" }), [UNDATED]: posting("DAF sans date") },
        now: NOW,
        search: { maxPostingAgeDays: 3 },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map(({ title }) => title)).toEqual(["DAF sans date"]);
      expect(report.skipped).toEqual([{ url: RECENT, reason: "too_old" }]);
    });

    it("takes the search provider's date for a page that states none, after the page's own", async () => {
      const { discovery } = setup({
        sources: [RECENT, OLD, UNDATED],
        sourceDates: {
          // The page's JobPosting says recent: it wins over the provider's older date.
          [RECENT]: new Date("2026-08-01T00:00:00Z"),
          [OLD]: new Date("2026-09-01T00:00:00Z"),
          [UNDATED]: new Date("2026-10-10T12:00:00Z"),
        },
        pages: {
          [RECENT]: posting("DAF récent", { datePosted: "2026-10-01" }),
          [OLD]: posting("DAF ancien"),
          [UNDATED]: posting("DAF daté par le moteur"),
        },
        now: NOW,
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map(({ title, postedAt }) => ({ title, postedAt }))).toEqual([
        { title: "DAF récent", postedAt: new Date("2026-10-01T00:00:00Z") },
        { title: "DAF daté par le moteur", postedAt: new Date("2026-10-10T12:00:00Z") },
      ]);
      expect(report.skipped).toEqual([{ url: OLD, reason: "too_old" }]);
    });

    it("keeps a posting whose date cannot be believed (unreadable, or in the future) as undated", async () => {
      const { discovery } = setup({
        sources: [RECENT, UNDATED],
        pages: {
          [RECENT]: posting("DAF daté demain", { datePosted: "2026-11-30" }),
          [UNDATED]: posting("DAF mal daté", { datePosted: "il y a 3 jours" }),
        },
        now: NOW,
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map(({ title, postedAt }) => ({ title, postedAt }))).toEqual([
        { title: "DAF daté demain", postedAt: undefined },
        { title: "DAF mal daté", postedAt: undefined },
      ]);
      expect(report.skipped).toEqual([]);
    });

    describe("a Job Offer stored by an earlier run, found again", () => {
      // Posted 25 days before an earlier run stored it; now, 7 days later, posted 32 days ago.
      const staleStored: JobOffer = { id: "stored-old", source: { url: OLD }, title: "DAF ancien", content: "Poste de DAF ancien.", postedAt: new Date("2026-09-12T08:00:00Z") };
      const freshStored: JobOffer = { id: "stored-recent", source: { url: RECENT }, title: "DAF récent", content: "Poste de DAF récent.", postedAt: new Date("2026-10-01T00:00:00Z") };
      const undatedStored: JobOffer = { id: "stored-undated", source: { url: UNDATED }, title: "DAF sans date", content: "Poste de DAF sans date." };

      it("drops it once its Posting date is more than 30 days ago, and keeps a recent or undated one", async () => {
        const { discovery, web } = setup({ sources: [OLD, RECENT, UNDATED], pages: {}, existing: [staleStored, freshStored, undatedStored], now: NOW });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.jobOffers.map((offer) => offer.id)).toEqual(["stored-recent", "stored-undated"]);
        expect(report.skipped).toEqual([{ url: OLD, reason: "too_old" }]);
        expect(report.funnel.alreadyStored).toBe(2);
        expect(web.fetched()).toEqual([]);
      });

      it("drops it too when another result redirects to it", async () => {
        const board = "https://boards.example.fr/acme/jobs/41";
        const { discovery } = setup({
          sources: [board],
          pages: { [board]: { status: 302, headers: { location: OLD } } },
          existing: [staleStored],
          now: NOW,
        });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(report.jobOffers).toEqual([]);
        expect(report.skipped).toEqual([{ url: board, reason: "too_old" }]);
        expect(report.funnel.alreadyStored).toBe(0);
      });

      it("drops it too when an undated page elsewhere holds the same text", async () => {
        const mirror = "https://miroir.example.fr/offre/daf-ancien";
        const { discovery, jobOffers } = setup({
          sources: [mirror],
          pages: { [mirror]: { body: jobPostingPage({ title: staleStored.title, description: staleStored.content }) } },
          existing: [staleStored],
          now: NOW,
        });

        const report = await discovery.discover({ candidateId: "c", criteria });

        expect(jobOffers.all).toEqual([staleStored]);
        expect(report.jobOffers).toEqual([]);
        expect(report.skipped).toEqual([{ url: mirror, reason: "too_old" }]);
      });
    });
  });

  describe("deduplicating against existing Job Offers", () => {
    const stored: JobOffer = { id: "stored-1", source: { url: DAF_URL }, title: "DAF", content: "Poste de DAF." };

    it("returns the stored Job Offer for a known URL without fetching the page again", async () => {
      const { discovery, web, jobOffers } = setup({ sources: [DAF_URL], pages: {}, existing: [stored] });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toEqual([stored]);
      expect(web.fetched()).toEqual([]);
      expect(jobOffers.all).toEqual([stored]);
    });

    it("does not read a page again when another result redirects to it", async () => {
      const board = "https://boards.example.fr/acme/jobs/42";
      const { discovery, web, llm, jobOffers } = setup({
        sources: [DAF_URL, board],
        pages: {
          [DAF_URL]: { body: "<html><body><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF.</p></body></html>" },
          [board]: { status: 302, headers: { location: DAF_URL } },
        },
        reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF."}',
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((offer) => offer.source.url)).toEqual([DAF_URL]);
      expect(report.skipped).toEqual([]);
      expect(web.fetched().filter((url) => url === DAF_URL)).toHaveLength(1);
      expect(llm.calls).toHaveLength(1);
      expect(jobOffers.all).toHaveLength(1);
    });

    it("lists a posting found on two sites once", async () => {
      const mirror = "https://miroir.example.fr/offre/daf";
      const same = jobPostingPage({ title: "DAF", description: "Poste de DAF." });
      const { discovery, jobOffers } = setup({ sources: [DAF_URL, mirror, DAF_URL], pages: { [DAF_URL]: { body: same }, [mirror]: { body: same } } });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toHaveLength(1);
      expect(jobOffers.all).toHaveLength(1);
    });
  });

  describe("measuring a run", () => {
    const stored: JobOffer = { id: "stored-1", source: { url: "https://stockee.example.fr/offre" }, title: "DAF", content: "Poste de DAF déjà connu." };
    const posting = jobPostingPage({ title: "DAF", description: "Poste de DAF à Lyon." });
    const mirror = "https://miroir.example.fr/offre/daf";
    const listing = "https://emplois.example.fr/offres?q=daf";
    const gone = "https://emplois.example.fr/offres/pourvue";

    it("counts each stage of the funnel: provider URLs, pages read, Job Offers extracted, and those already stored", async () => {
      const { discovery } = setup({
        sources: [stored.source.url!, gone, DAF_URL, listing, mirror, DAF_URL],
        pages: { [DAF_URL]: { body: posting }, [mirror]: { body: posting }, [listing]: { body: "<html><body><h1>12 offres DAF</h1></body></html>" } },
        existing: [stored],
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.funnel).toEqual({ providerUrls: 5, fetched: 3, extracted: 2, alreadyStored: 1 });
      expect(report.jobOffers.map((offer) => offer.id)).toEqual(["stored-1", "offer-2"]);
      expect(report.skipped).toEqual([
        { url: gone, reason: "gone" },
        { url: listing, reason: "not_a_job_offer" },
      ]);
    });

    it("adds up the cost in € of the web search and of each page the LLM read", async () => {
      const listing2 = "https://emplois.example.fr/offres?q=raf";
      const { discovery } = setup({
        sources: [listing, listing2, DAF_URL],
        pages: { [listing]: { body: "<html><body>Offres</body></html>" }, [listing2]: { body: "<html><body>Offres</body></html>" }, [DAF_URL]: { body: posting } },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      // Fakes use 10 input and 5 output tokens per call. Job titles (Mistral default): 10 × $0.50/M + 5 × $1.50/M;
      // each search (French, then English): Perplexity's Search API, $0.001, no tokens;
      // each LLM read (Anthropic default): 10 × $5/M + 5 × $25/M; at €0.86 per $.
      expect(report.costEur).toBeCloseTo((0.0000125 + 2 * 0.001 + 2 * 0.000175) * 0.86, 9);
    });

    it("spends what AI Usage recorded: a run's budget spend equals the sum of its recorded AI Usage costs (#403)", async () => {
      const listing2 = "https://emplois.example.fr/offres?q=raf";
      const { discovery, usage } = setup({
        sources: [listing, listing2, DAF_URL],
        pages: { [listing]: { body: "<html><body>Offres</body></html>" }, [listing2]: { body: "<html><body>Offres</body></html>" }, [DAF_URL]: { body: posting } },
        // Each search call bills 3 units: not one search per call.
        searchTools: [{ name: "web_search", count: 3 }],
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(usage.entries.length).toBeGreaterThan(2);
      expect(report.costEur).toBeCloseTo(recordedEur(usage), 12);
      // Job titles, 2 searches of 3 units at $0.001 each, 2 LLM reads; at €0.86 per $.
      expect(report.costEur).toBeCloseTo((0.0000125 + 2 * 3 * 0.001 + 2 * 0.000175) * 0.86, 9);
    });

    it("keeps what a run measured before it failed", async () => {
      const { discovery } = setup({
        sources: [gone, listing],
        pages: { [listing]: { body: "<html><body>Offres</body></html>" } },
        reply: () => {
          throw new Error("LLM down");
        },
      });

      const failure = await discovery.discover({ candidateId: "c", criteria }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(JobDiscoveryError);
      expect((failure as JobDiscoveryError).message).toBe("LLM down");
      expect((failure as JobDiscoveryError).partial).toMatchObject({
        jobOffers: [],
        skipped: [{ url: gone, reason: "gone" }],
        funnel: { providerUrls: 2, fetched: 1, extracted: 0, alreadyStored: 0 },
      });
      expect((failure as JobDiscoveryError).partial.costEur).toBeCloseTo((0.0000125 + 0.001) * 0.86, 9);
    });
  });

  describe("stopped by the Candidate (#331)", () => {
    const urls = ["https://emplois.example.fr/offres/1", "https://emplois.example.fr/offres/2", "https://emplois.example.fr/offres/3"];
    const postings = Object.fromEntries(urls.map((url, index) => [url, { body: jobPostingPage({ title: `DAF ${index + 1}`, description: `Poste de DAF numéro ${index + 1}.` }) }]));

    it("starts no step once its signal aborts, and reports what it found until then rather than failing", async () => {
      const { discovery, web } = setup({ sources: urls, pages: postings });
      const stop = new AbortController();
      // The Candidate stops it as the first page read ends.
      const onEvent = (event: ProvenanceEvent) => {
        if (event.type === "step_ended" && event.step.kind === "tool" && event.step.tool === "job-site") stop.abort();
      };

      const report = await discovery.discover({ candidateId: "c", criteria, onEvent, signal: stop.signal });

      expect(report.jobOffers.map((jobOffer) => jobOffer.title)).toEqual(["DAF 1"]);
      expect(web.fetched()).not.toContain(urls[1]);
    });

    it("stops the AI call on its way: its step is kept 'stopped', with the steps finished before it", async () => {
      const { discovery, search } = setup({ sources: urls, pages: postings, searchPending: true });
      const stop = new AbortController();
      const onEvent = (event: ProvenanceEvent) => {
        if (event.type === "step_started" && event.step.kind === "ai" && event.step.task === "web_search") setTimeout(() => stop.abort(), 0);
      };

      const report = await discovery.discover({ candidateId: "c", criteria, onEvent, signal: stop.signal });

      expect(search.searches[0]?.signal).toBe(stop.signal);
      expect(report.jobOffers).toEqual([]);
      expect(report.run.provenance()?.steps.map((step) => [step.kind === "ai" ? step.task : step.kind, step.outcome])).toEqual([
        ["job_titles", "ok"],
        ["web_search", "stopped"],
      ]);
    });
  });

  describe("staying within the budget: 30 Job Offers, €0.08 or 90 s, whichever comes first", () => {
    const postings = (count: number) =>
      Array.from({ length: count }, (_, index) => `https://emplois.example.fr/offres/${index + 1}`);
    const pagesFor = (urls: string[], page: (url: string, index: number) => Page) =>
      Object.fromEntries(urls.map((url, index) => [url, page(url, index)]));
    const posting = (_url: string, index: number): Page => ({ body: jobPostingPage({ title: `DAF ${index + 1}`, description: `Poste de DAF numéro ${index + 1}.` }) });

    it("reads past 10 results, and stops once it has 30 Job Offers", async () => {
      const urls = postings(35);
      const { discovery, web } = setup({ sources: urls, pages: pagesFor(urls, posting) });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toHaveLength(30);
      expect(report.funnel).toMatchObject({ providerUrls: 35, fetched: 30 });
      expect(web.fetched()).not.toContain(urls[30]);
    });

    it("stops once the run has spent €0.08", async () => {
      const urls = postings(5);
      const { discovery, web, llm } = setup({
        sources: urls,
        pages: pagesFor(urls, () => ({ body: "<html><body><h1>Offres DAF</h1></body></html>" })),
        // Each LLM read: 10,000 × $5/M = $0.05, €0.043. Search: €0.00086. After two reads, €0.087.
        llmUsage: { inputTokens: 10_000, outputTokens: 0 },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(llm.calls).toHaveLength(2);
      expect(report.costEur).toBeCloseTo((0.0000125 + 0.001 + 2 * 0.05) * 0.86, 9);
      expect(web.fetched().filter((url) => urls.includes(url))).toEqual(urls.slice(0, 2));
    });

    it("stops once the run has lasted 90 s", async () => {
      const urls = postings(5);
      // Each page takes 40 s to answer: the third starts at 80 s, the fourth would start at 120 s.
      const { discovery, web } = setup({ sources: urls, pages: pagesFor(urls, (url, index) => ({ ...posting(url, index), delayMs: 40_000 })) });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers).toHaveLength(3);
      expect(web.fetched().filter((url) => urls.includes(url))).toEqual(urls.slice(0, 3));
    });

    it("takes its limits from the configured budget", async () => {
      const urls = postings(5);
      const { discovery } = setup({ sources: urls, pages: pagesFor(urls, posting), budget: { jobOffers: 2 } });

      expect((await discovery.discover({ candidateId: "c", criteria })).jobOffers).toHaveLength(2);
    });

    it("asks for its budget on each run: one changed in the Back Office applies to the next run, without a restart", async () => {
      const urls = postings(5);
      let budget: Partial<JobDiscoveryBudget> = { jobOffers: 2 };
      const { discovery } = setup({ sources: urls, pages: pagesFor(urls, posting), budget: () => budget });
      expect((await discovery.discover({ candidateId: "c", criteria })).jobOffers).toHaveLength(2);

      budget = { jobOffers: 4 };

      expect((await discovery.discover({ candidateId: "c", criteria })).jobOffers).toHaveLength(4);
    });

    describe("with several locations, one search each, sharing the budget (ADR-0025)", () => {
      const twoPlaces: SearchCriteria = { ...criteria, locations: ["Lyon", "Bordeaux"], contractTypes: ["cdi", "freelance"] };
      const place = (query: string) => (query.includes("Bordeaux") ? "bordeaux" : "lyon");
      /** Each place's own postings, `count` of them. */
      const postingsIn = (city: string, count: number) => Array.from({ length: count }, (_, index) => `https://emplois.example.fr/${city}/${index + 1}`);
      const allPages = (...lists: string[][]) => pagesFor(lists.flat(), posting);

      it("searches each location in turn, every contract type wanted in each query, the job titles planned once", async () => {
        const { discovery, search, titles } = setup({ sources: [], pages: {} });

        await discovery.discover({ candidateId: "c", criteria: twoPlaces });

        expect(titles.calls).toHaveLength(1);
        expect(search.queries).toEqual([
          "Offre d'emploi « Directeur financier » à Lyon, CDI ou freelance, télétravail partiel, salaire à partir de 110 000 € brut annuel",
          'Job offer "Directeur financier" in Lyon, permanent contract or freelance, hybrid remote work, salary from €110,000 gross per year',
          "Offre d'emploi « Directeur financier » à Bordeaux, CDI ou freelance, télétravail partiel, salaire à partir de 110 000 € brut annuel",
          'Job offer "Directeur financier" in Bordeaux, permanent contract or freelance, hybrid remote work, salary from €110,000 gross per year',
        ]);
      });

      it("splits the Job Offers evenly: each location stops at its share, and the run at the whole budget", async () => {
        const lyon = postingsIn("lyon", 5);
        const bordeaux = postingsIn("bordeaux", 5);
        const { discovery } = setup({ sources: (query) => (place(query) === "lyon" ? lyon : bordeaux), pages: allPages(lyon, bordeaux), budget: { jobOffers: 4 } });

        const report = await discovery.discover({ candidateId: "c", criteria: twoPlaces });

        expect(report.jobOffers.map((jobOffer) => jobOffer.source.url)).toEqual([...lyon.slice(0, 2), ...bordeaux.slice(0, 2)]);
      });

      it("leaves what a location did not use to the next one, never more than the budget in all", async () => {
        const lyon = postingsIn("lyon", 1);
        const bordeaux = postingsIn("bordeaux", 10);
        const { discovery } = setup({ sources: (query) => (place(query) === "lyon" ? lyon : bordeaux), pages: allPages(lyon, bordeaux), budget: { jobOffers: 4 } });

        const report = await discovery.discover({ candidateId: "c", criteria: twoPlaces });

        expect(report.jobOffers.map((jobOffer) => jobOffer.source.url)).toEqual([...lyon, ...bordeaux.slice(0, 3)]);
      });

      it("shares the time too: two locations take no longer than one", async () => {
        const lyon = postingsIn("lyon", 5);
        const bordeaux = postingsIn("bordeaux", 5);
        // Each page takes 40 s: Lyon reads until 45 s (two pages, to 80 s), Bordeaux until 90 s (one page).
        const pages = Object.fromEntries([...lyon, ...bordeaux].map((url, index) => [url, { ...posting(url, index), delayMs: 40_000 }]));
        const { discovery } = setup({ sources: (query) => (place(query) === "lyon" ? lyon : bordeaux), pages });

        const report = await discovery.discover({ candidateId: "c", criteria: twoPlaces });

        expect(report.jobOffers.map((jobOffer) => jobOffer.source.url)).toEqual([...lyon.slice(0, 2), bordeaux[0]]);
      });

      it("reads a posting found near two locations once", async () => {
        const shared = postingsIn("lyon", 1);
        const { discovery, web } = setup({ sources: shared, pages: allPages(shared) });

        const report = await discovery.discover({ candidateId: "c", criteria: twoPlaces });

        expect(report.jobOffers).toHaveLength(1);
        expect(web.fetched().filter((url) => url === shared[0])).toHaveLength(1);
        expect(report.funnel.providerUrls).toBe(1);
      });

      it("searches France Travail near each location for that location's share of the Job Offers", async () => {
        const searches: { location?: string; max: number }[] = [];
        const franceTravail: FranceTravail = {
          async search(_criteria, { max, location }) {
            searches.push({ location, max });
            return { ok: true, calls: 1, offers: [] };
          },
        };
        const { discovery } = setup({ sources: [], pages: {}, franceTravail, budget: { jobOffers: 30 } });

        const report = await discovery.discover({ candidateId: "c", criteria: { ...twoPlaces, locations: ["Lyon", "Bordeaux", "Nantes"] } });

        expect(searches).toEqual([
          { location: "Lyon", max: 10 },
          { location: "Bordeaux", max: 20 },
          { location: "Nantes", max: 30 },
        ]);
        expect(report.franceTravail).toEqual({ status: "searched", calls: 3, offers: 0 });
      });
    });
  });
  describe("searching France Travail first, when it is configured", () => {
    const NOW = new Date("2026-10-15T12:00:00Z");
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
    const ftOffer = (id: string, postedAt: Date) => ({
      url: `https://candidat.francetravail.fr/offres/recherche/detail/${id}`,
      details: { title: `Directeur financier ${id}`, content: `Offre France Travail ${id}.`, location: "69 - LYON", contractType: "cdi" as const, postedAt },
    });
    /** France Travail answering `result` to every search, and the searches asked of it. */
    const fakeFranceTravail = (result: FranceTravailSearch | ((max: number) => FranceTravailSearch)) => {
      const searches: { criteria: SearchCriteria; max: number; now: Date }[] = [];
      const franceTravail: FranceTravail = {
        async search(searched, { max, now }) {
          searches.push({ criteria: searched, max, now });
          return typeof result === "function" ? result(max) : result;
        },
      };
      return { franceTravail, searches };
    };

    it("captures its offers as Job Offers dated by France Travail, then searches the web as usual", async () => {
      const ft = fakeFranceTravail({ ok: true, calls: 2, offers: [ftOffer("201A", daysAgo(5)), ftOffer("201B", daysAgo(45))] });
      const { discovery, search, jobOffers } = setup({ sources: [], pages: {}, now: NOW, franceTravail: ft.franceTravail });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(ft.searches).toEqual([{ criteria, max: 30, now: NOW }]);
      expect(report.jobOffers).toEqual([
        expect.objectContaining({ title: "Directeur financier 201A", source: { url: "https://candidat.francetravail.fr/offres/recherche/detail/201A" }, postedAt: daysAgo(5) }),
      ]);
      expect(jobOffers.all).toHaveLength(1);
      // The adapter asks for the last 30 days; an older offer is still dropped by the freshness rule.
      expect(report.skipped).toEqual([{ url: "https://candidat.francetravail.fr/offres/recherche/detail/201B", reason: "too_old" }]);
      expect(report.funnel).toEqual({ providerUrls: 0, fetched: 0, extracted: 1, alreadyStored: 0 });
      expect(report.franceTravail).toEqual({ status: "searched", calls: 2, offers: 1 });
      expect(search.queries.length).toBeGreaterThan(0);
    });

    it("finds an offer stored by an earlier run again rather than capturing it twice", async () => {
      const offer = ftOffer("201A", daysAgo(5));
      const stored: JobOffer = { id: "stored-1", source: { url: offer.url }, ...offer.details };
      const ft = fakeFranceTravail({ ok: true, calls: 1, offers: [offer] });
      const { discovery, jobOffers } = setup({ sources: [], pages: {}, now: NOW, existing: [stored], franceTravail: ft.franceTravail });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((jobOffer) => jobOffer.id)).toEqual(["stored-1"]);
      expect(jobOffers.all).toHaveLength(1);
      expect(report.funnel).toMatchObject({ extracted: 0, alreadyStored: 1 });
      expect(report.franceTravail).toEqual({ status: "searched", calls: 1, offers: 1 });
    });

    it("counts its offers in the budget: it asks for no more than the budget's Job Offers, and the web is not searched once they are found", async () => {
      const ft = fakeFranceTravail((max) => ({ ok: true, calls: 2, offers: Array.from({ length: max }, (_, index) => ftOffer(`30${index}`, daysAgo(1))) }));
      const { discovery, search } = setup({ sources: [DAF_URL], pages: {}, now: NOW, franceTravail: ft.franceTravail, budget: { jobOffers: 3 } });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(ft.searches.map(({ max }) => max)).toEqual([3]);
      expect(report.jobOffers).toHaveLength(3);
      expect(search.queries).toEqual([]);
    });

    it.each(["refused", "failed"] as const)("goes on with the web search when France Travail is %s, and says so", async (reason) => {
      const ft = fakeFranceTravail({ ok: false, reason, detail: "search refused (403)", calls: 2 });
      const { discovery } = setup({
        sources: [DAF_URL],
        pages: { [DAF_URL]: { body: jobPostingPage({ title: "DAF H/F", description: "Poste de DAF à Lyon.", datePosted: "2026-10-12" }) } },
        now: NOW,
        franceTravail: ft.franceTravail,
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((jobOffer) => jobOffer.title)).toEqual(["DAF H/F"]);
      expect(report.franceTravail).toEqual({ status: reason, calls: 2, offers: 0 });
    });

    it("is off without France Travail configured", async () => {
      const { discovery } = setup({ sources: [], pages: {} });

      expect((await discovery.discover({ candidateId: "c", criteria })).franceTravail).toEqual({ status: "off", calls: 0, offers: 0 });
    });
  });

  describe("searching Fantastic.jobs' ATS postings, when its key is set (#243)", () => {
    const NOW = new Date("2026-10-15T12:00:00Z");
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
    const fjOffer = (id: string, postedAt: Date) => ({
      url: `https://jobs.smartrecruiters.com/Acme/${id}-directeur-financier`,
      details: { title: `Directeur financier ${id}`, content: `Offre Acme ${id}.`, employer: "Acme", location: "Lyon, Auvergne-Rhone-Alpes, France", postedAt },
    });
    /** Fantastic.jobs answering `result` to every search, and the searches asked of it. */
    const fakeFantasticJobs = (result: FantasticJobsSearch | ((max: number) => FantasticJobsSearch)) => {
      const searches: { criteria: SearchCriteria; max: number; location?: string }[] = [];
      const fantasticJobs: FantasticJobs = {
        async search(searched, { max, location }) {
          searches.push({ criteria: searched, max, location });
          return typeof result === "function" ? result(max) : result;
        },
      };
      return { fantasticJobs, searches };
    };

    it("captures its postings as Job Offers at their ATS page, dated by their posting, then searches the web as usual", async () => {
      const fj = fakeFantasticJobs({ ok: true, calls: 1, costEur: 0.016, offers: [fjOffer("1", daysAgo(3)), fjOffer("2", daysAgo(40))] });
      const { discovery, search } = setup({ sources: [], pages: {}, now: NOW, fantasticJobs: fj.fantasticJobs });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(fj.searches).toEqual([{ criteria, max: 30, location: "Lyon" }]);
      expect(report.jobOffers).toEqual([
        expect.objectContaining({ title: "Directeur financier 1", employer: "Acme", source: { url: "https://jobs.smartrecruiters.com/Acme/1-directeur-financier" }, postedAt: daysAgo(3) }),
      ]);
      expect(report.skipped).toEqual([{ url: "https://jobs.smartrecruiters.com/Acme/2-directeur-financier", reason: "too_old" }]);
      expect(report.funnel).toEqual({ providerUrls: 0, fetched: 0, extracted: 1, alreadyStored: 0 });
      expect(report.fantasticJobs).toEqual({ status: "searched", calls: 1, offers: 1, costEur: 0.016 });
      expect(search.queries.length).toBeGreaterThan(0);
    });

    it("deduplicates its postings against the Job Offers already stored", async () => {
      const offer = fjOffer("1", daysAgo(3));
      const stored: JobOffer = { id: "stored-1", source: { url: offer.url }, ...offer.details };
      const fj = fakeFantasticJobs({ ok: true, calls: 1, costEur: 0.008, offers: [offer] });
      const { discovery, jobOffers } = setup({ sources: [], pages: {}, now: NOW, existing: [stored], fantasticJobs: fj.fantasticJobs });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((jobOffer) => jobOffer.id)).toEqual(["stored-1"]);
      expect(jobOffers.all).toHaveLength(1);
      expect(report.funnel).toMatchObject({ extracted: 0, alreadyStored: 1 });
      expect(report.fantasticJobs).toMatchObject({ status: "searched", offers: 1 });
    });

    it("is searched after France Travail, for the Job Offers the budget has left, and before the web", async () => {
      const order: string[] = [];
      const franceTravail: FranceTravail = {
        async search() {
          order.push("france travail");
          return { ok: true, calls: 1, offers: [{ url: "https://candidat.francetravail.fr/offres/recherche/detail/1", details: { title: "DAF", content: "Offre France Travail.", postedAt: daysAgo(1) } }] };
        },
      };
      const fj = fakeFantasticJobs((max) => {
        order.push("fantastic.jobs");
        return { ok: true, calls: 1, costEur: 0, offers: Array.from({ length: max }, (_, index) => fjOffer(`4${index}`, daysAgo(1))) };
      });
      const { discovery, search } = setup({ sources: [DAF_URL], pages: {}, now: NOW, franceTravail, fantasticJobs: fj.fantasticJobs, budget: { jobOffers: 3 } });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(order).toEqual(["france travail", "fantastic.jobs"]);
      expect(fj.searches.map(({ max }) => max)).toEqual([2]);
      expect(report.jobOffers).toHaveLength(3);
      expect(search.queries).toEqual([]);
    });

    it("is called once a run, at its first location, however many locations the Search Criteria name (trial quota)", async () => {
      const places = ["Lyon", "Bordeaux", "Nantes", "Lille", "Paris"];
      const fj = fakeFantasticJobs({ ok: true, calls: 1, costEur: 0.008, offers: [fjOffer("1", daysAgo(3))] });
      const { discovery, search } = setup({ sources: [], pages: {}, now: NOW, fantasticJobs: fj.fantasticJobs });

      const report = await discovery.discover({ candidateId: "c", criteria: { ...criteria, locations: places } });

      expect(fj.searches.map(({ location }) => location)).toEqual(["Lyon"]);
      expect(report.fantasticJobs).toEqual({ status: "searched", calls: 1, offers: 1, costEur: 0.008 });
      // The web is still searched near every location.
      for (const place of places) expect(search.queries.some((query) => query.includes(place))).toBe(true);
    });

    it("is not called again at the next location once its one search of the run was refused", async () => {
      const fj = fakeFantasticJobs({ ok: false, reason: "refused", detail: "quota spent", calls: 0 });
      const { discovery } = setup({ sources: [], pages: {}, now: NOW, fantasticJobs: fj.fantasticJobs });

      const report = await discovery.discover({ candidateId: "c", criteria: { ...criteria, locations: ["Lyon", "Bordeaux"] } });

      expect(fj.searches).toHaveLength(1);
      expect(report.fantasticJobs).toEqual({ status: "refused", calls: 0, offers: 0, costEur: 0 });
    });

    it.each(["refused", "failed"] as const)("goes on with the other sources when Fantastic.jobs is %s, and says so", async (reason) => {
      const fj = fakeFantasticJobs({ ok: false, reason, detail: "active-ats refused (401)", calls: 1 });
      const { discovery } = setup({
        sources: [DAF_URL],
        pages: { [DAF_URL]: { body: jobPostingPage({ title: "DAF H/F", description: "Poste de DAF à Lyon.", datePosted: "2026-10-12" }) } },
        now: NOW,
        fantasticJobs: fj.fantasticJobs,
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((jobOffer) => jobOffer.title)).toEqual(["DAF H/F"]);
      expect(report.fantasticJobs).toEqual({ status: reason, calls: 1, offers: 0, costEur: 0 });
    });

    it("is off, with no call made, without its key", async () => {
      const { discovery } = setup({ sources: [], pages: {} });

      expect((await discovery.discover({ candidateId: "c", criteria })).fantasticJobs).toEqual({ status: "off", calls: 0, offers: 0, costEur: 0 });
    });

    it("is off, with no call made, once its source is disabled in the Back Office", async () => {
      const fj = fakeFantasticJobs({ ok: true, calls: 1, costEur: 0, offers: [] });
      const settings = async (): Promise<JobDiscoverySettings> => ({ sources: { ...DEFAULT_JOB_DISCOVERY_SETTINGS.sources, fantastic_jobs: false }, sites: [] });
      const { discovery } = setup({ sources: [], pages: {}, now: NOW, fantasticJobs: fj.fantasticJobs, settings });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(fj.searches).toEqual([]);
      expect(report.fantasticJobs).toEqual({ status: "off", calls: 0, offers: 0, costEur: 0 });
    });
  });

  describe("following the Job discovery sources and sites set in the Back Office", () => {
    const NOW = new Date("2026-10-15T12:00:00Z");
    const recentPosting = (title: string) => ({ body: jobPostingPage({ title, description: `Poste de ${title} à Lyon.`, datePosted: "2026-10-12" }) });
    const settings =
      (changes: { sources?: Partial<JobDiscoverySettings["sources"]>; sites?: JobDiscoverySettings["sites"] }) =>
      async (): Promise<JobDiscoverySettings> => ({
        sources: { ...DEFAULT_JOB_DISCOVERY_SETTINGS.sources, ...changes.sources },
        sites: changes.sites ?? [],
      });
    const franceTravailFinding = (searches: number[]): FranceTravail => ({
      async search(_, { max }) {
        searches.push(max);
        return { ok: true, calls: 1, offers: [] };
      },
    });

    it("does not search France Travail once disabled, and says it was off", async () => {
      const searches: number[] = [];
      const { discovery, search } = setup({ sources: [], pages: {}, now: NOW, franceTravail: franceTravailFinding(searches), settings: settings({ sources: { france_travail: false } }) });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(searches).toEqual([]);
      expect(report.franceTravail).toEqual({ status: "off", calls: 0, offers: 0 });
      expect(search.queries.length).toBeGreaterThan(0);
    });

    it("does not search the web once the web search is disabled: no plan, no search, France Travail only", async () => {
      const searches: number[] = [];
      const { discovery, search, titles } = setup({ sources: [DAF_URL], pages: {}, now: NOW, franceTravail: franceTravailFinding(searches), settings: settings({ sources: { web_search: false } }) });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(searches).toEqual([30]);
      expect(titles.calls).toEqual([]);
      expect(search.queries).toEqual([]);
      expect(report.costEur).toBe(0);
    });

    describe("without the key of the active Search provider (#399)", () => {
      const offerAt = (url: string, title: string) => ({ url, details: { title, content: `Offre ${title}.`, postedAt: new Date("2026-10-14T00:00:00Z") } });

      it("skips the web search like a disabled source, while France Travail and Fantastic.jobs still run", async () => {
        const franceTravail: FranceTravail = { search: async () => ({ ok: true, calls: 1, offers: [offerAt("https://candidat.francetravail.fr/offres/recherche/detail/1", "DAF")] }) };
        const fantasticJobs: FantasticJobs = { search: async () => ({ ok: true, calls: 1, costEur: 0.008, offers: [offerAt("https://boards.example.com/acme/jobs/1", "CFO")] }) };
        const { discovery, search, titles } = setup({ sources: [DAF_URL], pages: {}, now: NOW, franceTravail, fantasticJobs, searchKeyMissing: true });

        const report = await discovery.discover({ candidateId: "c", criteria: { ...criteria, locations: ["Lyon", "Bordeaux"] } });

        expect(report.jobOffers.map((offer) => offer.source.url)).toEqual(["https://candidat.francetravail.fr/offres/recherche/detail/1", "https://boards.example.com/acme/jobs/1"]);
        expect(report.franceTravail).toMatchObject({ status: "searched", offers: 1 });
        expect(report.fantasticJobs).toMatchObject({ status: "searched", offers: 1 });
        // No plan, no search: not even the job title step, as when the web search is disabled.
        expect(titles.calls).toEqual([]);
        expect(search.queries).toEqual([]);
        expect(report.run.provenance().steps.map((step) => step.kind === "ai" && step.task)).not.toContain("job_titles");
      });

      it("searches with a task Playbook's Search provider whose key is entered", async () => {
        const brave = createFakeProvider({ id: "brave", residency: "outside_eu", sources: [] });
        const { discovery } = setup({
          sources: [],
          pages: {},
          now: NOW,
          searchKeyMissing: true,
          otherSearch: brave,
          taskPlaybooks: servedTasks({
            "job-search-queries": {
              content: "## intitulés\n\nDonne des synonymes.\n\n## requête fr\n\nPoste « {{intitulé}} » vers {{lieu}}\n\n## requête en\n\n{{intitulé}} job in {{lieu}}",
              search: { provider: "brave", model: null },
            },
          }),
        });

        await discovery.discover({ candidateId: "c", criteria });

        expect(brave.queries.length).toBeGreaterThan(0);
      });
    });

    it("reads an ATS posting's page instead of its API once the ATS APIs are disabled", async () => {
      const GREENHOUSE = "https://job-boards.greenhouse.io/gitlab/jobs/8860302002";
      const { discovery, web } = setup({ sources: [GREENHOUSE], pages: { [GREENHOUSE]: recentPosting("Account Executive") }, now: NOW, settings: settings({ sources: { ats_apis: false } }) });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((offer) => offer.title)).toEqual(["Account Executive"]);
      expect(web.fetched().filter((url) => url.includes("boards-api.greenhouse.io"))).toEqual([]);
      expect(web.fetched()).toContain(GREENHOUSE);
    });

    it("searches each enabled Job discovery site on purpose, after the plan's queries, never a forbidden one", async () => {
      const { discovery, search } = setup({
        sources: [],
        pages: {},
        now: NOW,
        settings: settings({
          sites: [
            { domain: "apec.fr", enabled: true },
            { domain: "cadremploi.fr", enabled: false },
            // Written into the table by hand: the Back Office never lets a forbidden site in.
            { domain: "linkedin.com", enabled: true },
          ],
        }),
      });

      await discovery.discover({ candidateId: "c", criteria });

      expect(search.searches.map((s) => s.filters?.includeDomains)).toEqual([undefined, undefined, ["apec.fr"]]);
      expect(search.searches[2]!.query).toBe(search.searches[0]!.query);
      expect(search.searches[2]!.filters?.excludeDomains).toEqual(["linkedin.com", "indeed.com", "indeed.fr", "glassdoor.com", "glassdoor.fr"]);
    });

    it("skips a result page on a disabled Job discovery site, or one of its subdomains, without fetching it", async () => {
      const disabled = ["https://www.cadremploi.fr/emploi/detail_offre?offreId=1", "https://jobs.cadremploi.fr/offre/2"];
      const { discovery, web } = setup({
        sources: [...disabled, DAF_URL],
        pages: { [DAF_URL]: recentPosting("DAF H/F") },
        now: NOW,
        settings: settings({ sites: [{ domain: "cadremploi.fr", enabled: false }] }),
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.jobOffers.map((offer) => offer.title)).toEqual(["DAF H/F"]);
      expect(report.skipped).toEqual(disabled.map((url) => ({ url, reason: "site_disabled" })));
      expect(web.fetched().some((url) => url.includes("cadremploi"))).toBe(false);
    });

    it("searches as before when the settings cannot be read", async () => {
      const searches: number[] = [];
      const { discovery, search } = setup({
        sources: [],
        pages: {},
        now: NOW,
        franceTravail: franceTravailFinding(searches),
        settings: async () => {
          throw new Error("relation \"job_discovery_source\" does not exist");
        },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(searches).toEqual([30]);
      expect(report.franceTravail.status).toBe("searched");
      expect(search.searches.every((s) => s.filters?.includeDomains === undefined)).toBe(true);
    });
  });

  describe("the Provenance of each Job Offer found (#329)", () => {
    const NOW = new Date("2026-10-15T12:00:00Z");
    const provenanceOf = (jobOffers: ReturnType<typeof memoryJobOffers>, url: string) =>
      jobOffers.captures.find((capture) => (capture.input as { source: { url: string } }).source.url === url)?.trusted?.provenance;
    const what = (provenance: Provenance | undefined) =>
      provenance?.steps.map((step) => ({ kind: step.kind, activity: step.activity, ...(step.kind === "ai" ? { task: step.task, provider: step.provider, model: step.model } : step.kind === "tool" ? { tool: step.tool } : { rule: step.rule }) }));

    it("is its web search, its page read and the model that read the page, on the site of its page", async () => {
      const { discovery, jobOffers } = setup({
        sources: [DAF_URL],
        pages: { [DAF_URL]: { body: "<html><body><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF.</p></body></html>" } },
        reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF.", "summary": "Groupe Seb recrute son DAF à Lyon."}',
        taskPlaybooks: servedTasks({ "job-offer-reading": { content: '- "summary" : deux phrases.' } }),
        now: NOW,
      });

      await discovery.discover({ candidateId: "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b", criteria });

      const provenance = provenanceOf(jobOffers, DAF_URL);
      expect(what(provenance)).toEqual([
        { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "fake-perplexity" },
        { kind: "tool", activity: "read", tool: "job-site" },
        { kind: "ai", activity: "read", task: "offer_analysis", provider: "anthropic", model: "fake-anthropic" },
      ]);
      expect(provenance?.sites).toEqual([{ kind: "web", domain: "emplois.example.fr", links: [DAF_URL] }]);
      expect(provenance?.startedAt).toBe(NOW.toISOString());
      expect(JSON.stringify(provenance)).not.toContain("3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b");
    });

    it("has no model reading the page when the page states its JobPosting", async () => {
      const { discovery, jobOffers } = setup({ sources: [DAF_URL], pages: { [DAF_URL]: { body: jobPostingPage({ title: "DAF H/F", description: "Groupe Seb recrute son DAF." }) } } });

      await discovery.discover({ candidateId: "c", criteria });

      expect(what(provenanceOf(jobOffers, DAF_URL))).toEqual([
        { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "fake-perplexity" },
        { kind: "tool", activity: "read", tool: "job-site" },
      ]);
    });

    it("has the listing page read that led to a posting before the posting's own", async () => {
      const LISTING = "https://emplois.example.fr/offres?q=daf";
      const POSTING = "https://emplois.example.fr/offres/1-daf-lyon";
      const paths = ["/offres/1-daf-lyon", "/offres/2-daf-paris", "/offres/3-daf-nantes"];
      const { discovery, jobOffers } = setup({
        sources: [LISTING],
        pages: {
          [LISTING]: { body: `<html><body><h1>Offres DAF</h1><ul>${paths.map((path) => `<li><a href="${path}">Offre</a></li>`).join("")}</ul></body></html>` },
          [POSTING]: { body: jobPostingPage({ title: "DAF H/F", description: "Groupe Seb recrute son DAF." }) },
        },
      });

      await discovery.discover({ candidateId: "c", criteria });

      const provenance = provenanceOf(jobOffers, POSTING);
      expect(what(provenance)).toEqual([
        { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "fake-perplexity" },
        { kind: "tool", activity: "read", tool: "job-site" },
        { kind: "tool", activity: "read", tool: "job-site" },
      ]);
      expect(provenance?.sites).toEqual([{ kind: "web", domain: "emplois.example.fr", links: [POSTING] }]);
    });

    it("is its ATS's API read for a Greenhouse posting", async () => {
      const GREENHOUSE = "https://job-boards.greenhouse.io/gitlab/jobs/8860302002";
      const { discovery, jobOffers } = setup({
        sources: [GREENHOUSE],
        pages: {
          "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8860302002": {
            body: readFileSync(new URL("./fixtures/ats/greenhouse-job.json", import.meta.url), "utf8"),
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        },
        now: new Date("2026-10-05T08:00:00Z"),
      });

      await discovery.discover({ candidateId: "c", criteria });

      const provenance = provenanceOf(jobOffers, GREENHOUSE);
      expect(what(provenance)).toEqual([
        { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "fake-perplexity" },
        { kind: "tool", activity: "search", tool: "greenhouse" },
      ]);
      expect(provenance?.sites).toEqual([{ kind: "web", domain: "job-boards.greenhouse.io", links: [GREENHOUSE] }]);
    });

    it("is the job board's search for a France Travail or Fantastic.jobs offer", async () => {
      const FT = "https://candidat.francetravail.fr/offres/recherche/detail/201A";
      const ATS = "https://careers.example.com/jobs/42";
      const franceTravail: FranceTravail = {
        search: async () => ({ ok: true, calls: 1, offers: [{ url: FT, details: { title: "DAF", content: "Offre France Travail.", postedAt: NOW } }] }),
      };
      const fantasticJobs: FantasticJobs = {
        search: async () => ({ ok: true, calls: 1, costEur: 0.003, offers: [{ url: ATS, details: { title: "RAF", content: "Offre Fantastic.jobs.", postedAt: NOW } }] }),
      };
      const { discovery, jobOffers } = setup({ sources: [], pages: {}, now: NOW, franceTravail, fantasticJobs });

      await discovery.discover({ candidateId: "c", criteria });

      expect(what(provenanceOf(jobOffers, FT))).toEqual([{ kind: "tool", activity: "search", tool: "france-travail" }]);
      expect(provenanceOf(jobOffers, FT)?.sites).toEqual([{ kind: "web", domain: "candidat.francetravail.fr", links: [FT] }]);
      expect(what(provenanceOf(jobOffers, ATS))).toEqual([{ kind: "tool", activity: "search", tool: "fantastic-jobs" }]);
    });
  });
  describe("the Provenance of the run, and its steps as they run (#330)", () => {
    const NOW = new Date("2026-10-15T12:00:00Z");
    const FT = "https://candidat.francetravail.fr/offres/recherche/detail/201A";
    const franceTravail: FranceTravail = {
      search: async () => ({ ok: true, calls: 1, offers: [{ url: FT, details: { title: "DAF", content: "Offre France Travail.", postedAt: NOW } }] }),
    };
    const page = { [DAF_URL]: { body: "<html><body><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF.</p></body></html>" } };
    const reply = '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF."}';
    const what = (provenance: Provenance) =>
      provenance.steps.map((step) => ({ kind: step.kind, ...(step.kind === "ai" ? { task: step.task, model: step.model } : step.kind === "tool" ? { tool: step.tool } : { rule: step.rule }), count: step.count }));

    it("is every step of the run: the job title variants, each source, the web searches, the page reads and the model that read them, folded, with the sites read and its wall-clock time", async () => {
      const { discovery } = setup({ sources: [DAF_URL], pages: page, reply, franceTravail, now: NOW });

      const report = await discovery.discover({ candidateId: "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b", criteria });

      const provenance = report.run.provenance();
      expect(what(provenance)).toEqual([
        { kind: "tool", tool: "france-travail", count: 1 },
        { kind: "ai", task: "job_titles", model: "fake-mistral", count: 1 },
        { kind: "ai", task: "web_search", model: "fake-perplexity", count: 2 },
        { kind: "tool", tool: "job-site", count: 1 },
        { kind: "ai", task: "offer_analysis", model: "fake-anthropic", count: 1 },
      ]);
      expect(provenance.sites).toEqual([
        { kind: "web", domain: "candidat.francetravail.fr", links: [FT] },
        { kind: "web", domain: "emplois.example.fr", links: [DAF_URL] },
      ]);
      expect(provenance.startedAt).toBe(NOW.toISOString());
      expect(JSON.stringify(provenance)).not.toContain("3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b");
    });

    it("takes the steps the caller adds after the search, such as its Match Scores", async () => {
      const { discovery } = setup({ sources: [], pages: {}, now: NOW });

      const report = await discovery.discover({ candidateId: "c", criteria });
      await report.run.step({ rule: "match_score" }, () => 72);

      expect(report.run.provenance().steps.at(-1)).toMatchObject({ kind: "rules", rule: "match_score", outcome: "ok" });
    });

    it("tells the request's sink each step as it starts, then as it ended, each by its own id", async () => {
      const events: ProvenanceEvent[] = [];
      const { discovery } = setup({ sources: [DAF_URL], pages: page, reply, franceTravail, now: NOW });

      await discovery.discover({ candidateId: "c", criteria, onEvent: (event) => events.push(event) });

      const started = events.filter((event) => event.type === "step_started");
      expect(started.map((event) => ("task" in event.step ? event.step.task : "tool" in event.step ? event.step.tool : event.step.rule))).toEqual([
        "france-travail",
        "job_titles",
        "web_search",
        "job-site",
        "offer_analysis",
        "web_search",
      ]);
      expect(new Set(started.map((event) => event.id)).size).toBe(started.length);
      for (const { id } of started) expect(events.filter((event) => event.id === id).map((event) => event.type)).toEqual(["step_started", "step_ended"]);
    });

    it("keeps, for a run that failed, the steps it ran until then, the failed one included", async () => {
      const { discovery } = setup({
        sources: [DAF_URL],
        pages: page,
        reply: () => {
          throw new Error("LLM down");
        },
      });

      const failure = (await discovery.discover({ candidateId: "c", criteria }).catch((error: unknown) => error)) as JobDiscoveryError;

      expect(what(failure.partial.run.provenance()).map(({ kind, ...step }) => ("task" in step ? step.task : "tool" in step ? step.tool : kind))).toEqual([
        "job_titles",
        "web_search",
        "job-site",
        "offer_analysis",
      ]);
      expect(failure.partial.run.provenance().steps.at(-1)).toMatchObject({ kind: "ai", task: "offer_analysis", outcome: "failed" });
    });
  });

  describe("its record, for Activité › Recherches (#404)", () => {
    const posting = (title: string): Page => ({ body: jobPostingPage({ title, description: `Poste de ${title} à Lyon.` }) });
    const ONE = "https://emplois.example.fr/offres/1";
    const TWO = "https://emplois.example.fr/offres/2";
    const KNOWN = "https://emplois.example.fr/offres/connue";
    const known: JobOffer = { id: "known-1", source: { url: KNOWN }, title: "DAF déjà vue", content: "Déjà stockée." };
    const apec = async (): Promise<JobDiscoverySettings> => ({ ...DEFAULT_JOB_DISCOVERY_SETTINGS, sites: [{ domain: "apec.fr", enabled: true }] });

    it("lists each web search: its kind, the query texts sent, its provider, page, results, new Job Offers and cost", async () => {
      const { discovery } = setup({
        queriesPerCall: 5,
        sources: (_query, { filters }) => (filters?.includeDomains ? [KNOWN] : [ONE, TWO, KNOWN]),
        pages: { [ONE]: posting("DAF 1"), [TWO]: posting("DAF 2") },
        existing: [known],
        settings: apec,
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.searches).toEqual([
        {
          kind: "plan",
          queries: [
            "Offre d'emploi « Directeur financier » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel",
            'Job offer "Directeur financier" in Lyon, permanent contract, hybrid remote work, salary from €110,000 gross per year',
          ],
          page: 1,
          provider: "perplexity",
          fallback: false,
          results: 3,
          newJobOffers: 2,
          costEur: expect.closeTo(0.00086, 6),
        },
        {
          kind: "site",
          site: "apec.fr",
          queries: ["Offre d'emploi « Directeur financier » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel"],
          page: 1,
          provider: "perplexity",
          fallback: false,
          results: 1,
          newJobOffers: 0,
          costEur: expect.closeTo(0.00086, 6),
        },
      ]);
      // Three Job Offers found, one of them already stored: two new ones.
      expect(report.jobOffers).toHaveLength(3);
      expect(report.newJobOffers).toBe(2);
    });

    it("names the fallback Search provider on the searches it served", async () => {
      const brave = createFakeProvider({ id: "brave", residency: "outside_eu", sources: [] });
      const { discovery } = setup({ sources: [], pages: {}, otherSearch: brave, searchFallback: "brave", searchFails: new AiProviderError("perplexity", "HTTP 429", 429) });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(report.searches.map(({ provider, fallback }) => ({ provider, fallback }))).toEqual([
        { provider: "brave", fallback: true },
        { provider: "brave", fallback: true },
      ]);
    });

    it("says why it stopped: its Job Offers found, its spend or its time reached, its searches done, or the Candidate stopping it", async () => {
      const found = setup({ sources: [ONE, TWO], pages: { [ONE]: posting("DAF 1"), [TWO]: posting("DAF 2") }, budget: { jobOffers: 1 } });
      expect((await found.discovery.discover({ candidateId: "c", criteria })).stopReason).toBe("job_offers");

      const slow = setup({ sources: [ONE, TWO], pages: { [ONE]: { ...posting("DAF 1"), delayMs: 100_000 }, [TWO]: posting("DAF 2") } });
      expect((await slow.discovery.discover({ candidateId: "c", criteria })).stopReason).toBe("duration");

      const costly = setup({ sources: [ONE, TWO], pages: { [ONE]: posting("DAF 1"), [TWO]: posting("DAF 2") }, budget: { spendEur: 0.0001 } });
      expect((await costly.discovery.discover({ candidateId: "c", criteria })).stopReason).toBe("spend");

      const done = setup({ sources: [ONE], pages: { [ONE]: posting("DAF 1") } });
      expect((await done.discovery.discover({ candidateId: "c", criteria })).stopReason).toBe("exhausted");

      const stop = new AbortController();
      stop.abort();
      const stopped = setup({ sources: [ONE], pages: { [ONE]: posting("DAF 1") } });
      expect((await stopped.discovery.discover({ candidateId: "c", criteria, signal: stop.signal })).stopReason).toBe("stopped");
    });

    it("keeps what it recorded of a run that failed", async () => {
      const { discovery } = setup({ sources: [DAF_URL], pages: { [DAF_URL]: { body: "<html><body><h1>Offre</h1></body></html>" } }, reply: () => { throw new Error("LLM down"); } });

      const failure = (await discovery.discover({ candidateId: "c", criteria }).catch((error: unknown) => error)) as JobDiscoveryError;

      expect(failure.partial.stopReason).toBe("failed");
      expect(failure.partial.searches).toHaveLength(1);
      expect(failure.partial.searches[0]).toMatchObject({ kind: "plan", results: 1, newJobOffers: 0 });
    });
  });
});
