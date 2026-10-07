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

/** A pretend Internet: every URL the crawler may request, and the requests it made. */
function fakeWeb(pages: Record<string, Page>) {
  const requests: { url: string; userAgent: string | null }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, userAgent: new Headers(init?.headers).get("user-agent") });
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
  const web = fakeWeb(options.pages);
  const jobOffers = memoryJobOffers(options.existing);
  const discovery = createJobDiscovery({ ai, jobOffers, fetch: web.fetch });
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
});
