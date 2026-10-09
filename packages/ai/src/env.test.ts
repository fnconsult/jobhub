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
        : { model: "m", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, hosts };
}

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

  it("rejects an unknown provider name", () => {
    expect(() => createAiLayerFromEnv({ ...base, AI_SCORING_PROVIDER: "gemini" })).toThrow(AiConfigError);
  });

  it("can run every task on the fake provider without any key, but never in production", async () => {
    const ai = createAiLayerFromEnv({ AI_FAKE: "true" }, { usage: createMemoryUsageLog() });
    await expect(ai.generate({ task: "writing", candidateId: "c", prompt: "x" })).resolves.toMatchObject({ text: "fake reply" });
    expect(() => createAiLayerFromEnv({ AI_FAKE: "true", NODE_ENV: "production" })).toThrow(AiConfigError);
  });

  it(".env.example lists every key the AI layer reads", () => {
    const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(AI_ENV_KEYS.filter((key) => !listed.has(key))).toEqual([]);
  });
});
