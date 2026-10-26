/**
 * The Search providers' typed settings (#398, ADR-0043), Platform Settings that replace AI_WEB_SEARCH_MODEL:
 * Perplexity's search type and queries per call, Brave's most pages, Tavily's depth. AI_WEB_SEARCH_MODEL is
 * still read for one release, when it names what the provider offers and its own setting is not set.
 */
import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it, vi } from "vitest";
import { AI_ROUTING_SETTINGS, createAiLayerFromEnv } from "./env";
import { AiConfigError } from "./errors";
import { createMemoryUsageLog } from "./testing";

const criteria: SearchCriteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

/** Answers every Search provider with no results, and keeps what each request asked. */
function searchFetch() {
  const asked: { host: string; body: Record<string, unknown> | null; params: Record<string, string> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    asked.push({ host: url.hostname, body: text ? JSON.parse(text) : null, params: Object.fromEntries(url.searchParams) });
    return new Response(JSON.stringify({ results: [], web: { results: [] } }), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const keys = { AWS_BEARER_TOKEN_BEDROCK: "b", PERPLEXITY_API_KEY: "pk", BRAVE_SEARCH_API_KEY: "bk", TAVILY_API_KEY: "tk" };
const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

describe("the Search providers' typed settings", () => {
  it("are AI routing Platform Settings with their code defaults and bounds", () => {
    const byName = Object.fromEntries(AI_ROUTING_SETTINGS.map((setting) => [setting.name, setting]));
    expect(byName.PERPLEXITY_SEARCH_TYPE).toEqual({ name: "PERPLEXITY_SEARCH_TYPE", default: "fast", values: ["fast", "web"] });
    expect(byName.PERPLEXITY_QUERIES_PER_CALL).toEqual({ name: "PERPLEXITY_QUERIES_PER_CALL", default: "5", range: { min: 1, max: 5 } });
    expect(byName.BRAVE_MAX_PAGES).toEqual({ name: "BRAVE_MAX_PAGES", default: "10", range: { min: 1, max: 10 } });
    expect(byName.TAVILY_SEARCH_DEPTH).toEqual({ name: "TAVILY_SEARCH_DEPTH", default: "basic", values: ["basic", "advanced", "fast", "ultra-fast"] });
  });

  it("set Perplexity's search type and queries per call", async () => {
    const { fetch, asked } = searchFetch();
    const ai = createAiLayerFromEnv({ ...keys, PERPLEXITY_SEARCH_TYPE: "web", PERPLEXITY_QUERIES_PER_CALL: "2" }, { fetch, usage: createMemoryUsageLog() });

    const plan = await ai.planJobSearch({ candidateId: "c", criteria });
    await ai.searchWeb({ candidateId: "c", criteria });

    expect(plan.queriesPerCall).toBe(2);
    expect(asked.find((request) => request.host === "api.perplexity.ai")?.body).toMatchObject({ search_type: "web" });
  });

  it("set Brave's most pages", async () => {
    const { fetch } = searchFetch();
    const ai = createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_PROVIDER: "brave", BRAVE_MAX_PAGES: "3" }, { fetch, usage: createMemoryUsageLog() });
    expect((await ai.planJobSearch({ candidateId: "c", criteria })).pages).toBe(3);
  });

  it("set Tavily's depth", async () => {
    const { fetch, asked } = searchFetch();
    const ai = createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_PROVIDER: "tavily", TAVILY_SEARCH_DEPTH: "advanced" }, { fetch, usage: createMemoryUsageLog() });

    await ai.searchWeb({ candidateId: "c", criteria });

    expect(asked[0]!.body).toMatchObject({ search_depth: "advanced" });
  });

  it.each([
    ["PERPLEXITY_QUERIES_PER_CALL", "6"],
    ["PERPLEXITY_QUERIES_PER_CALL", "2.5"],
    ["BRAVE_MAX_PAGES", "0"],
    ["PERPLEXITY_SEARCH_TYPE", "pro"],
    ["TAVILY_SEARCH_DEPTH", "deep"],
  ])("refuse %s=%s at start-up", (name, value) => {
    expect(() => createAiLayerFromEnv({ ...keys, [name]: value }, { usage: createMemoryUsageLog() })).toThrow(AiConfigError);
  });

  describe("AI_WEB_SEARCH_MODEL, read for one more release", () => {
    it("still sets the search type or depth, with a warning to use the provider's own setting", async () => {
      const warn = quiet();
      const { fetch, asked } = searchFetch();
      const ai = createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_PROVIDER: "tavily", AI_WEB_SEARCH_MODEL: "advanced" }, { fetch, usage: createMemoryUsageLog() });

      await ai.searchWeb({ candidateId: "c", criteria });

      expect(asked[0]!.body).toMatchObject({ search_depth: "advanced" });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/AI_WEB_SEARCH_MODEL.*TAVILY_SEARCH_DEPTH/));
      warn.mockRestore();
    });

    it("gives way to the provider's own setting when both are set", async () => {
      const warn = quiet();
      const { fetch, asked } = searchFetch();
      const ai = createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_MODEL: "web", PERPLEXITY_SEARCH_TYPE: "fast" }, { fetch, usage: createMemoryUsageLog() });

      await ai.searchWeb({ candidateId: "c", criteria });

      expect(asked[0]!.body).toMatchObject({ search_type: "fast" });
      warn.mockRestore();
    });

    it("is ignored, with a warning, when it names what the provider does not offer (an Agent API model)", async () => {
      const warn = quiet();
      const { fetch, asked } = searchFetch();
      const ai = createAiLayerFromEnv({ ...keys, AI_WEB_SEARCH_MODEL: "perplexity/sonar" }, { fetch, usage: createMemoryUsageLog() });

      await ai.searchWeb({ candidateId: "c", criteria });

      expect(asked[0]!.body).toMatchObject({ search_type: "fast" });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/AI_WEB_SEARCH_MODEL.*ignored/));
      warn.mockRestore();
    });
  });
});
