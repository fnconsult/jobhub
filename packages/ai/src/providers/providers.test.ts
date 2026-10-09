import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { AiProviderError } from "../errors";
import { createAnthropicProvider } from "./anthropic";
import { createMistralProvider, createOpenAiProvider } from "./chat-completions";
import { createPerplexityProvider } from "./perplexity";

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that answers 200 with a body that is not JSON (e.g. a proxy's HTML page). */
const htmlFetch = (async () => new Response("<html>", { status: 200 })) as typeof globalThis.fetch;

/** A fetch that records the request and answers with a canned JSON body. */
function fakeFetch(response: unknown, status = 200) {
  const requests: Captured[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(await request.text()) });
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const anthropicReply = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "Bonjour" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 120, output_tokens: 30 },
};

const fakeGoogleAuth = { getRequestHeaders: async () => new Headers({ authorization: "Bearer google-token" }) } as never;

const textInput = {
  system: "Tu es le AI Coach.",
  messages: [{ role: "user" as const, content: "Améliore mon CV" }],
  maxTokens: 1000,
};

describe("Anthropic provider", () => {
  it("calls Claude on Bedrock in eu-west-3 and is EU-resident", async () => {
    const { fetch, requests } = fakeFetch(anthropicReply);
    const provider = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-west-3", apiKey: "bedrock-key" }, fetch });

    const output = await provider.generate!(textInput);

    expect(provider.residency).toBe("eu");
    expect(provider.endpoint).toBe("bedrock eu-west-3");
    expect(new URL(requests[0]!.url).hostname).toBe("bedrock-mantle.eu-west-3.api.aws");
    expect(requests[0]!.body).toMatchObject({
      model: "anthropic.claude-opus-5-5",
      system: "Tu es le AI Coach.",
      max_tokens: 1000,
      messages: [{ role: "user", content: "Améliore mon CV" }],
    });
    expect(output).toEqual({ text: "Bonjour", model: "claude-opus-5-5", usage: { inputTokens: 120, outputTokens: 30 } });
  });

  it("is not EU-resident on a Bedrock region outside the EU", () => {
    const provider = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "us-east-1", apiKey: "k" } });
    expect(provider.residency).toBe("outside_eu");
  });

  it("calls Claude on Vertex AI in an EU region and is EU-resident", async () => {
    const { fetch, requests } = fakeFetch(anthropicReply);
    const provider = createAnthropicProvider({
      endpoint: { kind: "vertex", region: "europe-west1", projectId: "jobbbox", authClient: fakeGoogleAuth },
      fetch,
    });

    await provider.generate!({ ...textInput, model: "claude-sonnet-5-5" });

    expect(provider.residency).toBe("eu");
    expect(requests[0]!.url).toContain("https://europe-west1-aiplatform.googleapis.com/v1/projects/jobbbox/locations/europe-west1/");
    expect(requests[0]!.url).toContain("claude-sonnet-5-5");
  });

  it("treats the direct Anthropic API as outside the EU", async () => {
    const { fetch, requests } = fakeFetch(anthropicReply);
    const provider = createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "sk-ant" }, fetch });

    await provider.generate!(textInput);

    expect(provider.residency).toBe("outside_eu");
    expect(new URL(requests[0]!.url).hostname).toBe("api.anthropic.com");
    expect(requests[0]!.headers.get("x-api-key")).toBe("sk-ant");
    expect(requests[0]!.body).toMatchObject({ model: "claude-opus-5-5" });
  });

  it("raises a provider error when Claude refuses", async () => {
    const { fetch } = fakeFetch({ ...anthropicReply, content: [], stop_reason: "refusal" });
    const provider = createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 });
    await expect(provider.generate!(textInput)).rejects.toThrow(AiProviderError);
  });

  describe("ignores the SDKs' base-URL environment variables, so data only goes where the endpoint says", () => {
    afterEach(() => vi.unstubAllEnvs());
    const elsewhere = "https://us-proxy.example.com/anthropic";

    it("on Bedrock", async () => {
      vi.stubEnv("ANTHROPIC_BEDROCK_MANTLE_BASE_URL", elsewhere);
      vi.stubEnv("ANTHROPIC_BEDROCK_BASE_URL", elsewhere);
      const { fetch, requests } = fakeFetch(anthropicReply);
      await createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-west-3", apiKey: "k" }, fetch }).generate!(textInput);
      expect(new URL(requests[0]!.url).hostname).toBe("bedrock-mantle.eu-west-3.api.aws");
    });

    it("on Vertex AI", async () => {
      vi.stubEnv("ANTHROPIC_VERTEX_BASE_URL", elsewhere);
      const { fetch, requests } = fakeFetch(anthropicReply);
      const endpoint = { kind: "vertex" as const, region: "europe-west1", projectId: "jobbbox", authClient: fakeGoogleAuth };
      await createAnthropicProvider({ endpoint, fetch }).generate!(textInput);
      expect(new URL(requests[0]!.url).hostname).toBe("europe-west1-aiplatform.googleapis.com");
    });

    it("on Vertex AI's EU multi-region", async () => {
      vi.stubEnv("ANTHROPIC_VERTEX_BASE_URL", elsewhere);
      const { fetch, requests } = fakeFetch(anthropicReply);
      const endpoint = { kind: "vertex" as const, region: "eu", projectId: "jobbbox", authClient: fakeGoogleAuth };
      await createAnthropicProvider({ endpoint, fetch }).generate!(textInput);
      expect(new URL(requests[0]!.url).hostname).toBe("aiplatform.eu.rep.googleapis.com");
    });

    it("on the direct API", async () => {
      vi.stubEnv("ANTHROPIC_BASE_URL", elsewhere);
      const { fetch, requests } = fakeFetch(anthropicReply);
      await createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch }).generate!(textInput);
      expect(new URL(requests[0]!.url).hostname).toBe("api.anthropic.com");
    });
  });

  it("raises a provider error on an HTTP failure", async () => {
    const { fetch } = fakeFetch({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, 400);
    const provider = createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 });
    await expect(provider.generate!(textInput)).rejects.toMatchObject({ name: "AiProviderError", provider: "anthropic", status: 400 });
  });
});

