/**
 * Contract tests of the search-only web search adapters (Brave, Tavily, Linkup).
 * Every reply is a fixture: HAND-WRITTEN from each API reference (docs/research/issue-110.md),
 * or recorded by web-search.live.test.ts (…recorded.json, checked when present). No live call.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

const query = "Offres d'emploi « DAF » à Lyon";

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
    expect(requests[0]!.body).toEqual({ query, search_depth: "basic", max_results: 20 });
  });

  it("maps the results to sources (each once) and lists them in the answer", async () => {
    const { fetch } = fakeFetch(reply);

    const output = await createTavilyProvider({ apiKey: "k", fetch }).search!(query, {});

    expect(output).toEqual({
      answer:
        "DAF H/F - CDI - Lyon | Acme Industrie\nhttps://carrieres.acme-industrie.example/offres/daf-lyon\nAcme Industrie recrute son Directeur administratif et financier (H/F) en CDI à Lyon.\n\n" +
        "Directeur financier H/F\nhttps://www.cadremploi.example/emploi/daf-lyon-123\nGroupe industriel lyonnais, poste de DAF rattaché au Président.",
      sources: ["https://carrieres.acme-industrie.example/offres/daf-lyon", "https://www.cadremploi.example/emploi/daf-lyon-123"],
      model: "basic",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });
});
