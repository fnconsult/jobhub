/**
 * Stop (#325): every provider adapter passes its call's AbortSignal to the HTTP request, which aborting stops, and
 * rejects with the signal's reason, never a provider error. Without a signal, a call is as before.
 */
import { describe, expect, it, vi } from "vitest";
import { createAiLayer } from "../ai-layer";
import { AiProviderError } from "../errors";
import { createMemoryUsageLog } from "../testing";
import type { AiProvider } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createBraveProvider } from "./brave";
import { createMistralProvider, createOpenAiProvider } from "./chat-completions";
import { createPerplexityProvider } from "./perplexity";
import { createTavilyProvider } from "./tavily";

/** A fetch that never answers: its request waits until its signal aborts, then rejects as `fetch` does. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal) return new Promise(() => {});
    signals.push(signal);
    return new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof globalThis.fetch;
  return { fetch, signals };
}

type Adapter = (fetch: typeof globalThis.fetch) => AiProvider;

const TEXT: [string, Adapter][] = [
  ["Claude, direct API", (fetch) => createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 })],
  ["Claude on Bedrock", (fetch) => createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1", apiKey: "k" }, fetch, maxRetries: 0 })],
  ["Mistral", (fetch) => createMistralProvider({ apiKey: "k", fetch })],
  ["OpenAI", (fetch) => createOpenAiProvider({ apiKey: "k", dataResidency: "eu", fetch })],
];

const SEARCH: [string, Adapter][] = [
  ["Perplexity", (fetch) => createPerplexityProvider({ apiKey: "k", fetch })],
  ["Brave", (fetch) => createBraveProvider({ apiKey: "k", fetch })],
  ["Tavily", (fetch) => createTavilyProvider({ apiKey: "k", fetch })],
];

const textInput = { messages: [{ role: "user" as const, content: "Bonjour" }], maxTokens: 100 };

describe("aborting a provider call stops its HTTP request and rejects with the abort error (#325)", () => {
  it.each(TEXT)("%s", async (_, adapter) => {
    const { fetch, signals } = hangingFetch();
    const controller = new AbortController();

    const call = adapter(fetch).generate!({ ...textInput, signal: controller.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    const error = await call.catch((rejected: unknown) => rejected);
    expect(error).toBe(controller.signal.reason);
    expect(error).not.toBeInstanceOf(AiProviderError);
    expect(signals[0]!.aborted).toBe(true);
  });

  it.each(SEARCH)("%s", async (_, adapter) => {
    const { fetch, signals } = hangingFetch();
    const controller = new AbortController();

    const call = adapter(fetch).search!("Acme actualités", { signal: controller.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    const error = await call.catch((rejected: unknown) => rejected);
    expect(error).toBe(controller.signal.reason);
    expect(error).not.toBeInstanceOf(AiProviderError);
    expect(signals[0]!.aborted).toBe(true);
  });

  it.each([...TEXT, ...SEARCH])("%s: a network failure without an abort is still a provider error", async (_, adapter) => {
    const failing = (async () => Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    const provider = adapter(failing);

    const call = provider.generate ? provider.generate({ ...textInput, signal: new AbortController().signal }) : provider.search!("Acme", { signal: new AbortController().signal });

    await expect(call).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("through the AI layer (#325)", () => {
  it("stopping a call to Claude on Bedrock stops its HTTP request, rejects with the abort error and records it stopped in AI Usage", async () => {
    const { fetch, signals } = hangingFetch();
    const usage = createMemoryUsageLog();
    const claude = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1", apiKey: "k" }, fetch, maxRetries: 0 });
    const ai = createAiLayer({ providers: [claude], routes: { coaching: "anthropic" }, usage });
    const controller = new AbortController();

    const call = ai.generate({ task: "coaching", candidateId: "cand-1", prompt: "Bonjour", signal: controller.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0]!.aborted).toBe(true);
    expect(usage.entries).toEqual([
      expect.objectContaining({ provider: "anthropic", endpoint: "bedrock eu-north-1", outcome: "failed", reason: "stopped", sent: true, inputTokens: 0, outputTokens: 0 }),
    ]);
  });
});
