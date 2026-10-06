import { describe, expect, it } from "vitest";
import { AiProviderError } from "../errors";
import { createAnthropicProvider } from "./anthropic";
import { createMistralProvider, createOpenAiProvider, createPerplexityProvider } from "./chat-completions";

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

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

describe("Perplexity provider", () => {
  it("searches the web with nothing but the query, and returns the answer with its sources", async () => {
    const { fetch, requests } = fakeFetch(
      chatReply("Trois offres trouvées", { search_results: [{ title: "DAF", url: "https://example.fr/offre/1" }] }),
    );
    const provider = createPerplexityProvider({ apiKey: "pk", fetch });

    const output = await provider.search!("Offres d'emploi « DAF » à Lyon", {});

    expect(provider.residency).toBe("outside_eu");
    expect(provider.generate).toBeUndefined();
    expect(requests[0]!.url).toBe("https://api.perplexity.ai/chat/completions");
    expect(requests[0]!.body).toEqual({ model: "sonar", messages: [{ role: "user", content: "Offres d'emploi « DAF » à Lyon" }] });
    expect(output).toEqual({
      answer: "Trois offres trouvées",
      sources: ["https://example.fr/offre/1"],
      model: "served-model",
      usage: { inputTokens: 50, outputTokens: 20 },
    });
  });

  it("reads sources from the older citations field too", async () => {
    const { fetch } = fakeFetch(chatReply("ok", { citations: ["https://example.fr/a"] }));
    const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {});
    expect(output.sources).toEqual(["https://example.fr/a"]);
  });
});
