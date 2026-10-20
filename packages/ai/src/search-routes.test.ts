import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { AiConfigError } from "./errors";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const criteria: SearchCriteria = { targetRole: "Directeur Financier", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [] };

/**
 * A task Playbook's web-search provider (ADR-0026): its searches go to the provider and model (or depth)
 * it names, any web-search provider configured, instead of the configured `web_search` route.
 */
function setUp() {
  const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu" });
  const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu", models: ["basic", "advanced"] });
  const brave = createFakeProvider({ id: "brave", residency: "outside_eu", pages: 10 });
  const mistral = { ...createFakeProvider({ id: "mistral", reply: "{}" }), search: undefined };
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({
    providers: [perplexity, tavily, brave, mistral],
    routes: { web_search: { provider: "perplexity", model: "sonar-pro" }, job_titles: "mistral" },
    usage,
    warn: () => {},
  });
  return { ai, perplexity, tavily, brave, usage };
}

describe("a web search on a route of its own (ADR-0026)", () => {
  it("goes to the provider and model it names, and is recorded as such", async () => {
    const { ai, perplexity, tavily, usage } = setUp();

    await ai.searchWeb({ candidateId: "c", criteria, route: { provider: "tavily", model: "advanced" } });
    await ai.searchCompany({ candidateId: "c", employer: "Acme", route: { provider: "tavily" } });

    expect(tavily.searches.map((search) => search.model)).toEqual(["advanced", undefined]);
    expect(perplexity.searches).toHaveLength(0);
    expect(usage.entries.map((entry) => [entry.task, entry.provider, entry.model])).toEqual([
      ["web_search", "tavily", "advanced"],
      ["web_search", "tavily", "fake-tavily"],
    ]);
  });

  it("goes to the configured web-search route without one", async () => {
    const { ai, perplexity } = setUp();

    await ai.searchCompany({ candidateId: "c", employer: "Acme" });

    expect(perplexity.searches[0]!.model).toBe("sonar-pro");
  });

  it("searches Company News on it", async () => {
    const { ai, brave, perplexity } = setUp();

    await ai.searchCompanyNews({ candidateId: "c", employer: "Acme", route: { provider: "brave" } });

    expect(brave.searches).toHaveLength(1);
    expect(perplexity.searches).toHaveLength(0);
  });

  it("plans a Job Search's paging for the provider its searches go to", async () => {
    const { ai } = setUp();

    expect((await ai.planJobSearch({ candidateId: "c", criteria })).pages).toBe(1);
    expect((await ai.planJobSearch({ candidateId: "c", criteria, route: { provider: "brave" } })).pages).toBe(10);
  });

  it("refuses a provider that cannot search, or is not configured", async () => {
    const { ai } = setUp();

    await expect(ai.searchCompany({ candidateId: "c", employer: "Acme", route: { provider: "mistral" } })).rejects.toThrow(AiConfigError);
    await expect(ai.searchCompany({ candidateId: "c", employer: "Acme", route: { provider: "linkup" } })).rejects.toThrow(AiConfigError);
  });
});

describe("the web-search providers a task Playbook may choose (ADR-0026)", () => {
  it("are every web-search provider configured, the configured model first for its provider, marked outside the EU", () => {
    const { ai } = setUp();

    expect(ai.searchModels()).toEqual([
      {
        provider: "perplexity",
        endpoint: "fake perplexity",
        residency: "outside_eu",
        defaultModel: "fake-perplexity",
        models: [
          { model: "sonar-pro", effort: "ignored", residency: "outside_eu" },
          { model: "fake-perplexity", effort: "ignored", residency: "outside_eu" },
        ],
      },
      {
        provider: "tavily",
        endpoint: "fake tavily",
        residency: "outside_eu",
        defaultModel: "fake-tavily",
        models: [
          { model: "basic", effort: "ignored", residency: "outside_eu" },
          { model: "advanced", effort: "ignored", residency: "outside_eu" },
        ],
      },
      { provider: "brave", endpoint: "fake brave", residency: "outside_eu", defaultModel: "fake-brave", models: [{ model: "fake-brave", effort: "ignored", residency: "outside_eu" }] },
    ]);
  });
});
