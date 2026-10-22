import { describe, expect, it } from "vitest";
import { checkAiRoutingChange } from "./routing-check";

/** Claude on Bedrock (EU) for the text tasks, Perplexity for web search: the defaults with their keys. */
const base = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-key", PERPLEXITY_API_KEY: "pk" };

describe("checkAiRoutingChange: an AI routing change checked as the AI layer would build it (#301)", () => {
  it("refuses a task with personal data newly routed outside the EU, naming the task and where it would go", async () => {
    const after = { ...base, OPENAI_API_KEY: "ok", OPENAI_DATA_RESIDENCY: "us", AI_SCORING_PROVIDER: "openai" };

    const refusal = await checkAiRoutingChange(base, after);

    expect(refusal?.reason).toBe("data_residency");
    expect(refusal?.technical.message).toMatch(/scoring/);
    expect(refusal?.technical.message).toMatch(/api\.openai\.com/);
  });

  it("lets a task without personal data go outside the EU", async () => {
    const after = { ...base, OPENAI_API_KEY: "ok", OPENAI_DATA_RESIDENCY: "us", AI_OFFER_ANALYSIS_PROVIDER: "openai" };

    expect(await checkAiRoutingChange(base, after)).toBeNull();
  });

  it("does not block a change over a problem the configuration already had", async () => {
    const outside = { ...base, OPENAI_API_KEY: "ok", OPENAI_DATA_RESIDENCY: "us", AI_SCORING_PROVIDER: "openai" };

    expect(await checkAiRoutingChange(outside, { ...outside, BEDROCK_REGION: "eu-west-3" })).toBeNull();
  });

  it("refuses a route whose provider's key is missing, naming the key", async () => {
    const refusal = await checkAiRoutingChange(base, { ...base, AI_WRITING_PROVIDER: "mistral" });

    expect(refusal?.reason).toBe("key_missing");
    expect(refusal?.technical.message).toMatch(/MISTRAL_API_KEY/);
  });

  it("refuses a text task routed to a web-search provider", async () => {
    expect((await checkAiRoutingChange(base, { ...base, AI_SCORING_PROVIDER: "perplexity" }))?.reason).toBe("route_missing");
  });

  it("refuses Claude on Vertex AI without its project", async () => {
    expect((await checkAiRoutingChange(base, { ...base, ANTHROPIC_ENDPOINT: "vertex" }))?.reason).toBe("key_missing");
  });

  it("switches Claude from Bedrock to auto: the direct API for tasks without personal data, Bedrock for the others", async () => {
    const keys = { ...base, ANTHROPIC_API_KEY: "sk-ant" };

    expect(await checkAiRoutingChange({ ...keys, ANTHROPIC_ENDPOINT: "bedrock" }, { ...keys, ANTHROPIC_ENDPOINT: "auto" })).toBeNull();
  });

  describe("a model named by the change is tested with its cheapest call", () => {
    it("refuses a typed model that does not exist, with the provider's answer", async () => {
      const { fetch, calls } = providerFetch({ unknownModels: ["claude-nope"] });

      const refusal = await checkAiRoutingChange(base, { ...base, AI_SCORING_MODEL: "claude-nope" }, { fetch });

      expect(refusal?.reason).toBe("test_failed");
      expect(refusal?.technical).toMatchObject({ provider: "anthropic", status: 404 });
      expect(refusal?.technical.message).toMatch(/AI_SCORING_MODEL/);
      expect(refusal?.technical.message).toMatch(/not_found_error/);
      // One call, not retried, asking for a single token.
      expect(calls).toEqual([{ host: "bedrock-mantle.eu-north-1.api.aws", model: "claude-nope", maxTokens: 1 }]);
    });

    it("saves a model that answers, testing each changed route once and nothing else", async () => {
      const { fetch, calls } = providerFetch();
      const after = { ...base, MISTRAL_API_KEY: "mk", AI_WRITING_PROVIDER: "mistral", AI_WRITING_MODEL: "mistral-medium-3-5", AI_COACHING_MODEL: "anthropic.claude-sonnet-5" };

      expect(await checkAiRoutingChange({ ...base, AI_COACHING_MODEL: "anthropic.claude-sonnet-5" }, after, { fetch })).toBeNull();
      // Coaching's model was already in use (and the back-office assistant, guardrail and eval tasks inherit it): not tested again.
      expect(calls).toEqual([{ host: "api.mistral.ai", model: "mistral-medium-3-5", maxTokens: 1 }]);
    });

    it("tests the web search's model with one search", async () => {
      const { fetch, calls } = providerFetch({ unknownModels: ["sonar-nope"] });

      expect((await checkAiRoutingChange(base, { ...base, AI_WEB_SEARCH_MODEL: "sonar-nope" }, { fetch }))?.reason).toBe("test_failed");
      expect(calls.map((call) => call.host)).toEqual(["api.perplexity.ai"]);
    });

    it("tests the identity model on Mistral", async () => {
      const { fetch, calls } = providerFetch({ unknownModels: ["mistral-nope"] });
      const keys = { ...base, MISTRAL_API_KEY: "mk" };

      const refusal = await checkAiRoutingChange(keys, { ...keys, AI_IDENTITY_MODEL: "mistral-nope" }, { fetch });

      expect(refusal?.reason).toBe("test_failed");
      expect(refusal?.technical.message).toMatch(/AI_IDENTITY_MODEL/);
      expect(calls).toEqual([{ host: "api.mistral.ai", model: "mistral-nope", maxTokens: 1 }]);
    });

    it("calls no provider with AI_FAKE", async () => {
      const { fetch, calls } = providerFetch();

      expect(await checkAiRoutingChange({ AI_FAKE: "true" }, { AI_FAKE: "true", AI_SCORING_MODEL: "any-model" }, { fetch })).toBeNull();
      expect(calls).toEqual([]);
    });
  });
});

/** Answers like each provider, refusing `unknownModels` as it would (Claude: 404 not_found_error), and records each call. */
function providerFetch(options: { unknownModels?: string[] } = {}) {
  const calls: { host: string; model: string; maxTokens?: number }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = JSON.parse(await request.text()) as { model: string; max_tokens?: number; max_output_tokens?: number };
    calls.push({ host: url.hostname, model: body.model, ...(body.max_tokens === undefined ? {} : { maxTokens: body.max_tokens }) });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (options.unknownModels?.includes(body.model)) {
      return url.hostname.includes("bedrock") || url.hostname.includes("anthropic")
        ? json(404, { type: "error", error: { type: "not_found_error", message: `model: ${body.model}` } })
        : json(400, { message: `Invalid model: ${body.model}` });
    }
    if (url.hostname.includes("bedrock") || url.hostname.includes("anthropic")) {
      return json(200, { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "O" }], stop_reason: "max_tokens", usage: { input_tokens: 3, output_tokens: 1 } });
    }
    if (url.hostname === "api.perplexity.ai") {
      return json(200, { status: "completed", model: body.model, output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 3, output_tokens: 2 } });
    }
    return json(200, { model: body.model, choices: [{ message: { content: "O" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
