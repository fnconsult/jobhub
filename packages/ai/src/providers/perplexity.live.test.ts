/**
 * Live contract check of the Perplexity provider against the real Agent API
 * (`POST https://api.perplexity.ai/v1/responses`). It costs a search, so it only
 * runs when asked:
 *
 *   PERPLEXITY_LIVE=1 PERPLEXITY_API_KEY=... [AI_WEB_SEARCH_MODEL=provider/model] \
 *     npx vitest run packages/ai/src/providers/perplexity.live.test.ts
 *
 * It sends the exact request `searchWeb` sends (preset 'fast', web_search,
 * max_output_tokens, store:false, and the model only when configured) and fails
 * on any HTTP 4xx or a status other than 'completed'. It also saves the raw reply
 * to fixtures/perplexity-responses-search.recorded.json (key-free), which
 * providers.test.ts then parses too: commit it as the recorded fixture.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPerplexityProvider } from "./perplexity";

const apiKey = process.env.PERPLEXITY_API_KEY;
const live = process.env.PERPLEXITY_LIVE === "1" && !!apiKey;
const recorded = new URL("./fixtures/perplexity-responses-search.recorded.json", import.meta.url);

describe.skipIf(!live)("Perplexity provider, live (PERPLEXITY_LIVE=1 and PERPLEXITY_API_KEY)", () => {
  it("searches the web over the Agent API and returns an answer, sources and token usage", { timeout: 60_000 }, async () => {
    let raw: unknown;
    const recordingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok) raw = await response.clone().json().catch(() => undefined);
      return response;
    };
    const model = process.env.AI_WEB_SEARCH_MODEL || undefined;

    const output = await createPerplexityProvider({ apiKey: apiKey!, fetch: recordingFetch }).search!(
      "Offres d'emploi « Directeur administratif et financier » CDI à Lyon",
      model ? { model } : {},
    );

    if (raw) writeFileSync(recorded, `${JSON.stringify(raw, null, 2)}\n`);
    expect(output.answer.trim()).not.toBe("");
    expect(output.sources.length).toBeGreaterThan(0);
    for (const source of output.sources) expect(source).toMatch(/^https?:\/\//);
    expect(output.model).toMatch(/\//);
    expect(output.usage.inputTokens).toBeGreaterThan(0);
    expect(output.usage.outputTokens).toBeGreaterThan(0);
  });
});
