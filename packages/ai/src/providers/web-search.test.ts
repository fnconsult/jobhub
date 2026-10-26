/**
 * Contract tests of the Brave and Tavily Search provider adapters.
 * Every reply is a fixture: HAND-WRITTEN from each API reference (docs/research/issue-110.md),
 * or recorded by web-search.live.test.ts (…recorded.json, checked when present). No live call.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBraveProvider } from "./brave";
import { createTavilyProvider } from "./tavily";

interface Captured {
  method: string;
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

/** A fetch that records the request and answers with a canned JSON body. */
function fakeFetch(response: unknown, status = 200) {
  const requests: Captured[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    requests.push({ method: request.method, url: new URL(request.url), headers: request.headers, body: text ? JSON.parse(text) : undefined });
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const recordedUrl = (name: string) => new URL(`./fixtures/${name}.recorded.json`, import.meta.url);

const query = "Offre d'emploi « DAF » à Lyon";

describe("Tavily provider", () => {
  const reply = fixture("tavily-search");

  it("searches with nothing but the query, its key and the result count", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createTavilyProvider({ apiKey: "tvly-key", fetch });

    await provider.search!(query, {});

    expect(provider.id).toBe("tavily");
    expect(provider.residency).toBe("outside_eu");
    expect(provider.generate).toBeUndefined();
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url.href).toBe("https://api.tavily.com/search");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer tvly-key");
    expect(requests[0]!.body).toEqual({ query, search_depth: "basic", max_results: 20, include_published_date: true });
  });

  it("maps the results to sources (each once) and lists them in the answer", async () => {
    const { fetch } = fakeFetch(reply);

    const output = await createTavilyProvider({ apiKey: "k", fetch }).search!(query, {});

    expect(output).toEqual({
      answer:
        "DAF H/F - CDI - Lyon | Acme Industrie\nhttps://carrieres.acme-industrie.example/offres/daf-lyon\nAcme Industrie recrute son Directeur administratif et financier (H/F) en CDI à Lyon.\n\n" +
        "Directeur financier H/F\nhttps://www.cadremploi.example/emploi/daf-lyon-123\nGroupe industriel lyonnais, poste de DAF rattaché au Président.",
      sources: ["https://carrieres.acme-industrie.example/offres/daf-lyon", "https://www.cadremploi.example/emploi/daf-lyon-123"],
      sourceDates: { "https://carrieres.acme-industrie.example/offres/daf-lyon": new Date("2026-10-02T00:00:00Z") },
      model: "basic",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("applies domain filters and a freshness window as Tavily's own filters", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createTavilyProvider({ apiKey: "k", fetch, now: () => new Date("2026-10-12T08:00:00Z") });

    await provider.search!(query, {
      model: "advanced",
      filters: { includeDomains: ["cadremploi.fr", "apec.fr"], excludeDomains: ["indeed.fr"], maxAgeDays: 30 },
    });

    expect(requests[0]!.body).toEqual({
      query,
      search_depth: "advanced",
      max_results: 20,
      include_published_date: true,
      include_domains: ["cadremploi.fr", "apec.fr"],
      exclude_domains: ["indeed.fr"],
      start_date: "2026-09-12",
    });
  });

  it("reads Tavily's published dates in their RFC 1123 form too, and never asks it to drop undated pages (#116)", async () => {
    const results = [
      { title: "A", url: "https://a.example/offre", content: "a", published_date: "Tue, 06 Oct 2026 17:00:00 GMT" },
      { title: "B", url: "https://b.example/offre", content: "b", published_date: "la semaine dernière" },
    ];
    const { fetch, requests } = fakeFetch({ results });

    const output = await createTavilyProvider({ apiKey: "k", fetch }).search!(query, { filters: { maxAgeDays: 30 } });

    expect(output.sourceDates).toEqual({ "https://a.example/offre": new Date("2026-10-06T17:00:00Z") });
    expect(requests[0]!.body).not.toHaveProperty("filter_by_published_date");
  });

  it("favours a country by its lowercase English name, which Tavily takes for general searches", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createTavilyProvider({ apiKey: "k", fetch });

    await provider.search!(query, { filters: { country: "FR" } });
    await provider.search!(query, { filters: { country: "gb" } });

    expect(requests.map((request) => request.body)).toEqual([
      expect.objectContaining({ country: "france", topic: "general" }),
      expect.objectContaining({ country: "united kingdom", topic: "general" }),
    ]);
  });

  it("sends no country it cannot name, rather than one Tavily would refuse", async () => {
    const { fetch, requests } = fakeFetch(reply);

    await createTavilyProvider({ apiKey: "k", fetch }).search!(query, { filters: { country: "ZZ" } });

    expect(requests[0]!.body).not.toHaveProperty("country");
  });

  it("asks for the result count the filter sets, up to Tavily's 20", async () => {
    const { fetch, requests } = fakeFetch(reply);

    await createTavilyProvider({ apiKey: "k", fetch }).search!(query, { filters: { maxResults: 8 } });

    expect(requests[0]!.body).toMatchObject({ max_results: 8 });
  });

  it("declares one query and one page a call, every filter handled", () => {
    expect(createTavilyProvider({ apiKey: "k" }).searchContract).toEqual({
      queriesPerCall: 1,
      maxPages: 1,
      filters: { includeDomains: "handled", excludeDomains: "handled", country: "handled", maxAgeDays: "handled", maxResults: "handled" },
    });
  });

  it("takes its depth setting as the depth a route naming none gets", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createTavilyProvider({ apiKey: "k", fetch, depth: "advanced" });

    await provider.search!(query, {});

    expect(provider.defaultModel).toBe("advanced");
    expect(requests[0]!.body).toMatchObject({ search_depth: "advanced" });
  });

  it("raises a provider error on an HTTP failure, such as a spent plan (432)", async () => {
    const { fetch } = fakeFetch({ detail: { error: "Plan limit exceeded" } }, 432);
    await expect(createTavilyProvider({ apiKey: "k", fetch }).search!(query, {})).rejects.toMatchObject({
      name: "AiProviderError",
      provider: "tavily",
      status: 432,
    });
  });

  it.skipIf(!existsSync(recordedUrl("tavily-search")))("reads the sources of a reply recorded from the live API", async () => {
    const { fetch } = fakeFetch(fixture("tavily-search.recorded"));
    const output = await createTavilyProvider({ apiKey: "k", fetch }).search!(query, {});
    expect(output.sources.length).toBeGreaterThan(0);
  });
});

describe("Brave provider", () => {
  const reply = fixture("brave-web-search");

  it("searches with nothing but the query, its key and the result count", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createBraveProvider({ apiKey: "bk", fetch });

    await provider.search!(query, {});

    expect(provider.id).toBe("brave");
    expect(provider.residency).toBe("outside_eu");
    expect(provider.generate).toBeUndefined();
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url.origin + requests[0]!.url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(requests[0]!.headers.get("x-subscription-token")).toBe("bk");
    expect(requests[0]!.headers.get("authorization")).toBeNull();
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ q: query, count: "20" });
  });

  it("maps the web results to sources, with their descriptions as plain text in the answer", async () => {
    const { fetch } = fakeFetch(reply);

    const output = await createBraveProvider({ apiKey: "bk", fetch }).search!(query, {});

    expect(output.sources).toEqual(["https://carrieres.acme-industrie.example/offres/daf-lyon", "https://www.cadremploi.example/emploi/daf-lyon-123"]);
    expect(output.answer).toContain("Acme Industrie recrute son Directeur administratif et financier (H/F) en CDI à Lyon.");
    expect(output.model).toBe("web");
    expect(output.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("dates the sources Brave states a page age for, read as UTC (#116)", async () => {
    const { fetch } = fakeFetch(reply);

    const output = await createBraveProvider({ apiKey: "bk", fetch }).search!(query, {});

    expect(output.sourceDates).toEqual({ "https://carrieres.acme-industrie.example/offres/daf-lyon": new Date("2026-10-02T00:00:00Z") });
  });

  it("restricts to domains with site: operators in the query, and a freshness window as a date range", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createBraveProvider({ apiKey: "bk", fetch, now: () => new Date("2026-10-12T08:00:00Z") });

    await provider.search!(query, { filters: { includeDomains: ["apec.fr", "cadremploi.fr"], maxAgeDays: 30 } });

    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({
      q: `${query} site:apec.fr OR site:cadremploi.fr`,
      count: "20",
      freshness: "2026-09-12to2026-10-12",
    });
  });

  it("favours a country, and gives a further page of results by its offset, up to Brave's 10 pages", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createBraveProvider({ apiKey: "bk", fetch });

    await provider.search!(query, { filters: { country: "fr" }, page: 3 });

    expect(provider.searchContract?.maxPages).toBe(10);
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ q: query, count: "20", country: "FR", offset: "2" });
  });

  it("pages no further than its pages setting says", () => {
    expect(createBraveProvider({ apiKey: "bk", maxPages: 3 }).searchContract?.maxPages).toBe(3);
    expect(createBraveProvider({ apiKey: "bk", maxPages: 50 }).searchContract?.maxPages).toBe(10);
  });

  it("asks for the result count the filter sets, up to Brave's 20", async () => {
    const { fetch, requests } = fakeFetch(reply);
    const provider = createBraveProvider({ apiKey: "bk", fetch });

    await provider.search!(query, { filters: { maxResults: 5 } });
    await provider.search!(query, { filters: { maxResults: 50 } });

    expect(requests.map((request) => request.url.searchParams.get("count"))).toEqual(["5", "20"]);
  });

  it("declares one query a call and its excluded domains emulated: it has no such parameter", () => {
    expect(createBraveProvider({ apiKey: "bk" }).searchContract).toEqual({
      queriesPerCall: 1,
      maxPages: 10,
      filters: { includeDomains: "handled", excludeDomains: "emulated", country: "handled", maxAgeDays: "handled", maxResults: "handled" },
    });
  });

  it("emulates excluded domains: sends none, and drops the pages it returns on them or their subdomains", async () => {
    const { fetch, requests } = fakeFetch(reply);

    const output = await createBraveProvider({ apiKey: "bk", fetch }).search!(query, { filters: { excludeDomains: ["indeed.fr", "acme-industrie.example"] } });

    expect(requests[0]!.url.searchParams.get("q")).toBe(query);
    expect(output.sources).toEqual(["https://www.cadremploi.example/emploi/daf-lyon-123"]);
    expect(output.answer).not.toContain("acme-industrie");
    expect(output.sourceDates).toBeUndefined();
  });

  it("refuses more than one query a call", async () => {
    const { fetch } = fakeFetch(reply);
    await expect(createBraveProvider({ apiKey: "bk", fetch }).search!(["a", "b"], {})).rejects.toThrow(/one query/);
  });

  it("returns no sources when Brave finds no web results", async () => {
    const { fetch } = fakeFetch({ type: "search", query: { original: query } });
    await expect(createBraveProvider({ apiKey: "bk", fetch }).search!(query, {})).resolves.toMatchObject({ answer: "", sources: [] });
  });

  it("raises a provider error on an HTTP failure, such as a bad key (401)", async () => {
    const { fetch } = fakeFetch({ type: "ErrorResponse", error: { code: "SUBSCRIPTION_TOKEN_INVALID" } }, 401);
    await expect(createBraveProvider({ apiKey: "bk", fetch }).search!(query, {})).rejects.toMatchObject({
      name: "AiProviderError",
      provider: "brave",
      status: 401,
    });
  });

  it.skipIf(!existsSync(recordedUrl("brave-web-search")))("reads the sources of a reply recorded from the live API", async () => {
    const { fetch } = fakeFetch(fixture("brave-web-search.recorded"));
    const output = await createBraveProvider({ apiKey: "bk", fetch }).search!(query, {});
    expect(output.sources.length).toBeGreaterThan(0);
  });
});
