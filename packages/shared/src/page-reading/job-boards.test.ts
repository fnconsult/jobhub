import type { ExternalApiCall } from "../external-api-usage";
import { describe, expect, it } from "vitest";
import { pageReadTool, recordingSiteFetch, registrableDomain } from "./polite-fetch";

const answering = (async () => new Response("{}")) as unknown as typeof globalThis.fetch;

describe("the calls Job discovery and the source re-check make to sites, as recorded", () => {
  it("records the calls to the job boards' APIs and pages (Greenhouse, Lever, Ashby, APEC) as free external API calls (#218)", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingSiteFetch(answering, { record: (call) => void calls.push(call) });

    for (const url of [
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
      "https://api.lever.co/v0/postings/acme/abc",
      "https://api.ashbyhq.com/posting-api/job-board/acme",
      "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/178",
    ]) {
      await fetch(url, {});
    }

    expect(calls.map(({ provider, operation, costEur }) => [provider, operation, costEur])).toEqual([
      ["greenhouse", "GET /v1/boards/acme/jobs/123", 0],
      ["lever", "GET /v0/postings/acme/abc", 0],
      ["ashby", "GET /posting-api/job-board/acme", 0],
      ["apec", "GET /candidat/recherche-emploi.html/emploi/detail-offre/178", 0],
    ]);
  });

  it("records a page read on any other site under job_site, by the site's registrable domain alone: no URL (#234)", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = recordingSiteFetch(
      async (input) => new Response("", { status: String(input).includes("gone") ? 404 : 200 }),
      { record: (call) => void calls.push(call) },
    );

    await fetch("https://careers.acme.example/jobs/daf-marie-dupont?ref=marie@example.com", {});
    await fetch("https://jobs.bbc.co.uk/gone/42", {});
    await fetch("https://www.welcometothejungle.com/robots.txt", {});

    expect(calls.map(({ provider, operation, ok, httpStatus, costEur }) => [provider, operation, ok, httpStatus, costEur])).toEqual([
      ["job_site", "page_read acme.example", true, 200, 0],
      ["job_site", "page_read bbc.co.uk", false, 404, 0],
      ["job_site", "page_read welcometothejungle.com", true, 200, 0],
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/careers|jobs\/|daf|marie|ref=|robots/);
  });

  it("reads the page even when its read cannot be recorded", async () => {
    const fetch = recordingSiteFetch(answering, { record: () => Promise.reject(new Error("insert failed")) });
    const warn = console.warn;
    console.warn = () => {};
    try {
      await expect(fetch("https://careers.acme.example/jobs/1", {})).resolves.toBeInstanceOf(Response);
    } finally {
      console.warn = warn;
    }
  });
});

describe("a site's registrable domain", () => {
  it.each([
    ["www.welcometothejungle.com", "welcometothejungle.com"],
    ["careers.acme.fr", "acme.fr"],
    ["acme.fr", "acme.fr"],
    ["jobs.bbc.co.uk", "bbc.co.uk"],
    ["emploi.travail-emploi.gouv.fr", "travail-emploi.gouv.fr"],
    ["www.seek.com.au", "seek.com.au"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["WWW.Acme.FR.", "acme.fr"],
  ])("%s: %s", (host, domain) => {
    expect(registrableDomain(host)).toBe(domain);
  });
});

describe("the Tool reading a page, as a Job Offer's Provenance names it (#329)", () => {
  it("is APEC for its offer pages, and the job sites' for any other page", () => {
    expect(pageReadTool("https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/178")).toBe("apec");
    expect(pageReadTool("https://carrieres.groupe-seb.fr/offres/daf")).toBe("job-site");
    expect(pageReadTool("https://notapec.fr/offre")).toBe("job-site");
    expect(pageReadTool("not a url")).toBe("job-site");
  });
});
