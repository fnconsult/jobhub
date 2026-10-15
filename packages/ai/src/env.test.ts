import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_ENV_KEYS, createAiLayerFromEnv } from "./env";
import { AiConfigError, DataResidencyError } from "./errors";
import { createMemoryUsageLog } from "./testing";

/** Answers every call like the provider at that host would, and records the hosts called. */
function recordingFetch() {
  const hosts: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    hosts.push(url.hostname);
    const body = url.hostname.includes("bedrock") || url.hostname.includes("anthropic")
      ? { id: "m", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } }
      : url.hostname === "api.perplexity.ai"
        ? { status: "completed", model: "m", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 3, output_tokens: 2 } }
        : WEB_SEARCH_HOSTS.includes(url.hostname)
          ? { results: [], web: { results: [] } }
          : { model: "m", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, hosts };
}

const WEB_SEARCH_HOSTS = ["api.search.brave.com", "api.tavily.com", "api.linkup.so"];

const base = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", PERPLEXITY_API_KEY: "pk" };

describe("AI layer configured from the environment", () => {
  it("defaults to Claude on Bedrock eu-west-3 for text tasks and Perplexity for web search", async () => {
    const { fetch, hosts } = recordingFetch();
    const ai = createAiLayerFromEnv(base, { fetch, usage: createMemoryUsageLog() });

    await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
    await ai.searchWeb({ candidateId: "c", criteria: { targetRole: "DAF", location: "Lyon" } });

    expect(hosts).toEqual(["bedrock-mantle.eu-west-3.api.aws", "api.perplexity.ai"]);
  });

  it("switches the provider of one task by configuration alone", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const ai = createAiLayerFromEnv(
      { ...base, AI_WRITING_PROVIDER: "mistral", AI_WRITING_MODEL: "mistral-medium-latest", MISTRAL_API_KEY: "mk" },
      { fetch, usage },
    );

    await ai.generate({ task: "writing", candidateId: "c", prompt: "Lettre" });
    await ai.generate({ task: "coaching", candidateId: "c", prompt: "Bonjour" });

    expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-west-3.api.aws"]);
    expect(usage.entries.map((e) => [e.task, e.provider])).toEqual([
      ["writing", "mistral"],
      ["coaching", "anthropic"],
    ]);
  });

  it.each([
    ["brave", "BRAVE_SEARCH_API_KEY", "api.search.brave.com"],
    ["tavily", "TAVILY_API_KEY", "api.tavily.com"],
    ["linkup", "LINKUP_API_KEY", "api.linkup.so"],
  ])(
    "routes web search to %s by AI_WEB_SEARCH_PROVIDER alone, with its own key",
    async (provider, key, host) => {
      const { fetch, hosts } = recordingFetch();
      const usage = createMemoryUsageLog();
      const env = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", AI_WEB_SEARCH_PROVIDER: provider, [key]: "search-key" };

      await createAiLayerFromEnv(env, { fetch, usage }).searchWeb({ candidateId: "c", criteria: { targetRole: "DAF", location: "Lyon" } });

      expect(hosts).toEqual([host]);
      expect(usage.entries.map((e) => [e.task, e.provider])).toEqual([["web_search", provider]]);
      expect(() => createAiLayerFromEnv({ ...env, [key]: "" })).toThrow(new RegExp(key));
    },
  );

  it("finds job title variants with the Job Offer analysis provider and model unless AI_JOB_TITLES_PROVIDER says otherwise", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const env = { ...base, AI_OFFER_ANALYSIS_PROVIDER: "mistral", AI_OFFER_ANALYSIS_MODEL: "mistral-small-latest", MISTRAL_API_KEY: "mk" };
    const criteria = { targetRole: "DAF", location: "Lyon" };

    await createAiLayerFromEnv(env, { fetch, usage }).planJobSearch({ candidateId: "c", criteria });
    await createAiLayerFromEnv({ ...env, AI_JOB_TITLES_PROVIDER: "anthropic" }, { fetch, usage }).planJobSearch({ candidateId: "c", criteria });

    expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-west-3.api.aws"]);
    expect(usage.entries.map((e) => e.task)).toEqual(["job_titles", "job_titles"]);
  });

  it("runs the AI Coach on Claude Sonnet 5.5, and other text tasks on Claude's default, unless a model is set (#131)", async () => {
    const models: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      models.push(((await new Request(input, init).json()) as { model: string }).model);
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const ai = createAiLayerFromEnv(base, { fetch, usage: createMemoryUsageLog() });
    await ai.generate({ task: "coaching", candidateId: "c", prompt: "Bonjour" });
    await ai.generate({ task: "writing", candidateId: "c", prompt: "Lettre" });
    const opus = createAiLayerFromEnv({ ...base, AI_COACHING_MODEL: "anthropic.claude-opus-5-5" }, { fetch, usage: createMemoryUsageLog() });
    await opus.generate({ task: "coaching", candidateId: "c", prompt: "Bonjour" });

    // Bedrock names Claude models with an "anthropic." prefix.
    expect(models).toEqual(["anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5", "anthropic.claude-opus-5-5"]);
  });

  it("refuses to start when personal-data tasks would go to the direct Anthropic API", () => {
    expect(() => createAiLayerFromEnv({ ...base, ANTHROPIC_ENDPOINT: "direct", ANTHROPIC_API_KEY: "sk" })).toThrow(DataResidencyError);
  });

  it("refuses to start when a personal-data task would go to OpenAI without EU data residency", () => {
    expect(() =>
      createAiLayerFromEnv({ ...base, AI_SCORING_PROVIDER: "openai", OPENAI_API_KEY: "ok", OPENAI_DATA_RESIDENCY: "us" }),
    ).toThrow(DataResidencyError);
  });

  it("accepts Claude on Vertex AI in an EU region", () => {
    expect(() =>
      createAiLayerFromEnv({ PERPLEXITY_API_KEY: "pk", ANTHROPIC_ENDPOINT: "vertex", VERTEX_PROJECT_ID: "jobbbox", VERTEX_REGION: "europe-west9" }),
    ).not.toThrow();
  });

  it("names the missing key of a provider in use", () => {
    expect(() => createAiLayerFromEnv({ AWS_BEARER_TOKEN_BEDROCK: "k" })).toThrow(/PERPLEXITY_API_KEY/);
    expect(() => createAiLayerFromEnv({ ...base, AI_WRITING_PROVIDER: "mistral" })).toThrow(/MISTRAL_API_KEY/);
  });

  it("does not need keys of providers no task uses", () => {
    expect(() => createAiLayerFromEnv(base)).not.toThrow();
  });

  it("refuses to route a text task to a search-only provider", () => {
    expect(() => createAiLayerFromEnv({ ...base, AI_OFFER_ANALYSIS_PROVIDER: "tavily", TAVILY_API_KEY: "tk" })).toThrow(AiConfigError);
  });

  it("rejects an unknown provider name", () => {
    expect(() => createAiLayerFromEnv({ ...base, AI_SCORING_PROVIDER: "gemini" })).toThrow(AiConfigError);
  });

  it("can run every task on the fake provider without any key, but never in production", async () => {
    const ai = createAiLayerFromEnv({ AI_FAKE: "true" }, { usage: createMemoryUsageLog() });
    await expect(ai.generate({ task: "writing", candidateId: "c", prompt: "x" })).resolves.toMatchObject({ text: "fake reply" });
    expect(() => createAiLayerFromEnv({ AI_FAKE: "true", NODE_ENV: "production" })).toThrow(AiConfigError);
  });

  describe("EU AI consent (ADR-0007 amendment)", () => {
    const consenting = { euAiConsent: async (candidateId: string) => candidateId === "consenting" };

    it("sends a consenting Candidate's identity-bearing call to Mistral, with AI_IDENTITY_MODEL, and other calls to the task's provider", async () => {
      const { fetch, hosts } = recordingFetch();
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv({ ...base, MISTRAL_API_KEY: "mk", AI_IDENTITY_MODEL: "mistral-large-latest" }, { fetch, usage, ...consenting });

      await ai.generate({ task: "coaching", candidateId: "consenting", containsIdentity: true, prompt: "Je suis Marie Dupont" });
      await ai.generate({ task: "coaching", candidateId: "consenting", prompt: "Bonjour" });
      await ai.generate({ task: "coaching", candidateId: "other", containsIdentity: true, prompt: "Je suis Jean Martin" });

      expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-west-3.api.aws", "bedrock-mantle.eu-west-3.api.aws"]);
      expect(usage.entries[0]).toMatchObject({ provider: "mistral", model: "m" });
    });

    it("starts without a Mistral key, but refuses a consenting Candidate's identity-bearing call rather than send it elsewhere", async () => {
      const { fetch, hosts } = recordingFetch();
      const ai = createAiLayerFromEnv(base, { fetch, usage: createMemoryUsageLog(), ...consenting });

      await expect(ai.generate({ task: "coaching", candidateId: "consenting", containsIdentity: true, prompt: "Je suis Marie Dupont" })).rejects.toThrow(
        /MISTRAL_API_KEY/,
      );
      expect(hosts).toEqual([]);
    });
  });

  it(".env.example lists every key the AI layer reads", () => {
    const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(AI_ENV_KEYS.filter((key) => !listed.has(key))).toEqual([]);
  });
});
