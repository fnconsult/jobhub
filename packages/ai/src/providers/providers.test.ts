import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { residencyOf } from "@jobhub/shared";
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
      model: "anthropic.claude-opus-5",
      system: "Tu es le AI Coach.",
      max_tokens: 1000,
      messages: [{ role: "user", content: "Améliore mon CV" }],
    });
    expect(output).toEqual({ text: "Bonjour", model: "claude-opus-5-5", usage: { inputTokens: 120, outputTokens: 30 } });
  });

  it("reports input read from and written to Claude's prompt cache, apart from the rest of the input", async () => {
    const usage = { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 18_000, cache_creation_input_tokens: 2_000 };
    const { fetch } = fakeFetch({ ...anthropicReply, usage });
    const provider = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-west-3", apiKey: "k" }, fetch });

    const output = await provider.generate!(textInput);

    // Claude's input_tokens leave out both cache reads and cache writes.
    expect(output.usage).toEqual({ inputTokens: 2_120, outputTokens: 30, cachedInputTokens: 18_000, cacheWriteTokens: 2_000 });
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
    expect(requests[0]!.body).toMatchObject({ model: "claude-sonnet-5-5" });
  });

  describe("on the direct API, picks its default model by the call's effort (ADR-0007 amendment of 2026-10-28)", () => {
    it.each([
      ["low", "claude-haiku-5-5"],
      ["medium", "claude-sonnet-5-5"],
      ["high", "claude-opus-5-5"],
      [undefined, "claude-sonnet-5-5"],
    ] as const)("effort %s: %s", async (effort, model) => {
      const { fetch, requests } = fakeFetch(anthropicReply);
      const provider = createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "sk-ant" }, fetch });

      await provider.generate!({ ...textInput, ...(effort ? { effort } : {}) });

      expect(requests[0]!.body).toMatchObject({ model });
      expect(provider.defaultModelFor?.(effort)).toBe(model);
    });

    it("keeps a model the route names, whatever the effort", async () => {
      const { fetch, requests } = fakeFetch(anthropicReply);
      const provider = createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "sk-ant" }, fetch });

      await provider.generate!({ ...textInput, model: "claude-opus-5-5", effort: "low" });

      expect(requests[0]!.body).toMatchObject({ model: "claude-opus-5-5" });
    });

    it("says so, for the Back Office; Bedrock keeps its one default model", () => {
      expect(createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" } }).modelByEffort).toEqual({ low: "claude-haiku-5-5", medium: "claude-sonnet-5-5", high: "claude-opus-5-5" });
      const bedrock = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1", apiKey: "k" } });
      expect(bedrock.modelByEffort).toBeUndefined();
      expect(bedrock.defaultModelFor).toBeUndefined();
      expect(bedrock.defaultModel).toBe("anthropic.claude-opus-5");
    });
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
  it("calls Mistral's EU regional host, the only one the shared catalogue counts as in the EU (#522)", () => {
    const provider = createMistralProvider({ apiKey: "mk" });

    expect(provider.endpoint).toBe("api.eu.mistral.ai");
    expect(residencyOf(provider.endpoint)).toBe(provider.residency);
    expect(residencyOf("api.mistral.ai")).toBe("outside_eu");
  });

  it("calls the Mistral chat API with the system prompt first and is EU-resident", async () => {
    const { fetch, requests } = fakeFetch(chatReply("Madame,"));
    const provider = createMistralProvider({ apiKey: "mk", fetch });

    const output = await provider.generate!(textInput);

    expect(provider.residency).toBe("eu");
    expect(requests[0]!.url).toBe("https://api.eu.mistral.ai/v1/chat/completions");
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

  it("reports cached input apart, when Mistral says how much of the prompt came from its cache", async () => {
    const { fetch } = fakeFetch(chatReply("Madame,", { usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70, prompt_tokens_details: { cached_tokens: 40 } } }));

    const output = await createMistralProvider({ apiKey: "mk", fetch }).generate!(textInput);

    // prompt_tokens include the cached ones.
    expect(output.usage).toEqual({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 40 });
  });

  it("raises a provider error on an HTTP failure", async () => {
    const { fetch } = fakeFetch({ message: "Unauthorized" }, 401);
    const provider = createMistralProvider({ apiKey: "bad", fetch });
    await expect(provider.generate!(textInput)).rejects.toMatchObject({ name: "AiProviderError", provider: "mistral", status: 401 });
  });

  it("keeps its key out of the error, even when Mistral echoes it back (#208)", async () => {
    const key = "mistral-key-0123456789";
    const { fetch } = fakeFetch({ message: `Invalid API key ${key} (mist…6789)` }, 401);

    const error = await createMistralProvider({ apiKey: key, fetch }).generate!(textInput).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: "AiProviderError", status: 401 });
    expect(String((error as Error).message)).not.toMatch(/0123456789|mist…6789/);
    expect((error as Error).message).toContain("Invalid API key");
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

describe("effort, as a Playbook Agent asks for it (#225)", () => {
  it("is sent to Claude as output_config.effort on a model that takes it, and left out on one that does not", async () => {
    const { fetch, requests } = fakeFetch(anthropicReply);
    const provider = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-west-3", apiKey: "k" }, fetch });

    await provider.generate!({ ...textInput, effort: "low" });
    await provider.generate!({ ...textInput, model: "anthropic.claude-haiku-4-5", effort: "low" });
    await provider.generate!(textInput);

    expect(requests[0]!.body).toMatchObject({ output_config: { effort: "low" } });
    expect(requests[1]!.body).not.toHaveProperty("output_config");
    expect(requests[2]!.body).not.toHaveProperty("output_config");
  });

  it("is sent to Mistral as reasoning_effort, none for low and high for medium or high, only on a model that has it", async () => {
    const { fetch, requests } = fakeFetch(chatReply("ok"));
    const provider = createMistralProvider({ apiKey: "mk", fetch });

    for (const effort of ["low", "medium", "high"] as const) await provider.generate!({ ...textInput, model: "mistral-medium-3-5", effort });
    await provider.generate!({ ...textInput, effort: "high" });

    expect(requests.slice(0, 3).map((request) => request.body.reasoning_effort)).toEqual(["none", "high", "high"]);
    expect(requests[3]!.body).not.toHaveProperty("reasoning_effort");
  });

  it("keeps only Mistral's answer when it thinks first: the content then comes as chunks, thinking then text", async () => {
    // docs.mistral.ai/capabilities/reasoning: with reasoning_effort "high", message.content is a list of
    // chunks, a "thinking" chunk (its own list of text chunks) before the answer's "text" chunks.
    const { fetch } = fakeFetch({
      ...chatReply(""),
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "Le candidat a 52 ans, je regarde le playbook." }] },
              { type: "text", text: "Mettez en avant " },
              { type: "text", text: "vos résultats chiffrés." },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });

    const output = await createMistralProvider({ apiKey: "mk", fetch }).generate!({ ...textInput, model: "mistral-medium-3-5", effort: "medium" });

    expect(output.text).toBe("Mettez en avant vos résultats chiffrés.");
  });

  it("gives a model that thinks room for its thinking on top of the answer's tokens, which thinking would otherwise eat", async () => {
    const mistral = fakeFetch(chatReply("ok"));
    const openai = fakeFetch(chatReply("ok"));

    await createMistralProvider({ apiKey: "mk", fetch: mistral.fetch }).generate!({ ...textInput, model: "mistral-medium-3-5", effort: "medium" });
    await createMistralProvider({ apiKey: "mk", fetch: mistral.fetch }).generate!({ ...textInput, model: "mistral-medium-3-5", effort: "low" });
    await createMistralProvider({ apiKey: "mk", fetch: mistral.fetch }).generate!({ ...textInput, effort: "high" });
    await createOpenAiProvider({ apiKey: "ok", dataResidency: "eu", fetch: openai.fetch }).generate!({ ...textInput, effort: "low" });

    expect(mistral.requests[0]!.body.max_tokens as number).toBeGreaterThan(textInput.maxTokens);
    // "none" does not think; a model without reasoning_effort ignores it.
    expect(mistral.requests[1]!.body.max_tokens).toBe(textInput.maxTokens);
    expect(mistral.requests[2]!.body.max_tokens).toBe(textInput.maxTokens);
    expect(openai.requests[0]!.body.max_completion_tokens as number).toBeGreaterThan(textInput.maxTokens);
  });

  it("is sent to OpenAI's reasoning models as reasoning_effort", async () => {
    const { fetch, requests } = fakeFetch(chatReply("ok"));
    const provider = createOpenAiProvider({ apiKey: "ok", dataResidency: "eu", fetch });

    await provider.generate!({ ...textInput, effort: "medium" });
    await provider.generate!({ ...textInput, model: "gpt-4.1", effort: "medium" });

    expect(requests[0]!.body).toMatchObject({ reasoning_effort: "medium" });
    expect(requests[1]!.body).not.toHaveProperty("reasoning_effort");
  });
});

