import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { JobOffer, SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createJobDiscovery, type JobOfferStore } from "./index";

const criteria: SearchCriteria = {
  targetRole: "Directeur financier",
  location: "Lyon",
  contractType: "cdi",
  remoteWork: "hybrid",
  minSalary: 110_000,
};

interface Page {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

/** Time that passes only when the crawler waits. */
function fakeClock() {
  let time = 0;
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
    async capture(input) {
      const offer = input as Omit<JobOffer, "id">;
      const same = all.find((o) => o.source.url === offer.source.url || o.content === offer.content);
      if (same) return { ok: true, jobOffer: same };
      const jobOffer = { id: `offer-${all.length + 1}`, ...offer };
      all.push(jobOffer);
      return { ok: true, jobOffer };
    },
  };
}

function setup(options: { sources: string[]; pages: Record<string, Page>; reply?: string; existing?: JobOffer[] }) {
  const search = createFakeProvider({ id: "perplexity", residency: "outside_eu", sources: options.sources });
  const llm: FakeProvider = createFakeProvider({ id: "anthropic", reply: options.reply ?? '{"isJobOffer": false}' });
  const ai = createAiLayer({
    providers: [search, llm],
    routes: { web_search: "perplexity", offer_analysis: "anthropic" },
    usage: createMemoryUsageLog(),
  });
  const clock = fakeClock();
  const web = fakeWeb(options.pages, clock);
  const jobOffers = memoryJobOffers(options.existing);
  const discovery = createJobDiscovery({ ai, jobOffers, fetch: web.fetch, clock });
  return { discovery, search, llm, web, jobOffers };
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

    expect(search.queries).toEqual([
      "Offres d'emploi « Directeur financier » à Lyon, CDI, télétravail partiel, salaire à partir de 110 000 € brut annuel",
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
    const { discovery, search } = setup({ sources: [], pages: {} });

    await discovery.discover({
      candidateId: "candidate-1",
      criteria: { targetRole: "DAF jean.dupont@mail.fr 06 12 34 56 78", location: "Lyon" },
    });

    expect(search.queries).toEqual(["Offres d'emploi « DAF » à Lyon"]);
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

      expect(report).toEqual({ jobOffers: [], skipped: [{ url: DAF_URL, reason: "robots" }] });
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

      expect(report).toEqual({
        jobOffers: [],
        skipped: [
          { url: DAF_URL, reason: "not_a_job_offer" },
          { url: list, reason: "not_a_job_offer" },
        ],
      });
      expect(llm.calls).toHaveLength(1);
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
});
