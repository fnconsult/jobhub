import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "@jobhub/shared";
import { AI_ENV_KEYS, AI_ROUTING_SETTINGS, createAiLayerFromEnv, modelSettingProviders, taskRouteFromEnv } from "./env";
import { AiConfigError } from "./errors";
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

const base = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", PERPLEXITY_API_KEY: "pk" };

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
      const env = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", AI_WEB_SEARCH_PROVIDER: provider, [key]: "search-key" };

      await createAiLayerFromEnv(env, { fetch, usage }).searchWeb({ candidateId: "c", criteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] } });

      expect(hosts).toEqual([host]);
      expect(usage.entries.map((e) => [e.task, e.provider])).toEqual([["web_search", provider]]);
      expect(() => createAiLayerFromEnv({ ...env, [key]: "" })).toThrow(new RegExp(key));
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

  it("starts with a personal-data task routed to the direct Anthropic API, as configured", async () => {
    const { fetch, hosts } = recordingFetch();
    const ai = createAiLayerFromEnv({ ...base, ANTHROPIC_ENDPOINT: "direct", ANTHROPIC_API_KEY: "sk", MISTRAL_API_KEY: "mk", AI_SCORING_PROVIDER: "anthropic" }, { fetch, usage: createMemoryUsageLog() });

    await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });

    expect(hosts).toEqual(["api.anthropic.com"]);
  });

  describe("Claude endpoint chosen by the keys entered (ANTHROPIC_ENDPOINT=auto, the default)", () => {
    const keys = { PERPLEXITY_API_KEY: "pk", MISTRAL_API_KEY: "mk" };
    const run = async (env: Record<string, string>) => {
      const { fetch, hosts } = recordingFetch();
      const usage = createMemoryUsageLog();
      const ai = createAiLayerFromEnv(env, { fetch, usage });
      await ai.generate({ task: "scoring", candidateId: "c", prompt: "CV" });
      await ai.generate({ task: "offer_analysis", candidateId: "c", prompt: "Offre" });
      return { hosts, providers: usage.entries.map((e) => e.provider) };
    };

    it("with the Anthropic key alone: Claude direct for public tasks, Mistral for personal data", async () => {
      expect(await run({ ...keys, ANTHROPIC_API_KEY: "sk-ant" })).toEqual({ hosts: ["api.mistral.ai", "api.anthropic.com"], providers: ["mistral", "anthropic"] });
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

    it("with the Anthropic key alone, personal-data tasks name the missing Mistral key", () => {
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
        { provider: "mistral", endpoint: "api.mistral.ai", residency: "eu" },
        { provider: "anthropic", endpoint: "api.anthropic.com", residency: "outside_eu" },
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
        expect(claude?.models.filter((each) => each.residency === "outside_eu").map((each) => each.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
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
      // Claude reached only outside the EU: the AI Coach is on Mistral.
      expect(taskRouteFromEnv({ ANTHROPIC_API_KEY: "ak" }, "coaching")).toEqual({ provider: "mistral" });
    });
  });

  it("says which provider each model setting names a model of, without any key (#301)", () => {
    const providers = modelSettingProviders({ AI_COACHING_PROVIDER: "mistral", AI_WEB_SEARCH_PROVIDER: "tavily" });

    expect(providers).toMatchObject({ AI_SCORING_MODEL: "anthropic", AI_COACHING_MODEL: "mistral", AI_GUARDRAIL_MODEL: "mistral", AI_WEB_SEARCH_MODEL: "tavily", AI_IDENTITY_MODEL: "mistral" });
    expect(Object.keys(providers)).toHaveLength(11);
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
