/**
 * Live contract check of the Perplexity provider against the real Search API
 * (`POST https://api.perplexity.ai/search`). It costs a search, so it only runs when asked,
 * and is skipped without a key:
 *
 *   PERPLEXITY_LIVE=1 PERPLEXITY_API_KEY=... npx vitest run packages/ai/src/providers/perplexity.live.test.ts
 *
 * It sends the requests `searchWeb` sends (search type fast, a country, a recency window, forbidden sites
 * excluded), one query and then two in one call, and fails on any HTTP 4xx. It saves the raw reply of
 * the two-query call to fixtures/perplexity-search.recorded.json (key-free), which providers.test.ts then
 * parses too: commit it as the recorded fixture, and read it for the multi-query shape (flat or grouped).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPerplexityProvider } from "./perplexity";

const apiKey = process.env.PERPLEXITY_API_KEY;
const live = process.env.PERPLEXITY_LIVE === "1" && !!apiKey;
const recorded = new URL("./fixtures/perplexity-search.recorded.json", import.meta.url);
const filters = { country: "FR", maxAgeDays: 30, excludeDomains: ["linkedin.com", "indeed.com"] };

describe.skipIf(!live)("Perplexity provider, live Search API (PERPLEXITY_LIVE=1 and PERPLEXITY_API_KEY)", () => {
  it("searches one query and returns page URLs as sources, with no tokens", { timeout: 60_000 }, async () => {
    const output = await createPerplexityProvider({ apiKey: apiKey! }).search!("Offres d'emploi « Directeur administratif et financier » CDI à Lyon", { filters });

    expect(output.sources.length).toBeGreaterThan(0);
    for (const source of output.sources) expect(source).toMatch(/^https?:\/\//);
    expect(output.model).toBe("fast");
    expect(output.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("searches two queries in one call", { timeout: 60_000 }, async () => {
    let raw: unknown;
    const recordingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok) raw = await response.clone().json().catch(() => undefined);
      return response;
    };

    const output = await createPerplexityProvider({ apiKey: apiKey!, fetch: recordingFetch }).search!(
      ["Offres d'emploi « Directeur administratif et financier » CDI à Lyon", "Chief Financial Officer job offers in Lyon"],
      { filters },
    );

    if (raw) writeFileSync(recorded, `${JSON.stringify(raw, null, 2)}\n`);
    expect(output.sources.length).toBeGreaterThan(0);
    expect(output.tools).toEqual([{ name: "web_search", count: 1 }]);
  });
});
