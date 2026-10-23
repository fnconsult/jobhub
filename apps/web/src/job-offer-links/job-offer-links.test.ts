import { createAiLayer, createProvenanceRecorder } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { JobOffer, Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { JobOffers } from "../job-offers";
import { createJobOfferLinks, findJobOfferLink } from "./index";

interface Page {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

const ROBOTS_ALLOW = { body: "User-agent: *\nAllow: /", headers: { "content-type": "text/plain" } };

/** A pretend Internet: every URL the reader may request, and the requests it made. */
function fakeWeb(pages: Record<string, Page | "down">) {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    const page = pages[url];
    if (page === "down") throw new TypeError("fetch failed");
    if (!page) return new Response("introuvable", { status: 404 });
    return new Response(page.body ?? "", { status: page.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...page.headers } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

/** Job Offers in memory: what was captured, and those already stored by source URL. */
function memoryJobOffers(stored: JobOffer[] = []) {
  const captures: { input: Record<string, unknown>; capturedBy: string | undefined; trusted: unknown }[] = [];
  const jobOffers: Pick<JobOffers, "capture" | "findBySourceUrl"> = {
    async capture(input, capturedBy, trusted) {
      const body = input as Record<string, unknown>;
      captures.push({ input: body, capturedBy, trusted });
      if (typeof body.title !== "string" || body.title.length > 500) return { ok: false, errors: [{ field: "title", code: "too_long" }] };
      const jobOffer = { id: `offer-${captures.length}`, ...(body as Omit<JobOffer, "id">) };
      stored.push(jobOffer);
      return { ok: true, jobOffer };
    },
    async findBySourceUrl(url) {
      return stored.find((jobOffer) => jobOffer.source.url === url) ?? null;
    },
  };
  return { jobOffers, captures };
}

function setUp(pages: Record<string, Page | "down">, { reply = '{"isJobOffer": false}', stored = [] as JobOffer[] } = {}) {
  const web = fakeWeb(pages);
  const llm = createFakeProvider({ id: "mistral", reply });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({ providers: [llm], routes: { offer_analysis: "mistral" }, euAiConsent: async () => false, warn: () => {}, usage });
  const { jobOffers, captures } = memoryJobOffers(stored);
  const links = createJobOfferLinks({ ai, jobOffers, fetch: web.fetch, clock: { now: () => Date.now(), sleep: async () => {} } });
  return { links, web, llm, usage, captures, ai };
}

const POSTING_URL = "https://carrieres.groupe-seb.fr/offres/daf-lyon";

const jsonLdPage = `<html><head><title>DAF H/F</title><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Directeur administratif et financier H/F",
  description: "<p>Groupe Seb recrute son DAF pour piloter la finance du groupe.</p>",
  datePosted: "2026-10-12",
  hiringOrganization: { "@type": "Organization", name: "Groupe Seb" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Lyon" } },
  employmentType: "FULL_TIME",
})}</script></head><body><h1>DAF H/F</h1></body></html>`;

const plainPage = "<html><head><title>DAF H/F</title></head><body><h1>DAF H/F</h1><p>Groupe Seb recrute son DAF à Lyon. CDI. 15 ans d'expérience.</p></body></html>";

describe("finding a Job Offer link in the Candidate's message", () => {
  it("finds the first web link, without the punctuation that ends the sentence", () => {
    expect(findJobOfferLink(`Que pensez-vous de cette offre : ${POSTING_URL}.`)).toBe(POSTING_URL);
    expect(findJobOfferLink(`(voir ${POSTING_URL}?ref=mail) et http://exemple.fr/2`)).toBe(`${POSTING_URL}?ref=mail`);
    expect(findJobOfferLink(`« ${POSTING_URL} »`)).toBe(POSTING_URL);
  });

  it("finds none in a message without a web link", () => {
    expect(findJobOfferLink("Comment préparer mon entretien de jeudi ?")).toBeNull();
    expect(findJobOfferLink("Écrivez-moi à marie@example.fr ou sur ftp://exemple.fr")).toBeNull();
  });
});

describe("reading a Job Offer from a link the Candidate pasted", () => {
  it("never fetches a Forbidden site: the Candidate is sent to the browser extension", async () => {
    for (const url of ["https://www.linkedin.com/jobs/view/123", "https://fr.indeed.com/viewjob?jk=1", "https://www.glassdoor.fr/job-listing/x"]) {
      const { links, web, llm, captures } = setUp({});
      expect(await links.read("cand-1", url)).toEqual({ ok: false, reason: "forbidden_site" });
      expect(web.requests).toEqual([]);
      expect(llm.calls).toEqual([]);
      expect(captures).toEqual([]);
    }
  });

  it("refuses a page that redirects to a Forbidden site, without requesting it", async () => {
    const { links, web } = setUp({
      "https://court.example.fr/robots.txt": ROBOTS_ALLOW,
      "https://court.example.fr/x": { status: 302, headers: { location: "https://www.linkedin.com/jobs/view/123" } },
    });
    expect(await links.read("cand-1", "https://court.example.fr/x")).toEqual({ ok: false, reason: "forbidden_site" });
    expect(web.requests.some((url) => url.includes("linkedin"))).toBe(false);
  });

  it("captures a page's JobPosting data as the Candidate's, with the Posting date it states, without an AI call", async () => {
    const { links, llm, captures } = setUp({ "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: jsonLdPage } });

    const read = await links.read("cand-1", POSTING_URL);

    expect(read).toMatchObject({ ok: true, jobOffer: { id: "offer-1", title: "Directeur administratif et financier H/F", employer: "Groupe Seb", location: "Lyon" } });
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ input: { source: { url: POSTING_URL }, title: "Directeur administratif et financier H/F" }, capturedBy: "candidate" });
    expect(captures[0]!.input).not.toHaveProperty("postedAt");
    expect(captures[0]!.trusted).toEqual({ postedAt: new Date("2026-10-12"), provenance: expect.any(Object) });
    expect(llm.calls).toEqual([]);
  });

  it("has the AI read a page without JobPosting data, the page text passed as data, as the offer_analysis task recorded in AI Usage", async () => {
    const { links, llm, usage, captures } = setUp(
      { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: plainPage } },
      { reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF à Lyon.", "employer": "Groupe Seb", "contractType": "cdi", "requiredExperienceYears": 15}' },
    );

    const read = await links.read("cand-1", POSTING_URL);

    expect(read).toMatchObject({ ok: true, jobOffer: { title: "DAF H/F", employer: "Groupe Seb" } });
    expect(captures[0]!.input).toMatchObject({ source: { url: POSTING_URL }, title: "DAF H/F", content: "Groupe Seb recrute son DAF à Lyon.", contractType: "cdi", requiredExperienceYears: 15 });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.messages[0]!.content).toMatch(/^<page>\n[\s\S]*Groupe Seb recrute son DAF à Lyon[\s\S]*\n<\/page>$/);
    expect(usage.entries).toMatchObject([{ task: "offer_analysis", candidateId: "cand-1" }]);
  });

  it("says a page that is not one job posting is not a Job Offer, and captures nothing", async () => {
    const { links, captures } = setUp({ "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: plainPage } });
    expect(await links.read("cand-1", POSTING_URL)).toEqual({ ok: false, reason: "not_a_job_offer" });
    expect(captures).toEqual([]);
  });

  it("says a posting the Job Offers refuse is not a Job Offer", async () => {
    const { links } = setUp(
      { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: plainPage } },
      { reply: JSON.stringify({ isJobOffer: true, title: "D".repeat(600), content: "Texte" }) },
    );
    expect(await links.read("cand-1", POSTING_URL)).toEqual({ ok: false, reason: "not_a_job_offer" });
  });

  it.each([
    ["robots.txt keeps us out", { "https://carrieres.groupe-seb.fr/robots.txt": { body: "User-agent: *\nDisallow: /", headers: { "content-type": "text/plain" } }, [POSTING_URL]: { body: plainPage } }],
    ["the page asks not to be indexed", { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: plainPage.replace("<head>", '<head><meta name="robots" content="noindex">') } }],
    ["a bot check stands in for the page", { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { status: 403, body: "<title>Just a moment...</title>" } }],
    ["the page needs signing in", { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { status: 401, body: "Connectez-vous" } }],
    ["the page is gone", { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW }],
    ["the site is down", { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: "down" as const }],
  ])("says the page could not be read when %s, with no AI call", async (_, pages) => {
    const { links, llm, captures } = setUp(pages);
    expect(await links.read("cand-1", POSTING_URL)).toEqual({ ok: false, reason: "unreadable" });
    expect(llm.calls).toEqual([]);
    expect(captures).toEqual([]);
  });

  it("never reaches a private address", async () => {
    const { links, web } = setUp({});
    expect(await links.read("cand-1", "http://192.168.1.10/offre")).toEqual({ ok: false, reason: "unreadable" });
    expect(await links.read("cand-1", "http://localhost:3000/offre")).toEqual({ ok: false, reason: "unreadable" });
    expect(web.requests).toEqual([]);
  });

  it("gives the Job Offer already stored for the link without reading the page again", async () => {
    const stored: JobOffer = { id: "offer-known", source: { url: POSTING_URL }, title: "DAF H/F", content: "Groupe Seb recrute son DAF." };
    const { links, web, captures } = setUp({}, { stored: [stored] });
    expect(await links.read("cand-1", POSTING_URL)).toEqual({ ok: true, jobOffer: stored });
    expect(web.requests).toEqual([]);
    expect(captures).toEqual([]);
  });

  describe("recorded in the reply's Provenance (#327)", () => {
    it("records the page read as its Tool, the AI reading it, and the page as a Provenance site", async () => {
      const { links, ai } = setUp(
        { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: plainPage } },
        { reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF à Lyon."}' },
      );
      const recorder = createProvenanceRecorder(ai);

      await links.read("cand-1", POSTING_URL, recorder);

      expect(recorder.provenance().steps).toEqual([
        expect.objectContaining({ kind: "tool", tool: "job-site", activity: "read", outcome: "ok" }),
        expect.objectContaining({ kind: "ai", task: "offer_analysis", activity: "read", provider: "mistral", outcome: "ok" }),
      ]);
      expect(recorder.provenance().sites).toEqual([{ kind: "web", domain: "carrieres.groupe-seb.fr", links: [POSTING_URL] }]);
    });

    it("records a page that could not be read as a failed Tool step, with no site", async () => {
      const { links, ai } = setUp({ "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW });
      const recorder = createProvenanceRecorder(ai);

      expect(await links.read("cand-1", POSTING_URL, recorder)).toEqual({ ok: false, reason: "unreadable" });

      expect(recorder.provenance().steps).toEqual([expect.objectContaining({ kind: "tool", tool: "job-site", outcome: "failed" })]);
      expect(recorder.provenance().sites).toEqual([]);
    });

    it("keeps the page of a Job Offer already stored as a Provenance site, without a page read", async () => {
      const stored: JobOffer = { id: "offer-known", source: { url: POSTING_URL }, title: "DAF H/F", content: "Groupe Seb recrute son DAF." };
      const { links, ai } = setUp({}, { stored: [stored] });
      const recorder = createProvenanceRecorder(ai);

      await links.read("cand-1", POSTING_URL, recorder);

      expect(recorder.provenance()).toMatchObject({ steps: [], sites: [{ kind: "web", domain: "carrieres.groupe-seb.fr", links: [POSTING_URL] }] });
    });

    it("records nothing for a Forbidden site, never requested", async () => {
      const { links, ai } = setUp({});
      const recorder = createProvenanceRecorder(ai);

      await links.read("cand-1", "https://www.linkedin.com/jobs/view/123", recorder);

      expect(recorder.provenance()).toMatchObject({ steps: [], sites: [] });
    });
  });
});

describe("the Provenance of a Job Offer read from a link (#329)", () => {
  const CANDIDATE = "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b";
  const what = (provenance: Provenance) =>
    provenance.steps.map((step) => ({ kind: step.kind, activity: step.activity, ...(step.kind === "ai" ? { task: step.task, provider: step.provider, model: step.model } : step.kind === "tool" ? { tool: step.tool } : {}) }));

  it("is its page read and the model that read it, on the site of its page, naming no Candidate", async () => {
    const { links, captures } = setUp(
      { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: plainPage } },
      { reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF à Lyon."}' },
    );

    await links.read(CANDIDATE, POSTING_URL);

    const { provenance } = captures[0]!.trusted as { provenance: Provenance };
    expect(what(provenance)).toEqual([
      { kind: "tool", activity: "read", tool: "job-site" },
      { kind: "ai", activity: "read", task: "offer_analysis", provider: "mistral", model: "fake-mistral" },
    ]);
    expect(provenance.sites).toEqual([{ kind: "web", domain: "carrieres.groupe-seb.fr", links: [POSTING_URL] }]);
    expect(JSON.stringify(provenance)).not.toContain(CANDIDATE);
  });

  it("is its page read alone when the page states its JobPosting", async () => {
    const { links, captures } = setUp({ "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: jsonLdPage } });

    await links.read(CANDIDATE, POSTING_URL);

    expect(what((captures[0]!.trusted as { provenance: Provenance }).provenance)).toEqual([{ kind: "tool", activity: "read", tool: "job-site" }]);
  });
});
