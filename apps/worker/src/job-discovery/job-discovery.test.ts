import { createAiLayer } from "@jobhub/ai";
import type { SearchOptions } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { JobOffer, SearchCriteria } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createJobDiscovery, JobDiscoveryError, type JobDiscoveryBudget, type JobOfferStore } from "./index";

const criteria: SearchCriteria = {
  targetRole: "Directeur financier",
  location: "Lyon",
  contractType: "cdi",
  remoteWork: "hybrid",
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
function memoryJobOffers(existing: JobOffer[] = []): JobOfferStore & { all: JobOffer[] } {
  const all = [...existing];
  return {
    all,
    async findBySourceUrl(url) {
      return all.find((offer) => offer.source.url === url) ?? null;
    },
    async capture(input, _capturedBy, trusted) {
      const offer = { ...(input as Omit<JobOffer, "id">), ...trusted };
      const same = all.find((o) => o.source.url === offer.source.url || o.content === offer.content);
      if (same) return { ok: true, jobOffer: same };
      const jobOffer = { id: `offer-${all.length + 1}`, ...offer };
      all.push(jobOffer);
      return { ok: true, jobOffer };
    },
  };
}

function setup(options: {
  sources: string[] | ((query: string, options: SearchOptions) => string[]);
  /** The job title step's reply. Default: no variants. */
  titles?: string;
  /** How many pages of results the search provider gives a query. Default: 1. */
  searchPages?: number;
  /** The search provider's answer text. */
  answer?: string;
  pages: Record<string, Page>;
  reply?: string | (() => string);
  existing?: JobOffer[];
  budget?: Partial<JobDiscoveryBudget>;
  /** Tokens each LLM read uses. */
  llmUsage?: { inputTokens: number; outputTokens: number };
  /** When the run starts. Default: the epoch. */
  now?: Date;
}) {
  const search = createFakeProvider({ id: "perplexity", residency: "outside_eu", sources: options.sources, answer: options.answer, pages: options.searchPages });
  const llm: FakeProvider = createFakeProvider({ id: "anthropic", reply: options.reply ?? '{"isJobOffer": false}', usage: options.llmUsage });
  const titles = createFakeProvider({ id: "mistral", reply: options.titles ?? "{}" });
  const ai = createAiLayer({
    providers: [search, llm, titles],
    routes: { web_search: "perplexity", offer_analysis: "anthropic", job_titles: "mistral" },
    usage: createMemoryUsageLog(),
  });
  const clock = fakeClock(options.now?.getTime());
  const web = fakeWeb(options.pages, clock);
  const jobOffers = memoryJobOffers(options.existing);
  const discovery = createJobDiscovery({ ai, jobOffers, fetch: web.fetch, clock, budget: options.budget });
  return { discovery, search, llm, titles, web, jobOffers };
}

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
      criteria: { targetRole: "DAF jean.dupont@mail.fr 06 12 34 56 78", location: "Lyon" },
    });

    expect(titles.calls.map((call) => call.messages)).toEqual([[{ role: "user", content: "DAF" }]]);
    expect(search.queries).toEqual(["Offre d'emploi « DAF » à Lyon", 'Job offer "DAF" in Lyon']);
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
        Array(3).fill({ excludeDomains: ["linkedin.com", "indeed.com", "indeed.fr", "glassdoor.com", "glassdoor.fr"], maxAgeDays: 30, country: "FR" }),
      );
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
      expect(llm.calls[0]!.messages[0]!.content).toBe("Accueil\n\nDAF H/F\n\nGroupe Seb recrute son DAF.");
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
      // each search (French, then English): $0.0025 + 10 × $0.20/M + 5 × $1.20/M;
      // each LLM read (Anthropic default): 10 × $5/M + 5 × $25/M; at €0.86 per $.
      expect(report.costEur).toBeCloseTo((0.0000125 + 2 * 0.002508 + 2 * 0.000175) * 0.86, 9);
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
      expect((failure as JobDiscoveryError).partial.costEur).toBeCloseTo((0.0000125 + 0.002508) * 0.86, 9);
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
        // Each LLM read: 10,000 × $5/M = $0.05, €0.043. Search: €0.0022. After two reads, €0.088.
        llmUsage: { inputTokens: 10_000, outputTokens: 0 },
      });

      const report = await discovery.discover({ candidateId: "c", criteria });

      expect(llm.calls).toHaveLength(2);
      expect(report.costEur).toBeCloseTo((0.0000125 + 0.002508 + 2 * 0.05) * 0.86, 9);
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
  });
});