const chatReply = (content: string, extra: Record<string, unknown> = {}) => ({
  id: "c1",
  model: "served-model",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  ...extra,
});

describe("Mistral provider", () => {
  it("calls the Mistral chat API with the system prompt first and is EU-resident", async () => {
    const { fetch, requests } = fakeFetch(chatReply("Madame,"));
    const provider = createMistralProvider({ apiKey: "mk", fetch });

    const output = await provider.generate!(textInput);

    expect(provider.residency).toBe("eu");
    expect(requests[0]!.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer mk");
    expect(requests[0]!.body).toMatchObject({
      model: "mistral-large-latest",
      max_tokens: 1000,
      messages: [
        { role: "system", content: "Tu es le AI Coach." },
        { role: "user", content: "Améliore mon CV" },
      ],
    });
    expect(output).toEqual({ text: "Madame,", model: "served-model", usage: { inputTokens: 50, outputTokens: 20 } });
  });

  it("raises a provider error on an HTTP failure", async () => {
    const { fetch } = fakeFetch({ message: "Unauthorized" }, 401);
    const provider = createMistralProvider({ apiKey: "bad", fetch });
    await expect(provider.generate!(textInput)).rejects.toMatchObject({ name: "AiProviderError", provider: "mistral", status: 401 });
  });
});

describe("chat-completions providers", () => {
  it("raise a provider error when a 200 response is not JSON", async () => {
    await expect(createMistralProvider({ apiKey: "mk", fetch: htmlFetch }).generate!(textInput)).rejects.toMatchObject({
      name: "AiProviderError",
      provider: "mistral",
      status: 200,
    });
  });
});

describe("OpenAI provider", () => {
  it("uses the EU data-residency endpoint and is EU-resident", async () => {
    const { fetch, requests } = fakeFetch(chatReply("ok"));
    const provider = createOpenAiProvider({ apiKey: "ok", dataResidency: "eu", fetch });

    await provider.generate!(textInput);

    expect(provider.residency).toBe("eu");
    expect(requests[0]!.url).toBe("https://eu.api.openai.com/v1/chat/completions");
    expect(requests[0]!.body).toMatchObject({ max_completion_tokens: 1000 });
  });

  it("is not EU-resident on the default global endpoint", async () => {
    const { fetch, requests } = fakeFetch(chatReply("ok"));
    const provider = createOpenAiProvider({ apiKey: "ok", dataResidency: "us", fetch });

    await provider.generate!(textInput);

    expect(provider.residency).toBe("outside_eu");
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

/** A Perplexity Agent API (`POST /v1/responses`) answer to a web search, in the documented shape. */
const perplexityReply = JSON.parse(readFileSync(new URL("./fixtures/perplexity-responses-search.json", import.meta.url), "utf8"));

describe("Perplexity provider", () => {
  it("searches the web through the Agent API with nothing but the query", async () => {
    const { fetch, requests } = fakeFetch(perplexityReply);
    const provider = createPerplexityProvider({ apiKey: "pk", fetch });

    await provider.search!("Offres d'emploi « DAF » à Lyon", {});

    expect(provider.residency).toBe("outside_eu");
    expect(provider.generate).toBeUndefined();
    expect(requests[0]!.url).toBe("https://api.perplexity.ai/v1/responses");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer pk");
    expect(requests[0]!.body).toEqual({
      preset: "fast",
      input: "Offres d'emploi « DAF » à Lyon",
      tools: [{ type: "web_search" }],
      max_output_tokens: 2048,
      store: false,
    });
  });

  it("returns the answer, its sources (search results, then cited pages, each once) and the token usage", async () => {
    const { fetch } = fakeFetch(perplexityReply);

    const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {});

    expect(output).toEqual({
      answer: "Deux offres de DAF en CDI à Lyon : Acme Industrie [1] et un groupe industriel [2]. Les deux sont publiées depuis moins de deux semaines.",
      sources: [
        "https://carrieres.acme-industrie.example/offres/daf-lyon",
        "https://www.cadremploi.example/emploi/daf-lyon-123",
        "https://www.apec.example/offre/daf-lyon-456",
      ],
      model: "openai/gpt-6-luna",
      usage: { inputTokens: 812, outputTokens: 64 },
    });
  });

  it("uses the configured model (provider/model) on top of the preset", async () => {
    const { fetch, requests } = fakeFetch(perplexityReply);
    await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", { model: "perplexity/sonar" });
    expect(requests[0]!.body).toMatchObject({ preset: "fast", model: "perplexity/sonar" });
  });

  it("raises a provider error when the search did not complete, even on HTTP 200", async () => {
    const { fetch } = fakeFetch({ ...perplexityReply, status: "failed", output: [], error: { code: "search_failed", message: "Search failed" } });
    await expect(createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {})).rejects.toMatchObject({
      name: "AiProviderError",
      provider: "perplexity",
      message: expect.stringContaining("Search failed"),
    });
  });

  it("raises a provider error on an HTTP failure, such as the retired endpoint's 403", async () => {
    const { fetch } = fakeFetch({ error: { code: "chat_completions_not_available", message: "Use /v1/responses" } }, 403);
    await expect(createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {})).rejects.toMatchObject({ provider: "perplexity", status: 403 });
  });

  it("raises a provider error when a 200 response is not JSON", async () => {
    await expect(createPerplexityProvider({ apiKey: "pk", fetch: htmlFetch }).search!("q", {})).rejects.toMatchObject({
      name: "AiProviderError",
      provider: "perplexity",
      status: 200,
    });
  });
});
