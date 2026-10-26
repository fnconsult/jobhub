/**
 * Live contract check of the Brave and Tavily Search provider adapters against the real APIs.
 * Each search costs a request, so a provider only runs when asked, with its key:
 *
 *   WEB_SEARCH_LIVE=1 BRAVE_SEARCH_API_KEY=... TAVILY_API_KEY=... \
 *     npx vitest run packages/ai/src/providers/web-search.live.test.ts
 *
 * Each sends the request `searchWeb` sends (with a 30-day freshness window) and saves the
 * raw reply to fixtures/<provider>-….recorded.json (key-free), which web-search.test.ts
 * then parses too: commit them as the recorded fixtures.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AiProvider } from "../types";
import { createBraveProvider } from "./brave";
import { createTavilyProvider } from "./tavily";

type Create = (options: { apiKey: string; fetch: typeof globalThis.fetch }) => AiProvider;

const PROVIDERS: { name: string; key: string; fixture: string; create: Create }[] = [
  { name: "Brave", key: "BRAVE_SEARCH_API_KEY", fixture: "brave-web-search", create: createBraveProvider },
  { name: "Tavily", key: "TAVILY_API_KEY", fixture: "tavily-search", create: createTavilyProvider },
];

for (const { name, key, fixture, create } of PROVIDERS) {
  const apiKey = process.env[key];
  const live = process.env.WEB_SEARCH_LIVE === "1" && !!apiKey;

  describe.skipIf(!live)(`${name} provider, live (WEB_SEARCH_LIVE=1 and ${key})`, () => {
    it("searches the web and returns page URLs as sources", { timeout: 60_000 }, async () => {
      let raw: unknown;
      const recordingFetch: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        if (response.ok) raw = await response.clone().json().catch(() => undefined);
        return response;
      };

      const output = await create({ apiKey: apiKey!, fetch: recordingFetch }).search!(
        "Offres d'emploi « Directeur administratif et financier » CDI à Lyon",
        { filters: { maxAgeDays: 30 } },
      );

      if (raw) writeFileSync(new URL(`./fixtures/${fixture}.recorded.json`, import.meta.url), `${JSON.stringify(raw, null, 2)}\n`);
      expect(output.sources.length).toBeGreaterThan(0);
      for (const source of output.sources) expect(source).toMatch(/^https?:\/\//);
    });
  });
}
