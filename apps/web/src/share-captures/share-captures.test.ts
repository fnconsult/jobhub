import { AiProviderError, createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { JobOffer, Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { CoachConversations } from "../coach-conversations";
import { createJobOfferLinks } from "../job-offer-links";
import type { JobOffers } from "../job-offers";
import { createShareCaptures } from "./index";

const ROBOTS_ALLOW = { body: "User-agent: *\nAllow: /", headers: { "content-type": "text/plain" } };
type Page = { status?: number; headers?: Record<string, string>; body?: string };

/** A pretend Internet: every URL the server may request, and the requests it made. */
function fakeWeb(pages: Record<string, Page>) {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    const page = pages[url];
    if (!page) return new Response("introuvable", { status: 404 });
    return new Response(page.body ?? "", { status: page.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...page.headers } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

/** Job Offers in memory, deduplicated by source URL then by text within one visibility, as the real ones are (ADR-0013). */
function memoryJobOffers() {
  const stored: (JobOffer & { privateTo?: string })[] = [];
  const jobOffers: Pick<JobOffers, "capture" | "findBySourceUrl"> = {
    async capture(input, _capturedBy, trusted = {}) {
      const body = input as Omit<JobOffer, "id">;
      if (typeof body.title !== "string" || !body.title || typeof body.content !== "string" || !body.content) return { ok: false, errors: [{ field: "title", code: "required" }] };
      const same = stored.find((offer) => offer.privateTo === trusted.privateTo && ((body.source?.url && offer.source.url === body.source.url) || offer.content === body.content));
      if (same) return { ok: true, jobOffer: same, created: false };
      const jobOffer = { id: `offer-${stored.length + 1}`, ...body, ...(trusted.summary ? { summary: trusted.summary } : {}), ...(trusted.privateTo ? { privateTo: trusted.privateTo } : {}) };
      stored.push(jobOffer);
      return { ok: true, jobOffer, created: true };
    },
    async findBySourceUrl(url, candidateId) {
      return stored.find((offer) => offer.source.url === url && (!offer.privateTo || offer.privateTo === candidateId)) ?? null;
    },
  };
  return { jobOffers, stored };
}

/** Coach Conversations in memory: the conversations started about a Job Offer. */
function memoryConversations() {
  const started: { candidateId: string; jobOffer: Pick<JobOffer, "id" | "title" | "employer">; opening: { message: string; reply: string; provenance: Provenance } }[] = [];
  const conversations: Pick<CoachConversations, "startAbout"> = {
    async startAbout(candidateId, jobOffer, opening) {
      started.push({ candidateId, jobOffer, opening });
      return { id: `conversation-${started.length}`, title: jobOffer.title, subject: null, profile: null, lastMessageAt: new Date() };
    },
  };
  return { conversations, started };
}

function setUp(pages: Record<string, Page> = {}, { reply = '{"isJobOffer": false}', fail }: { reply?: string; fail?: Error } = {}) {
  const web = fakeWeb(pages);
  const llm = createFakeProvider({ id: "mistral", reply, ...(fail ? { fail } : {}) });
  const ai = createAiLayer({ providers: [llm], routes: { offer_analysis: "mistral" }, euAiConsent: async () => false, warn: () => {}, usage: createMemoryUsageLog() });
  const { jobOffers, stored } = memoryJobOffers();
  const { conversations, started } = memoryConversations();
  const links = createJobOfferLinks({ ai, jobOffers, fetch: web.fetch, clock: { now: () => Date.now(), sleep: async () => {} } });
  const shares = createShareCaptures({ ai, links, jobOffers, conversations });
  return { shares, web, llm, stored, started };
}

const MARIE = "cand-marie";
const POSTING_URL = "https://carrieres.groupe-seb.fr/offres/daf-lyon";
const postingPage = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Directeur administratif et financier H/F",
  description: "<p>Groupe Seb recrute son DAF pour piloter la finance du groupe.</p>",
  hiringOrganization: { "@type": "Organization", name: "Groupe Seb" },
})}</script></head><body></body></html>`;
const READABLE = { "https://carrieres.groupe-seb.fr/robots.txt": ROBOTS_ALLOW, [POSTING_URL]: { body: postingPage } };
const LINKEDIN_URL = "https://www.linkedin.com/jobs/view/4012345678";
const OFFER_TEXT = `Contrôleur de gestion H/F — Airbus, Toulouse. CDI.
Au sein de la direction financière, vous pilotez le budget et les clôtures mensuelles de la division Avions commerciaux.
Vous êtes diplômé d'une école de commerce et avez au moins 5 ans d'expérience en contrôle de gestion industriel.`;
const AI_READS_OFFER = JSON.stringify({ isJobOffer: true, title: "Contrôleur de gestion H/F", content: OFFER_TEXT, employer: "Airbus", location: "Toulouse" });

describe("Share capture: a job posting sent to Jobbbox from another app's share sheet (#697)", () => {
  it("reads a readable link on the server, under the job discovery rules, into the Candidate's Private Job Offer, opened in its own conversation", async () => {
    const { shares, web, stored, started } = setUp(READABLE);

    const shared = await shares.capture(MARIE, { url: POSTING_URL }, "fr");

    expect(shared).toEqual({
      ok: true,
      jobOffer: { id: "offer-1", title: "Directeur administratif et financier H/F", employer: "Groupe Seb" },
      conversation: { id: "conversation-1", title: "Directeur administratif et financier H/F" },
    });
    expect(web.requests).toEqual(["https://carrieres.groupe-seb.fr/robots.txt", POSTING_URL]);
    expect(stored[0]).toMatchObject({ privateTo: MARIE, source: { url: POSTING_URL } });
    expect(started).toEqual([
      {
        candidateId: MARIE,
        jobOffer: expect.objectContaining({ id: "offer-1" }),
        opening: {
          message: "Offre partagée depuis une autre app : Directeur administratif et financier H/F",
          reply: expect.stringContaining("Scorer contre mon profil"),
          provenance: expect.objectContaining({ sites: [expect.objectContaining({ domain: "carrieres.groupe-seb.fr" })] }),
        },
      },
    ]);
  });

  it("finds the link in a shared text that only announces it, as an app's share sheet sends it", async () => {
    const { shares } = setUp(READABLE);
    expect(await shares.capture(MARIE, { text: `Regarde cette offre chez Groupe Seb : ${POSTING_URL}` }, "fr")).toMatchObject({ ok: true, jobOffer: { id: "offer-1" } });
  });

  it("asks for the offer's text where the rules refuse the link, never requesting a Forbidden site, and keeps nothing", async () => {
    const { shares, web, llm, stored, started } = setUp();

    expect(await shares.capture(MARIE, { url: LINKEDIN_URL, text: `Découvrez cette offre sur LinkedIn ${LINKEDIN_URL}` }, "fr")).toEqual({ ok: false, error: "text_needed", reason: "forbidden_site" });
    expect(web.requests).toEqual([]);
    expect(llm.calls).toEqual([]);
    expect(stored).toEqual([]);
    expect(started).toEqual([]);
  });

  it("asks for the text of a page that cannot be read", async () => {
    const { shares } = setUp({ "https://jobs.example.fr/robots.txt": { body: "User-agent: *\nDisallow: /" } });
    expect(await shares.capture(MARIE, { url: "https://jobs.example.fr/offre/1" }, "fr")).toEqual({ ok: false, error: "text_needed", reason: "unreadable" });
  });

  it("reads the offer's text shared or pasted with a refused link, the link kept as its source, never fetched", async () => {
    const { shares, web, llm, stored } = setUp({}, { reply: AI_READS_OFFER });

    const shared = await shares.capture(MARIE, { url: LINKEDIN_URL, text: OFFER_TEXT }, "fr");

    expect(shared).toMatchObject({ ok: true, jobOffer: { title: "Contrôleur de gestion H/F", employer: "Airbus" } });
    expect(web.requests).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(stored[0]).toMatchObject({ privateTo: MARIE, source: { url: LINKEDIN_URL }, content: OFFER_TEXT });
  });

  it("reads a text shared alone into a Private Job Offer", async () => {
    const { shares, web, stored, started } = setUp({}, { reply: AI_READS_OFFER });

    const shared = await shares.capture(MARIE, { text: OFFER_TEXT }, "en");

    expect(shared).toMatchObject({ ok: true, jobOffer: { id: "offer-1", title: "Contrôleur de gestion H/F", employer: "Airbus" }, conversation: { id: "conversation-1" } });
    expect(web.requests).toEqual([]);
    expect(stored[0]).toMatchObject({ privateTo: MARIE, source: {}, location: "Toulouse" });
    expect(started[0]!.opening.message).toBe("Job offer shared from another app: Contrôleur de gestion H/F");
  });

  it("says a text the AI does not read as one job posting is not a Job Offer, and keeps nothing", async () => {
    const { shares, stored, started } = setUp({}, { reply: '{"isJobOffer": false}' });

    expect(await shares.capture(MARIE, { text: OFFER_TEXT.replaceAll("offre", "newsletter") }, "fr")).toEqual({ ok: false, error: "not_a_job_offer" });
    expect(stored).toEqual([]);
    expect(started).toEqual([]);
  });

  it("says the AI could not read the text when it is unavailable, so the Candidate can send it again", async () => {
    const { shares, stored } = setUp({}, { fail: new AiProviderError("mistral", "HTTP 503", 503) });
    expect(await shares.capture(MARIE, { text: OFFER_TEXT }, "fr")).toEqual({ ok: false, error: "unavailable" });
    expect(stored).toEqual([]);
  });

  it("deduplicates a posting shared twice: the Candidate's Private Job Offer is the same, in a new conversation", async () => {
    const { shares, stored, started } = setUp(READABLE);

    await shares.capture(MARIE, { url: POSTING_URL }, "fr");
    const again = await shares.capture(MARIE, { url: POSTING_URL }, "fr");

    expect(again).toMatchObject({ ok: true, jobOffer: { id: "offer-1" }, conversation: { id: "conversation-2" } });
    expect(stored).toHaveLength(1);
    expect(started).toHaveLength(2);
  });

  it("refuses what is no share: nothing, a link that is not the web's, too long a text", async () => {
    const { shares } = setUp();
    for (const input of [undefined, {}, { text: "   " }, { url: "ftp://exemple.fr/offre" }, { text: "x".repeat(100_001) }, { url: 42 }]) {
      expect(await shares.capture(MARIE, input, "fr")).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("asks for the text of a short message with no link, without an AI call", async () => {
    const { shares, llm } = setUp();
    expect(await shares.capture(MARIE, { text: "Regarde ce poste !" }, "fr")).toEqual({ ok: false, error: "text_needed", reason: "not_a_job_offer" });
    expect(llm.calls).toEqual([]);
  });
});
