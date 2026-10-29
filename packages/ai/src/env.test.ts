import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "@jobhub/shared";
import { AI_ENV_KEYS, AI_ROUTING_SETTINGS, createAiLayerFromEnv, modelSettingProviders, taskRouteFromEnv } from "./env";
import { AiConfigError, WebSearchUnavailable } from "./errors";
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

const WEB_SEARCH_HOSTS = ["api.search.brave.com", "api.tavily.com"];

const base = { ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", PERPLEXITY_API_KEY: "pk" };

describe("AI layer configured from the environment", () => {
  it("defaults to Claude on Bedrock eu-north-1 for text tasks and Perplexity for web search", async () => {
    const { fetch, hosts } = recordingFetch();
    const ai = createAiLayerFromEnv(base, { fetch, usage: createMemoryUsageLog() });

    await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
    await ai.searchWeb({ candidateId: "c", criteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] } });

    expect(hosts).toEqual(["bedrock-mantle.eu-north-1.api.aws", "api.perplexity.ai"]);
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

    expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-north-1.api.aws"]);
    expect(usage.entries.map((e) => [e.task, e.provider])).toEqual([
      ["writing", "mistral"],
      ["coaching", "anthropic"],
    ]);
  });

  it.each([
    ["brave", "BRAVE_SEARCH_API_KEY", "api.search.brave.com"],
    ["tavily", "TAVILY_API_KEY", "api.tavily.com"],
  ])(
    "routes web search to %s by AI_WEB_SEARCH_PROVIDER alone, with its own key",
    async (provider, key, host) => {
      const { fetch, hosts } = recordingFetch();
      const usage = createMemoryUsageLog();
      const env = { ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", AI_WEB_SEARCH_PROVIDER: provider, [key]: "search-key" };

      await createAiLayerFromEnv(env, { fetch, usage }).searchWeb({ candidateId: "c", criteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] } });

      expect(hosts).toEqual([host]);
      expect(usage.entries.map((e) => [e.task, e.provider])).toEqual([["web_search", provider]]);
    },
  );

  it("finds job title variants with the Job Offer analysis provider and model unless AI_JOB_TITLES_PROVIDER says otherwise", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const env = { ...base, AI_OFFER_ANALYSIS_PROVIDER: "mistral", AI_OFFER_ANALYSIS_MODEL: "mistral-small-latest", MISTRAL_API_KEY: "mk" };
    const criteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

    await createAiLayerFromEnv(env, { fetch, usage }).planJobSearch({ candidateId: "c", criteria });
    await createAiLayerFromEnv({ ...env, AI_JOB_TITLES_PROVIDER: "anthropic" }, { fetch, usage }).planJobSearch({ candidateId: "c", criteria });

    expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-north-1.api.aws"]);
    expect(usage.entries.map((e) => e.task)).toEqual(["job_titles", "job_titles"]);
  });

  it("answers the Back Office Assistant with the coaching provider and model unless AI_BACK_OFFICE_ASSISTANT_PROVIDER says otherwise (#218)", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const env = { ...base, AI_COACHING_PROVIDER: "mistral", MISTRAL_API_KEY: "mk" };

    await createAiLayerFromEnv(env, { fetch, usage }).generate({ task: "back_office_assistant", candidateId: "a", prompt: "Combien ?" });
    await createAiLayerFromEnv({ ...env, AI_BACK_OFFICE_ASSISTANT_PROVIDER: "anthropic" }, { fetch, usage }).generate({ task: "back_office_assistant", candidateId: "a", prompt: "Combien ?" });

    expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-north-1.api.aws"]);
    expect(usage.entries.map((e) => e.task)).toEqual(["back_office_assistant", "back_office_assistant"]);
    // Outside the EU too, once configured: every call is redacted (ADR-0007 amendment, 2026-10-20).
    expect(() => createAiLayerFromEnv({ ...env, AI_BACK_OFFICE_ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "sk", OPENAI_DATA_RESIDENCY: "us" })).not.toThrow();
  });

  it("checks Guardrails with the coaching provider and model unless AI_GUARDRAIL_PROVIDER says otherwise, outside the EU too (#228)", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const env = { ...base, AI_COACHING_PROVIDER: "mistral", MISTRAL_API_KEY: "mk" };

    await createAiLayerFromEnv(env, { fetch, usage }).generate({ task: "guardrail", candidateId: "c", prompt: "Bonjour" });
    await createAiLayerFromEnv({ ...env, AI_GUARDRAIL_PROVIDER: "anthropic" }, { fetch, usage }).generate({ task: "guardrail", candidateId: "c", prompt: "Bonjour" });

    expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-north-1.api.aws"]);
    expect(usage.entries.map((e) => e.task)).toEqual(["guardrail", "guardrail"]);
    // Outside the EU too, once configured: every call is redacted (ADR-0007 amendment, 2026-10-20).
    expect(() => createAiLayerFromEnv({ ...env, AI_GUARDRAIL_PROVIDER: "openai", OPENAI_API_KEY: "sk", OPENAI_DATA_RESIDENCY: "us" })).not.toThrow();
  });

  it("judges Eval Runs with the coaching provider and model unless AI_EVAL_PROVIDER says otherwise, outside the EU allowed (#231)", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const env = { ...base, AI_COACHING_PROVIDER: "mistral", MISTRAL_API_KEY: "mk" };

    await createAiLayerFromEnv(env, { fetch, usage }).generate({ task: "eval", candidateId: null, prompt: "Note" });
    await createAiLayerFromEnv({ ...env, AI_EVAL_PROVIDER: "openai", OPENAI_API_KEY: "sk", OPENAI_DATA_RESIDENCY: "us" }, { fetch, usage }).generate({ task: "eval", candidateId: null, prompt: "Note" });

    expect(hosts).toEqual(["api.mistral.ai", "api.openai.com"]);
    expect(usage.entries.map((e) => e.task)).toEqual(["eval", "eval"]);
  });

  describe("Claude's direct API, ANTHROPIC_ENDPOINT's default (ADR-0007 amendment of 2026-10-28)", () => {
    // Mistral's key for offer email reading alone, which runs only in the EU (ADR-0052).
    const direct = { PERPLEXITY_API_KEY: "pk", ANTHROPIC_API_KEY: "sk-ant", MISTRAL_API_KEY: "mk" };
    /** Answers as Claude, or fails with a 400 under `failing`, and records the model each call asked for. */
    const claudeFetch = (failing = false) => {
      const models: string[] = [];
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await new Request(input, init).text()) as { model: string };
        models.push(body.model);
        if (failing) return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "refused" } }), { status: 400, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } }), { headers: { "content-type": "application/json" } });
      }) as typeof globalThis.fetch;
      return { fetch, models };
    };

    it("serves every task with personal data, redacted", async () => {
      const { fetch, models } = claudeFetch();
      const ai = createAiLayerFromEnv(direct, { fetch, usage: createMemoryUsageLog() });

      await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
      await ai.generate({ task: "coaching", candidateId: "c", prompt: "Bonjour" });

      expect(models).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
      expect(taskRouteFromEnv(direct, "scoring")).toEqual({ provider: "anthropic" });
    });

    it("runs a route naming no model on the model for its effort, a named model winning", async () => {
      const { fetch, models } = claudeFetch();
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv(direct, { fetch, usage });
      const claude = { provider: "anthropic" } as const;

      await ai.generate({ task: "coaching", candidateId: "c", prompt: "?", route: claude, effort: "low" });
      await ai.generate({ task: "coaching", candidateId: "c", prompt: "?", route: claude, effort: "medium" });
      await ai.generate({ task: "coaching", candidateId: "c", prompt: "?", route: claude, effort: "high" });
      await ai.generate({ task: "coaching", candidateId: "c", prompt: "?", route: claude });
      await ai.generate({ task: "coaching", candidateId: "c", prompt: "?", route: { ...claude, model: "claude-opus-5-5" }, effort: "low" });

      expect(models).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
      expect(usage.entries.map((entry) => entry.model)).toEqual(models);
    });

    it("records a failed call with the model for its effort", async () => {
      const { fetch } = claudeFetch(true);
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv(direct, { fetch, usage });

      await expect(ai.generate({ task: "coaching", candidateId: "c", prompt: "?", effort: "low" })).rejects.toThrow();

      expect(usage.entries[0]).toMatchObject({ outcome: "failed", model: "claude-haiku-5-5" });
    });

    it("offers Playbook Agents its default model by effort; Bedrock keeps a single one", () => {
      const claudeOf = (env: Record<string, string>) => createAiLayerFromEnv(env, { usage: createMemoryUsageLog() }).agentModels().find((choice) => choice.provider === "anthropic");

      expect(claudeOf(direct)).toMatchObject({ defaultModel: "claude-sonnet-5-5", defaultModelByEffort: { low: "claude-haiku-5-5", medium: "claude-sonnet-5-5", high: "claude-opus-5-5" } });
      expect(claudeOf(base)?.defaultModelByEffort).toBeUndefined();
    });
  });

  it("starts with a personal-data task routed to the direct Anthropic API, as configured", async () => {
    const { fetch, hosts } = recordingFetch();
    const ai = createAiLayerFromEnv({ ...base, ANTHROPIC_ENDPOINT: "direct", ANTHROPIC_API_KEY: "sk", MISTRAL_API_KEY: "mk", AI_SCORING_PROVIDER: "anthropic" }, { fetch, usage: createMemoryUsageLog() });

    await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });

    expect(hosts).toEqual(["api.anthropic.com"]);
  });

  it("reads offer emails on an EU endpoint by default: Claude on Bedrock, else Mistral; and refuses them outside the EU as configured (ADR-0052)", async () => {
    const { fetch, hosts } = recordingFetch();
    const usage = createMemoryUsageLog();
    const read = (env: Record<string, string>) => createAiLayerFromEnv(env, { fetch, usage }).generate({ task: "offer_email_reading", candidateId: "c", prompt: "Offre" });

    await read(base);
    await read({ ...base, ANTHROPIC_ENDPOINT: "direct", ANTHROPIC_API_KEY: "sk", MISTRAL_API_KEY: "mk" });
    await expect(read({ ...base, ANTHROPIC_ENDPOINT: "direct", ANTHROPIC_API_KEY: "sk", MISTRAL_API_KEY: "mk", AI_OFFER_EMAIL_READING_PROVIDER: "anthropic" })).rejects.toThrow(/only on an EU-resident endpoint/);

    expect(hosts).toEqual(["bedrock-mantle.eu-north-1.api.aws", "api.mistral.ai"]);
  });

  describe("Claude endpoint chosen by the keys entered (ANTHROPIC_ENDPOINT=auto)", () => {
    const keys = { ANTHROPIC_ENDPOINT: "auto", PERPLEXITY_API_KEY: "pk", MISTRAL_API_KEY: "mk" };
    const run = async (env: Record<string, string>) => {
      const { fetch, hosts } = recordingFetch();
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv(env, { fetch, usage });
      await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
      await ai.generate({ task: "offer_analysis", candidateId: "c", prompt: "Offre" });
      return { hosts, providers: usage.entries.map((e) => e.provider) };
    };

    it("with the Anthropic key alone: Claude direct for every task, personal data too, redacted (ADR-0007 amendment of 2026-10-28)", async () => {
      expect(await run({ ...keys, ANTHROPIC_API_KEY: "sk-ant" })).toEqual({ hosts: ["api.anthropic.com", "api.anthropic.com"], providers: ["anthropic", "anthropic"] });
    });

    it("with the Bedrock key alone: Claude on Bedrock for every task", async () => {
      expect((await run({ ...keys, AWS_BEARER_TOKEN_BEDROCK: "bk" })).hosts).toEqual(["bedrock-mantle.eu-north-1.api.aws", "bedrock-mantle.eu-north-1.api.aws"]);
    });

    it("with both keys: Bedrock for personal data, the direct API for public tasks", async () => {
      expect(await run({ ...keys, ANTHROPIC_API_KEY: "sk-ant", AWS_BEARER_TOKEN_BEDROCK: "bk" })).toEqual({
        hosts: ["bedrock-mantle.eu-north-1.api.aws", "api.anthropic.com"],
        providers: ["anthropic", "anthropic"],
      });
    });

    it("with the Anthropic key alone, offer email reading (EU only) names the missing Mistral key", () => {
      expect(() => createAiLayerFromEnv({ PERPLEXITY_API_KEY: "pk", ANTHROPIC_API_KEY: "sk-ant" })).toThrow(/MISTRAL_API_KEY/);
    });
  });

  it("starts with a personal-data task routed to OpenAI without EU data residency, as configured", () => {
    expect(() => createAiLayerFromEnv({ ...base, AI_SCORING_PROVIDER: "openai", OPENAI_API_KEY: "ok", OPENAI_DATA_RESIDENCY: "us" })).not.toThrow();
  });

  it("still refuses to start with a text task routed to a web-search provider", () => {
    expect(() => createAiLayerFromEnv({ ...base, AI_SCORING_PROVIDER: "perplexity" })).toThrow(AiConfigError);
  });

  it("accepts Claude on Vertex AI in an EU region", () => {
    expect(() =>
      createAiLayerFromEnv({ PERPLEXITY_API_KEY: "pk", ANTHROPIC_ENDPOINT: "vertex", VERTEX_PROJECT_ID: "jobbbox", VERTEX_REGION: "europe-west9" }),
    ).not.toThrow();
  });

  it("names the missing key of a text provider in use", () => {
    expect(() => createAiLayerFromEnv({ ...base, AI_WRITING_PROVIDER: "mistral" })).toThrow(/MISTRAL_API_KEY/);
  });

  describe("a text task routed to a provider whose key is missing, with missing keys tolerated (ADR-0042: warns, never blocks)", () => {
    it("starts, the other tasks working, and that task's calls fail as key_missing, recorded, never sent", async () => {
      const { fetch, hosts } = recordingFetch();
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv({ ...base, AI_JOB_TITLES_PROVIDER: "openai" }, { fetch, usage, tolerateMissingKeys: true });

      await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
      await expect(ai.generate({ task: "job_titles", candidateId: null, prompt: "DAF" })).rejects.toThrow(/OPENAI_API_KEY/);

      expect(hosts).toEqual(["bedrock-mantle.eu-north-1.api.aws"]);
      expect(usage.entries.map((entry) => [entry.task, entry.outcome, entry.reason ?? null])).toEqual([
        ["scoring", "ok", null],
        ["job_titles", "failed", "key_missing"],
      ]);
      // A Playbook Agent is never offered a provider without its key.
      expect(ai.agentModels().map((choice) => choice.provider)).not.toContain("openai");
    });

    it("still stops start-up without that tolerance, naming the key", () => {
      expect(() => createAiLayerFromEnv({ ...base, AI_JOB_TITLES_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
    });
  });

  describe("without the key of the active Search provider (#399)", () => {
    const criteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

    it("starts: every other task works, and web search is unavailable, naming the missing key", async () => {
      const { fetch, hosts } = recordingFetch();
      const ai = createAiLayerFromEnv({ ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "k" }, { fetch, usage: createMemoryUsageLog() });

      await expect(ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" })).resolves.toMatchObject({ text: "ok" });
      expect(ai.webSearchAvailable()).toBe(false);
      const search = ai.searchWeb({ candidateId: "c", criteria });
      await expect(search).rejects.toBeInstanceOf(WebSearchUnavailable);
      await expect(search).rejects.toThrow(/PERPLEXITY_API_KEY/);
      await expect(ai.searchCompany({ candidateId: "c", employer: "Acme Ltd" })).rejects.toBeInstanceOf(WebSearchUnavailable);
      expect(hosts).toEqual(["bedrock-mantle.eu-north-1.api.aws"]);
    });

    it.each([
      ["brave", "BRAVE_SEARCH_API_KEY"],
      ["tavily", "TAVILY_API_KEY"],
    ])("starts with web search routed to %s and no %s", async (provider, key) => {
      const ai = createAiLayerFromEnv({ ...base, AI_WEB_SEARCH_PROVIDER: provider }, { usage: createMemoryUsageLog() });
      expect(ai.webSearchAvailable()).toBe(false);
      await expect(ai.searchWeb({ candidateId: "c", criteria })).rejects.toThrow(new RegExp(key));
    });

    it("searches with a task Playbook's Search provider whose key is entered", async () => {
      const { fetch, hosts } = recordingFetch();
      const ai = createAiLayerFromEnv({ ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "k", BRAVE_SEARCH_API_KEY: "bk" }, { fetch, usage: createMemoryUsageLog() });

      expect(ai.webSearchAvailable({ provider: "brave" })).toBe(true);
      await ai.searchWeb({ candidateId: "c", criteria, route: { provider: "brave" } });
      expect(hosts).toEqual(["api.search.brave.com"]);
    });

    it("is available once the key is entered", () => {
      expect(createAiLayerFromEnv(base, { usage: createMemoryUsageLog() }).webSearchAvailable()).toBe(true);
    });

    it("goes to the fallback Search provider when its key is entered (ADR-0043): web search stays available", async () => {
      const { fetch, hosts } = recordingFetch();
      const ai = createAiLayerFromEnv(
        { ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "k", AI_WEB_SEARCH_PROVIDER: "brave", AI_WEB_SEARCH_FALLBACK_PROVIDER: "tavily", TAVILY_API_KEY: "tk" },
        { fetch, usage: createMemoryUsageLog() },
      );

      expect(ai.webSearchAvailable()).toBe(true);
      await ai.searchWeb({ candidateId: "c", criteria });
      await ai.searchCompany({ candidateId: "c", employer: "Acme Ltd" });
      expect(hosts.filter((host) => WEB_SEARCH_HOSTS.includes(host))).toEqual(["api.tavily.com", "api.tavily.com"]);
    });

    it("is unavailable when the fallback Search provider's key is missing too, and the AI layer still starts", async () => {
      const ai = createAiLayerFromEnv({ ANTHROPIC_ENDPOINT: "auto", AWS_BEARER_TOKEN_BEDROCK: "k", AI_WEB_SEARCH_PROVIDER: "brave", AI_WEB_SEARCH_FALLBACK_PROVIDER: "tavily" }, { usage: createMemoryUsageLog() });

      expect(ai.webSearchAvailable()).toBe(false);
      await expect(ai.searchWeb({ candidateId: "c", criteria })).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
    });
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

  it("records each billed unit at the price env holds, else its list price (#403)", async () => {
    const searchOnce = async (env: Record<string, string>) => {
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv({ AI_FAKE: "true", AI_WEB_SEARCH_PROVIDER: "perplexity", ...env }, { usage });
      await ai.searchCompany({ candidateId: null, employer: "Acme" });
      return usage.entries[0]!.tools[0]!.costEur;
    };

    // The fake's search type is not "web": the fast price.
    expect(await searchOnce({})).toBeCloseTo(0.001 * 0.86, 12);
    expect(await searchOnce({ PERPLEXITY_FAST_SEARCH_PRICE_USD: "0.003", EUR_PER_USD: "0.9" })).toBeCloseTo(0.003 * 0.9, 12);
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

      expect(hosts).toEqual(["api.mistral.ai", "bedrock-mantle.eu-north-1.api.aws", "bedrock-mantle.eu-north-1.api.aws"]);
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

  describe("Playbook Agents (#225)", () => {
    const providersOf = (env: Record<string, string>) => createAiLayerFromEnv(env, { usage: createMemoryUsageLog() }).agentModels().map((choice) => choice.provider);

    it("may use every text provider whose key is entered, even one no task uses", () => {
      expect(providersOf(base)).toEqual(["anthropic"]);
      expect(providersOf({ ...base, MISTRAL_API_KEY: "mk" })).toEqual(["anthropic", "mistral"]);
      expect(providersOf({ ...base, OPENAI_API_KEY: "ok" })).toEqual(["anthropic", "openai"]);
    });

    it("outside the EU too, marked as such", () => {
      const choices = (env: Record<string, string>) => createAiLayerFromEnv(env, { usage: createMemoryUsageLog() }).agentModels();
      expect(choices({ ...base, OPENAI_API_KEY: "ok", OPENAI_DATA_RESIDENCY: "us" }).map(({ provider, residency }) => ({ provider, residency }))).toEqual([
        { provider: "anthropic", residency: "eu" },
        { provider: "openai", residency: "outside_eu" },
      ]);
      expect(choices({ ANTHROPIC_API_KEY: "ak", MISTRAL_API_KEY: "mk", PERPLEXITY_API_KEY: "pk" }).map(({ provider, endpoint, residency }) => ({ provider, endpoint, residency }))).toEqual([
        { provider: "anthropic", endpoint: "api.anthropic.com", residency: "outside_eu" },
        { provider: "mistral", endpoint: "api.mistral.ai", residency: "eu" },
      ]);
    });

    describe("Claude's direct API, its key entered in the Back Office, outside the EU", () => {
      const keys = { PERPLEXITY_API_KEY: "pk", MISTRAL_API_KEY: "mk", ANTHROPIC_API_KEY: "sk-ant" };
      const direct = { provider: "anthropic", model: "claude-opus-5-5" } as const;
      const cases: [string, Record<string, string>][] = [
        ["with the Bedrock token too", { ...keys, AWS_BEARER_TOKEN_BEDROCK: "bk" }],
        ["alone", keys],
        // An .env made before ANTHROPIC_ENDPOINT=auto (#224) still says bedrock.
        ["with the Bedrock token too, under ANTHROPIC_ENDPOINT=bedrock", { ...keys, AWS_BEARER_TOKEN_BEDROCK: "bk", ANTHROPIC_ENDPOINT: "bedrock" }],
        ["alone, under ANTHROPIC_ENDPOINT=bedrock", { ...keys, ANTHROPIC_ENDPOINT: "bedrock" }],
      ];

      it.each(cases)("is offered %s, its models marked outside the EU", (_, env) => {
        const claude = createAiLayerFromEnv(env, { usage: createMemoryUsageLog() }).agentModels().find((choice) => choice.provider === "anthropic");
        expect(claude?.endpoint).toContain("api.anthropic.com");
        expect(claude?.models.filter((each) => each.residency === "outside_eu").map((each) => each.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);
      });

      it.each(cases)("serves a Playbook Agent %s, redacted, and a consenting Candidate's identity still goes to Mistral", async (_, env) => {
        const bodies: { host: string; body: string }[] = [];
        const { fetch: answer } = recordingFetch();
        const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = new Request(input, init);
          bodies.push({ host: new URL(request.url).hostname, body: await request.clone().text() });
          return answer(request);
        }) as typeof globalThis.fetch;
        const ai = createAiLayerFromEnv(env, {
          fetch,
          usage: createMemoryUsageLog(),
          euAiConsent: async (candidateId) => candidateId === "consenting",
          identityOf: async () => ({ fullName: "Marie Dupont", firstName: "Marie", lastName: "Dupont" }),
        });

        await ai.generate({ task: "coaching", candidateId: "c", route: direct, prompt: "Je suis Marie Dupont" });
        await ai.generate({ task: "coaching", candidateId: "consenting", containsIdentity: true, route: direct, prompt: "Je suis Marie Dupont" });

        expect(bodies.map((each) => each.host)).toEqual(["api.anthropic.com", "api.mistral.ai"]);
        expect(bodies[0]!.body).not.toContain("Dupont");
      });

      it("leaves every task on Bedrock under ANTHROPIC_ENDPOINT=bedrock", async () => {
        const { fetch, hosts } = recordingFetch();
        const ai = createAiLayerFromEnv({ ...keys, AWS_BEARER_TOKEN_BEDROCK: "bk", ANTHROPIC_ENDPOINT: "bedrock" }, { fetch, usage: createMemoryUsageLog() });

        await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
        await ai.generate({ task: "offer_analysis", candidateId: "c", prompt: "Offre" });

        expect(hosts).toEqual(["bedrock-mantle.eu-north-1.api.aws", "bedrock-mantle.eu-north-1.api.aws"]);
      });
    });

    it("are given by default the AI Coach's route: its provider and model", () => {
      expect(taskRouteFromEnv(base, "coaching")).toEqual({ provider: "anthropic" });
      expect(taskRouteFromEnv({ ...base, AI_COACHING_PROVIDER: "mistral", AI_COACHING_MODEL: "mistral-medium-3-5" }, "coaching")).toEqual({
        provider: "mistral",
        model: "mistral-medium-3-5",
      });
      // Claude reached only outside the EU: the AI Coach stays on Claude, redacted; only a task run in the EU alone is on Mistral.
      expect(taskRouteFromEnv({ ANTHROPIC_API_KEY: "ak" }, "coaching")).toEqual({ provider: "anthropic" });
      expect(taskRouteFromEnv({ ANTHROPIC_API_KEY: "ak" }, "offer_email_reading")).toEqual({ provider: "mistral" });
      // The email Guardrail checks the email the reading reads: it takes the reading's route, in the EU (#446, ADR-0052).
      expect(taskRouteFromEnv({ ANTHROPIC_API_KEY: "ak" }, "email_guardrail")).toEqual({ provider: "mistral" });
      expect(taskRouteFromEnv({ ANTHROPIC_API_KEY: "ak", AI_OFFER_EMAIL_READING_PROVIDER: "mistral", AI_OFFER_EMAIL_READING_MODEL: "mistral-large-latest" }, "email_guardrail")).toEqual({ provider: "mistral", model: "mistral-large-latest" });
    });
  });

  it("says which provider each model setting names a model of, without any key (#301)", () => {
    const providers = modelSettingProviders({ AI_COACHING_PROVIDER: "mistral", AI_WEB_SEARCH_PROVIDER: "tavily" });

    expect(providers).toMatchObject({ AI_SCORING_MODEL: "anthropic", AI_COACHING_MODEL: "mistral", AI_GUARDRAIL_MODEL: "mistral", AI_WEB_SEARCH_MODEL: "tavily", AI_IDENTITY_MODEL: "mistral" });
    expect(Object.keys(providers)).toHaveLength(13);
  });

  describe("web-search providers a task Playbook may choose (ADR-0026)", () => {
    const searchOf = (env: Record<string, string>) => createAiLayerFromEnv(env, { usage: createMemoryUsageLog() }).searchModels();

    it("are every web-search provider whose key is entered, each with its models or depths", () => {
      expect(searchOf({ ...base, BRAVE_SEARCH_API_KEY: "bk", TAVILY_API_KEY: "tk" }).map(({ provider, defaultModel, models }) => ({ provider, defaultModel, models: models.map((each) => each.model) }))).toEqual([
        { provider: "perplexity", defaultModel: "fast", models: ["fast", "web"] },
        { provider: "brave", defaultModel: "web", models: ["web"] },
        { provider: "tavily", defaultModel: "basic", models: ["basic", "advanced", "fast", "ultra-fast"] },
      ]);
    });

    it("never a text provider, and none whose key is missing", () => {
      expect(searchOf({ ...base, MISTRAL_API_KEY: "mk" }).map((choice) => choice.provider)).toEqual(["perplexity"]);
    });

    it("put the configured web-search model first", () => {
      expect(searchOf({ ...base, AI_WEB_SEARCH_MODEL: "web" })[0]!.models.map((each) => each.model)).toEqual(["web", "fast"]);
    });
  });

  it("the Bedrock Tool's residency note names the region Bedrock takes by default (#325)", () => {
    const region = AI_ROUTING_SETTINGS.find((setting) => setting.name === "BEDROCK_REGION")!.default;
    const note = TOOLS.find((tool) => tool.id === "anthropic-bedrock")!.residencyNote!;

    expect(region).toBe("eu-north-1");
    expect(note.fr).toContain(`${region} par défaut`);
    expect(note.en).toContain(`${region} by default`);
  });

  it(".env.example lists every key the AI layer reads", () => {
    const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(AI_ENV_KEYS.filter((key) => !listed.has(key))).toEqual([]);
  });
});
