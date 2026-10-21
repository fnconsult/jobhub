import { describe, expect, it } from "vitest";
import { externalApiProvidersOf, TOOL_CATEGORIES, TOOLS, toolById, toolOfUsage, toolsByCategory } from "./tools";

describe("the Tools", () => {
  it("are every external tool the app calls, grouped by category in the Back Office's order", () => {
    expect(toolsByCategory().map(({ category, tools }) => [category, tools.map((tool) => tool.id)])).toEqual([
      ["ai_model", ["anthropic", "anthropic-bedrock", "anthropic-vertex", "mistral", "openai"]],
      ["web_search", ["perplexity", "brave", "tavily", "linkup"]],
      ["job_discovery", ["france-travail", "greenhouse", "lever", "ashby", "apec", "job-site"]],
      ["company_data", ["recherche-entreprises"]],
      ["contact_enrichment", ["lusha", "kaspr", "apollo"]],
      ["billing", ["stripe"]],
      ["mail", ["brevo-api", "brevo-smtp"]],
      ["sign_in", ["google", "apple", "microsoft", "oidc"]],
      ["geolocation", ["geo-api-gouv"]],
      ["reference_data", ["insee-naf", "rome-open-data"]],
    ]);
  });

  it("leave no category empty", () => {
    expect(toolsByCategory().map(({ category }) => category)).toEqual([...TOOL_CATEGORIES]);
  });

  it("each have a unique id, a name and a purpose in French and in English", () => {
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(tool.name, tool.id).not.toBe("");
      expect(tool.purpose.fr, tool.id).not.toBe("");
      expect(tool.purpose.en, tool.id).not.toBe("");
      expect(tool.purpose.fr, tool.id).not.toBe(tool.purpose.en);
    }
  });

  it("say where they process data, without claiming the EU where it was not established", () => {
    expect(toolById("mistral")?.residency).toBe("eu");
    expect(toolById("anthropic")?.residency).toBe("outside_eu");
    expect(toolById("anthropic-bedrock")?.residency).toBe("eu");
    expect(toolById("perplexity")?.residency).toBe("outside_eu");
    expect(toolById("stripe")?.residency).toBe("outside_eu");
    expect(toolById("brevo-api")?.residency).toBe("unknown");
    expect(toolById("oidc")?.residency).toBe("unknown");
  });

  it("name the keys they need, none for the public APIs", () => {
    expect(toolById("france-travail")?.keys).toEqual(["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"]);
    expect(toolById("brave")?.keys).toEqual(["BRAVE_SEARCH_API_KEY"]);
    expect(toolById("greenhouse")?.keys).toEqual([]);
    expect(toolById("recherche-entreprises")?.keys).toEqual([]);
    expect(toolById("geo-api-gouv")?.keys).toEqual([]);
    expect(toolById("insee-naf")?.keys).toEqual([]);
    expect(toolById("rome-open-data")?.keys).toEqual([]);
  });

  it("are unknown by any other id", () => {
    expect(toolById("linkedin")).toBeUndefined();
    expect(toolById("toString")).toBeUndefined();
  });
});

describe("the Tool a recorded call was made to", () => {
  it("is found by its external API provider id", () => {
    expect(toolOfUsage({ table: "external_api_usage", provider: "france_travail" })?.id).toBe("france-travail");
    expect(toolOfUsage({ table: "external_api_usage", provider: "recherche_entreprises" })?.id).toBe("recherche-entreprises");
    expect(toolOfUsage({ table: "external_api_usage", provider: "lusha" })?.id).toBe("lusha");
    expect(toolOfUsage({ table: "external_api_usage", provider: "job_site" })?.id).toBe("job-site");
    expect(toolOfUsage({ table: "external_api_usage", provider: "geo-api-gouv" })?.id).toBe("geo-api-gouv");
    expect(toolOfUsage({ table: "external_api_usage", provider: "insee-naf" })?.id).toBe("insee-naf");
    expect(toolOfUsage({ table: "external_api_usage", provider: "rome-open-data" })?.id).toBe("rome-open-data");
  });

  it("is found, for an AI Tool, by the provider id its key's connection tests are recorded under", () => {
    expect(toolOfUsage({ table: "external_api_usage", provider: "mistral" })?.id).toBe("mistral");
    expect(toolOfUsage({ table: "external_api_usage", provider: "anthropic" })?.id).toBe("anthropic");
    expect(toolOfUsage({ table: "external_api_usage", provider: "anthropic_bedrock" })?.id).toBe("anthropic-bedrock");
    expect(toolOfUsage({ table: "external_api_usage", provider: "perplexity" })?.id).toBe("perplexity");
  });

  it("is found by its AI provider id and, for Claude, the endpoint that served it", () => {
    expect(toolOfUsage({ table: "ai_usage", provider: "mistral", endpoint: "api.mistral.ai" })?.id).toBe("mistral");
    expect(toolOfUsage({ table: "ai_usage", provider: "anthropic", endpoint: "api.anthropic.com" })?.id).toBe("anthropic");
    expect(toolOfUsage({ table: "ai_usage", provider: "anthropic", endpoint: "bedrock eu-west-3" })?.id).toBe("anthropic-bedrock");
    expect(toolOfUsage({ table: "ai_usage", provider: "anthropic", endpoint: "vertex europe-west1" })?.id).toBe("anthropic-vertex");
  });

  it("is none for a provider not registered, or an id of the other table", () => {
    expect(toolOfUsage({ table: "external_api_usage", provider: "unknown_api" })).toBeUndefined();
    expect(toolOfUsage({ table: "external_api_usage", provider: "openai" })).toBeUndefined();
    expect(toolOfUsage({ table: "ai_usage", provider: "france_travail", endpoint: "x" })).toBeUndefined();
  });

  it("is never two Tools", () => {
    const usages = TOOLS.flatMap((tool) => (tool.usage ? [`${tool.usage.table}:${tool.usage.provider}:${"endpoint" in tool.usage ? tool.usage.endpoint : ""}`] : []));
    const external = TOOLS.flatMap((tool) => externalApiProvidersOf(tool));
    expect(new Set(usages).size).toBe(usages.length);
    expect(new Set(external).size).toBe(external.length);
  });

  it("records a Tool's calls outside ai_usage under its external API provider ids", () => {
    expect(externalApiProvidersOf(toolById("stripe")!)).toEqual(["stripe"]);
    expect(externalApiProvidersOf(toolById("mistral")!)).toEqual(["mistral"]);
    expect(externalApiProvidersOf(toolById("openai")!)).toEqual([]);
  });
});
