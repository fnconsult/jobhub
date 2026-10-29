/**
 * End-to-end (#325): the AI layer's public entry point (`createAiLayer`) with the real provider adapters, talking
 * real HTTP to a local server that stands in for the provider (the adapters' fetch is re-pointed at it).
 * Covers the acceptance criteria: result facts, Stop (HTTP request closed, abort error, `stopped` in AI Usage),
 * and callers without a signal.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiLayer } from "./ai-layer";
import { createBraveProvider } from "./providers/brave";
import { createMistralProvider } from "./providers/chat-completions";
import { createTavilyProvider } from "./providers/tavily";
import { createMemoryUsageLog } from "./testing";

let server: Server;
let port: number;
let requests: { url: string; closedEarly: boolean }[];
let handler: (req: IncomingMessage, res: ServerResponse) => void;

/** The real `fetch`, with the provider's host replaced by the local server. */
const localFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
}) as typeof globalThis.fetch;

beforeEach(async () => {
  requests = [];
  handler = (_, res) => res.end("{}");
  server = createServer((req, res) => {
    const seen = { url: req.url ?? "", closedEarly: false };
    requests.push(seen);
    res.on("close", () => {
      if (!res.writableEnded) seen.closedEarly = true;
    });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const chatReply = (res: ServerResponse) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ model: "mistral-large-latest", choices: [{ message: { content: "Bonjour" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
};

describe("every provider call reports endpoint, durationMs and outcome", () => {
  it("a text call over HTTP", async () => {
    handler = (_, res) => chatReply(res);
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "k", fetch: localFetch })], routes: { writing: "mistral" }, usage });

    const result = await ai.generate({ task: "writing", candidateId: null, prompt: "Lettre" });

    expect(result).toMatchObject({ provider: "mistral", endpoint: "api.eu.mistral.ai", outcome: "ok", text: "Bonjour" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(usage.entries[0]).toMatchObject({ endpoint: "api.eu.mistral.ai", outcome: "ok", durationMs: result.durationMs });
  });

  it("a web search over HTTP", async () => {
    handler = (_, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ answer: "Acme", results: [{ title: "Acme", url: "https://acme.example", content: "x" }] }));
    };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createTavilyProvider({ apiKey: "k", fetch: localFetch })], routes: { web_search: "tavily" }, usage, warn: () => {} });

    const result = await ai.searchCompany({ candidateId: null, employer: "Acme" });

    expect(result).toMatchObject({ provider: "tavily", outcome: "ok" });
    expect(typeof result.endpoint).toBe("string");
    expect(usage.entries[0]).toMatchObject({ endpoint: result.endpoint, outcome: "ok" });
  });
});

describe("Stop", () => {
  it("aborting a text call closes the HTTP request, rejects with the abort error and records stopped", async () => {
    handler = () => {}; // never answers
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "k", fetch: localFetch })], routes: { writing: "mistral" }, usage });
    const controller = new AbortController();

    const call = ai.generate({ task: "writing", candidateId: "cand-1", prompt: "Lettre", signal: controller.signal });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(requests[0]!.closedEarly).toBe(true));
    expect(usage.entries).toEqual([expect.objectContaining({ provider: "mistral", outcome: "failed", reason: "stopped", sent: true, inputTokens: 0, outputTokens: 0 })]);
  });

  it.each([
    ["Tavily", () => createTavilyProvider({ apiKey: "k", fetch: localFetch }), "tavily" as const],
    ["Brave", () => createBraveProvider({ apiKey: "k", fetch: localFetch }), "brave" as const],
  ])("aborting a %s web search closes the HTTP request and records stopped", async (_, make, id) => {
    handler = () => {};
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [make()], routes: { web_search: id }, usage, warn: () => {} });
    const controller = new AbortController();

    const call = ai.searchCompany({ candidateId: null, employer: "Acme", signal: controller.signal });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(requests[0]!.closedEarly).toBe(true));
    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", outcome: "failed", reason: "stopped", sent: true })]);
  });

  it("a signal aborted before the call sends no HTTP request", async () => {
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "k", fetch: localFetch })], routes: { writing: "mistral" }, usage });

    await expect(ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });

    expect(requests).toHaveLength(0);
    expect(usage.entries[0]).toMatchObject({ reason: "stopped", sent: false });
  });
});

describe("callers that pass no signal behave as today", () => {
  it("a call with no signal, and one with a live signal, both complete normally", async () => {
    handler = (_, res) => chatReply(res);
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "k", fetch: localFetch })], routes: { writing: "mistral" }, usage });

    const plain = await ai.generate({ task: "writing", candidateId: null, prompt: "Lettre" });
    const withSignal = await ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", signal: new AbortController().signal });

    expect(plain).toMatchObject({ outcome: "ok", text: "Bonjour" });
    expect(withSignal).toMatchObject({ outcome: "ok", text: "Bonjour" });
    expect(usage.entries.map((e) => e.outcome)).toEqual(["ok", "ok"]);
  });

  it("a provider failure without a signal is still a failed call, not stopped", async () => {
    handler = (_, res) => {
      res.statusCode = 500;
      res.end("boom");
    };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "k", fetch: localFetch })], routes: { writing: "mistral" }, usage });

    await expect(ai.generate({ task: "writing", candidateId: null, prompt: "Lettre" })).rejects.toThrow();

    expect(usage.entries[0]).toMatchObject({ outcome: "failed" });
    expect(usage.entries[0]!.reason).not.toBe("stopped");
  });
});
