import { describe, expect, it } from "vitest";
import { externalApiProvidersOf, isRecipientOutsideEu, TOOL_CATEGORIES, TOOLS, toolById, toolOfUsage, toolsByCategory } from "./tools";

describe("the Tools", () => {
  it("are every external tool the app calls, grouped by category in the Back Office's order", () => {
    expect(toolsByCategory().map(({ category, tools }) => [category, tools.map((tool) => tool.id)])).toEqual([
      ["ai_model", ["anthropic", "anthropic-bedrock", "anthropic-vertex", "mistral", "openai"]],
      ["web_search", ["perplexity", "brave", "tavily"]],
      ["job_discovery", ["france-travail", "fantastic-jobs", "greenhouse", "lever", "ashby", "apec", "job-site", "email-intake"]],
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
    // Email intake's reading of an email runs in the EU (ADR-0052): Brevo receives it on its EU servers.
    expect(toolById("email-intake")?.residency).toBe("eu");
    expect(toolById("oidc")?.residency).toBe("unknown");
  });

  it("say whether they receive personal data, or queries drawn from it: a recipient (ADR-0064)", () => {
    const recipients = TOOLS.filter((tool) => tool.receivesPersonalData).map((tool) => tool.id);
    expect(recipients).toEqual([
      "anthropic",
      "anthropic-bedrock",
      "anthropic-vertex",
      "mistral",
      "openai",
      "perplexity",
      "brave",
      "tavily",
      "lusha",
      "kaspr",
      "apollo",
      "stripe",
      "brevo-api",
      "brevo-smtp",
      "brevo-inbound",
      "google",
      "apple",
      "microsoft",
      "oidc",
    ]);
  });

  it("are a recipient outside the EU when they receive personal data outside it, or where it was not established (#548)", () => {
    const outside = (id: string) => isRecipientOutsideEu(toolById(id)!);
    expect(outside("anthropic")).toBe(true);
    expect(outside("perplexity")).toBe(true);
    expect(outside("stripe")).toBe(true);
    // Not established counts as outside the EU.
    expect(outside("brevo-api")).toBe(true);
    expect(outside("kaspr")).toBe(true);
    // In the EU.
    expect(outside("mistral")).toBe(false);
    expect(outside("anthropic-bedrock")).toBe(false);
    // Outside the EU or not established, but sent no personal data.
    expect(outside("greenhouse")).toBe(false);
    expect(outside("job-site")).toBe(false);
  });

  it("name the keys they need, none for the public APIs", () => {
    expect(toolById("france-travail")?.keys).toEqual(["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"]);
    expect(toolById("brave")?.keys).toEqual(["BRAVE_SEARCH_API_KEY"]);
    expect(toolById("greenhouse")?.keys).toEqual([]);
    expect(toolById("recherche-entreprises")?.keys).toEqual([]);
    expect(toolById("geo-api-gouv")?.keys).toEqual([]);
    expect(toolById("insee-naf")?.keys).toEqual([]);
    expect(toolById("rome-open-data")?.keys).toEqual([]);
    // Email intake's door takes an email only with the secret its MTA sends (#442, #580).
    expect(toolById("email-intake")?.keys).toEqual(["EMAIL_INTAKE_INBOUND_SECRET"]);
  });

  it("name the Platform Settings they depend on, none for most", () => {
    const names = (id: string) => (toolById(id)?.settings ?? []).map((setting) => setting.name);
    expect(names("anthropic")).toEqual(["ANTHROPIC_ENDPOINT"]);
    expect(names("anthropic-bedrock")).toEqual(["ANTHROPIC_ENDPOINT", "BEDROCK_REGION"]);
    expect(names("anthropic-vertex")).toEqual(["ANTHROPIC_ENDPOINT", "VERTEX_REGION", "VERTEX_PROJECT_ID"]);
    expect(names("openai")).toEqual(["OPENAI_DATA_RESIDENCY"]);
    expect(names("mistral")).toEqual(["AI_IDENTITY_MODEL"]);
    const search = ["AI_WEB_SEARCH_PROVIDER", "AI_WEB_SEARCH_FALLBACK_PROVIDER"];
    // And the filters Job discovery sends every Search provider (#402).
    const filters = ["JOB_DISCOVERY_COUNTRY", "JOB_DISCOVERY_MAX_POSTING_AGE_DAYS", "JOB_DISCOVERY_RESULTS_PER_QUERY"];
    // Each with the price of its billed unit (#403).
    expect(names("perplexity")).toEqual([...search, "PERPLEXITY_SEARCH_TYPE", "PERPLEXITY_QUERIES_PER_CALL", "AI_WEB_SEARCH_MODEL", "PERPLEXITY_FAST_SEARCH_PRICE_USD", "PERPLEXITY_SEARCH_PRICE_USD", ...filters]);
    expect(names("brave")).toEqual([...search, "BRAVE_MAX_PAGES", "BRAVE_SEARCH_PRICE_USD", ...filters]);
    expect(names("tavily")).toEqual([...search, "TAVILY_SEARCH_DEPTH", "AI_WEB_SEARCH_MODEL", "TAVILY_CREDIT_PRICE_USD", ...filters]);
    expect(names("brevo-api")).toEqual(["MAIL_FROM", "MAIL_TRANSPORT"]);
    // Jobbbox's own MTA receives the emails sent to the Forwarding addresses (#580), within Email intake's limits (#442).
    expect(names("email-intake")).toEqual(["EMAIL_INTAKE_DOMAIN", "EMAIL_INTAKE_MTA_IP_RANGES", "EMAIL_INTAKE_DAILY_CAP", "EMAIL_INTAKE_BROAD_FILTER_THRESHOLD"]);
    expect(names("brevo-smtp")).toEqual(["MAIL_FROM", "MAIL_TRANSPORT"]);
    for (const id of ["lusha", "kaspr", "apollo"]) expect(names(id), id).toEqual(["CONTACT_ENRICHMENT_PROVIDER", "CONTACT_ENRICHMENT_DPA_SIGNED"]);
    expect(names("stripe")).toEqual(["STRIPE_PRICE_STANDARD", "STRIPE_PRICE_PREMIUM", "STRIPE_PRICE_COACHING_SESSION", "STRIPE_PRICE_COACHING_SESSION_PREMIUM"]);
    const budget = ["JOB_DISCOVERY_BUDGET_JOB_OFFERS", "JOB_DISCOVERY_BUDGET_EUR", "JOB_DISCOVERY_BUDGET_SECONDS"];
    expect(names("job-site")).toEqual(budget);
    // La Bonne Boite's Target Companies (#406) are visited per the web search's settings (#402), on the Recherche web tab.
    expect(names("france-travail")).toEqual(budget);
    expect(names("greenhouse")).toEqual([]);
  });

  it("say which of their settings they cannot be called without, and which turn them off", () => {
    // Claude on Vertex is only called with ANTHROPIC_ENDPOINT=vertex, and needs its project.
    expect(toolById("anthropic-vertex")?.keys).toEqual([]);
    expect(toolById("anthropic-vertex")?.settings).toEqual([
      { name: "ANTHROPIC_ENDPOINT", enabledWhen: ["vertex"] },
      { name: "VERTEX_REGION" },
      { name: "VERTEX_PROJECT_ID", required: true },
    ]);
    // Only the chosen contact-enrichment provider is called, and only once its DPA is signed.
    expect(toolById("kaspr")?.settings).toEqual([
      { name: "CONTACT_ENRICHMENT_PROVIDER", enabledWhen: ["kaspr"] },
      { name: "CONTACT_ENRICHMENT_DPA_SIGNED", enabledWhen: ["true"] },
    ]);
    // MAIL_TRANSPORT=console writes emails to the server's log: Brevo is not called.
    expect(toolById("brevo-api")?.settings).toEqual([{ name: "MAIL_FROM" }, { name: "MAIL_TRANSPORT", disabledWhen: ["console"] }]);
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
    expect(toolOfUsage({ table: "ai_usage", provider: "mistral", endpoint: "api.eu.mistral.ai" })?.id).toBe("mistral");
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