describe("the models a provider offers a Playbook Agent (#225)", () => {
  it("names the Claude models its endpoint serves: older ones, with Bedrock's prefix, on Bedrock", () => {
    expect(createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-west-3" } }).models).toEqual([
      "anthropic.claude-opus-5",
      "anthropic.claude-sonnet-5",
      "anthropic.claude-haiku-4-5",
    ]);
    expect(createAnthropicProvider({ endpoint: { kind: "vertex", region: "europe-west1", projectId: "p" } }).models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("starts with the provider's default model", () => {
    expect(createMistralProvider({ apiKey: "mk" }).models?.[0]).toBe("mistral-large-latest");
    expect(createOpenAiProvider({ apiKey: "ok", dataResidency: "eu" }).models?.[0]).toBe("gpt-5");
  });
});

/**
 * A Perplexity Search API (`POST /search`) answer. HAND-WRITTEN from the API reference
 * (docs/research/issue-398.md), not recorded: perplexity.live.test.ts records a real one
 * (perplexity-search.recorded.json), checked below when present.
 */
const perplexityReply = JSON.parse(readFileSync(new URL("./fixtures/perplexity-search.json", import.meta.url), "utf8"));
const recordedReplyUrl = new URL("./fixtures/perplexity-search.recorded.json", import.meta.url);
const today = () => new Date("2026-10-12T08:00:00Z");

describe("Perplexity provider (Search API)", () => {
  it("searches through the Search API with the query, the fast search type and 20 results, no LLM", async () => {
    const { fetch, requests } = fakeFetch(perplexityReply);
    const provider = createPerplexityProvider({ apiKey: "pk", fetch });

    await provider.search!("Offre d'emploi « DAF » à Lyon", {});

    expect(provider.residency).toBe("outside_eu");
    expect(provider.generate).toBeUndefined();
    expect(requests[0]!.url).toBe("https://api.perplexity.ai/search");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer pk");
    expect(requests[0]!.body).toEqual({ query: "Offre d'emploi « DAF » à Lyon", search_type: "fast", max_results: 20 });
  });

  it("maps the results to sources (each once), lists them in the answer, and bills one search, no tokens", async () => {
    const { fetch } = fakeFetch(perplexityReply);

    const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {});

    expect(output).toEqual({
      answer:
        "DAF H/F - CDI - Lyon | Acme Industrie\nhttps://carrieres.acme-industrie.example/offres/daf-lyon\nAcme Industrie recrute son Directeur administratif et financier (H/F) en CDI à Lyon.\n\n" +
        "Directeur financier H/F\nhttps://www.cadremploi.example/emploi/daf-lyon-123\nGroupe industriel lyonnais, poste de DAF rattaché au Président.\n\n" +
        "Offre DAF Lyon\nhttps://www.apec.example/offre/daf-lyon-456\nDirecteur administratif et financier, Lyon.",
      sources: [
        "https://carrieres.acme-industrie.example/offres/daf-lyon",
        "https://www.cadremploi.example/emploi/daf-lyon-123",
        "https://www.apec.example/offre/daf-lyon-456",
      ],
      sourceDates: expect.any(Object),
      model: "fast",
      usage: { inputTokens: 0, outputTokens: 0 },
      tools: [{ name: "web_search", count: 1 }],
    });
  });

  it("dates a result by its publication date, else by its last update (a weaker date), else not at all (#116)", async () => {
    const { fetch } = fakeFetch(perplexityReply);

    const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {});

    expect(output.sourceDates).toEqual({
      "https://carrieres.acme-industrie.example/offres/daf-lyon": new Date("2026-10-02T00:00:00Z"),
      "https://www.cadremploi.example/emploi/daf-lyon-123": new Date("2026-09-28T00:00:00Z"),
    });
  });

  it("sends up to 5 queries in one call, billed as one search", async () => {
    const { fetch, requests } = fakeFetch(perplexityReply);
    const provider = createPerplexityProvider({ apiKey: "pk", fetch });

    const output = await provider.search!(["DAF Lyon", "CFO Lyon", "Directeur financier Lyon"], {});

    expect(provider.searchContract?.queriesPerCall).toBe(5);
    expect(requests[0]!.body).toMatchObject({ query: ["DAF Lyon", "CFO Lyon", "Directeur financier Lyon"] });
    expect(output.tools).toEqual([{ name: "web_search", count: 1 }]);
    await expect(provider.search!(["1", "2", "3", "4", "5", "6"], {})).rejects.toThrow(/at most 5 queries/);
  });

  it("reads the results of several queries whether they come flat or grouped per query", async () => {
    const [first, second] = perplexityReply.results;
    const { fetch } = fakeFetch({ id: "x", results: [[first], [second]] });

    const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!(["a", "b"], {});

    expect(output.sources).toEqual([first.url, second.url]);
  });

  it("asks for fewer queries per call, and the web search type, when its settings say so", async () => {
    const { fetch, requests } = fakeFetch(perplexityReply);
    const provider = createPerplexityProvider({ apiKey: "pk", fetch, searchType: "web", queriesPerCall: 2 });

    const output = await provider.search!("q", {});

    expect(provider.searchContract?.queriesPerCall).toBe(2);
    expect(provider.defaultModel).toBe("web");
    expect(requests[0]!.body).toMatchObject({ search_type: "web" });
    expect(output.model).toBe("web");
  });

  it("takes a route's model as its search type (fast or web)", async () => {
    const { fetch, requests } = fakeFetch(perplexityReply);
    const provider = createPerplexityProvider({ apiKey: "pk", fetch });

    await provider.search!("q", { model: "web" });

    expect(provider.models).toEqual(["fast", "web"]);
    expect(requests[0]!.body).toMatchObject({ search_type: "web" });
  });

  it("gives one page of results: it has no offset", () => {
    expect(createPerplexityProvider({ apiKey: "pk" }).searchContract?.maxPages).toBe(1);
  });

  describe("narrowing a search with the Search API's own filters", () => {
    const bodyOf = async (filters: Parameters<NonNullable<ReturnType<typeof createPerplexityProvider>["search"]>>[1]["filters"]) => {
      const { fetch, requests } = fakeFetch(perplexityReply);
      await createPerplexityProvider({ apiKey: "pk", fetch, now: today }).search!("q", { filters });
      return requests[0]!.body;
    };

    it("declares every filter handled", () => {
      expect(createPerplexityProvider({ apiKey: "pk" }).searchContract?.filters).toEqual({
        includeDomains: "handled",
        excludeDomains: "handled",
        country: "handled",
        maxAgeDays: "handled",
        maxResults: "handled",
      });
    });

    it("excludes domains, keeps to a recency window, sends a country code and a result count", async () => {
      expect(await bodyOf({ excludeDomains: ["linkedin.com", " indeed.fr "], maxAgeDays: 30, country: "fr", maxResults: 10 })).toEqual({
        query: "q",
        search_type: "fast",
        max_results: 10,
        search_domain_filter: ["-linkedin.com", "-indeed.fr"],
        search_recency_filter: "month",
        country: "FR",
      });
    });

    it("keeps to Perplexity's 20 results and 20 domains", async () => {
      const domains = Array.from({ length: 25 }, (_, index) => `site${index}.fr`);
      const body = await bodyOf({ excludeDomains: domains, maxResults: 50 });
      expect(body).toMatchObject({ max_results: 20, search_domain_filter: domains.slice(0, 20).map((domain) => `-${domain}`) });
    });

    it.each([
      [1, "day"],
      [7, "week"],
      [8, "month"],
      [31, "month"],
      [200, "year"],
    ])("widens a %i-day freshness window to Perplexity's %s", async (maxAgeDays, recency) => {
      expect(await bodyOf({ maxAgeDays })).toMatchObject({ search_recency_filter: recency });
    });

    it("applies no recency filter to a window longer than a year", async () => {
      expect(await bodyOf({ maxAgeDays: 400 })).not.toHaveProperty("search_recency_filter");
    });

    it("sends included domains alone (it cannot mix them with exclusions) and drops the excluded ones from what it returns", async () => {
      const { fetch, requests } = fakeFetch(perplexityReply);

      const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {
        filters: { includeDomains: ["acme-industrie.example", "cadremploi.example"], excludeDomains: ["carrieres.acme-industrie.example"] },
      });

      expect(requests[0]!.body).toMatchObject({ search_domain_filter: ["acme-industrie.example", "cadremploi.example"] });
      expect(output.sources).toEqual(["https://www.cadremploi.example/emploi/daf-lyon-123", "https://www.apec.example/offre/daf-lyon-456"]);
    });
  });

  it("raises a provider error on an HTTP failure, with its status (e.g. 429)", async () => {
    const { fetch } = fakeFetch({ error: { message: "rate limited" } }, 429);
    await expect(createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {})).rejects.toMatchObject({ name: "AiProviderError", provider: "perplexity", status: 429 });
  });

  it("raises a provider error when a 200 response is not JSON", async () => {
    await expect(createPerplexityProvider({ apiKey: "pk", fetch: htmlFetch }).search!("q", {})).rejects.toMatchObject({
      name: "AiProviderError",
      provider: "perplexity",
      status: 200,
    });
  });

  it.skipIf(!existsSync(recordedReplyUrl))("reads the sources of a reply recorded from the live API", async () => {
    const { fetch } = fakeFetch(JSON.parse(readFileSync(recordedReplyUrl, "utf8")));

    const output = await createPerplexityProvider({ apiKey: "pk", fetch }).search!("q", {});

    expect(output.sources.length).toBeGreaterThan(0);
    for (const source of output.sources) expect(source).toMatch(/^https?:\/\//);
  });
});
