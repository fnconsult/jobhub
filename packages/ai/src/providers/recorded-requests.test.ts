/**
 * The requests each text provider sends, recorded byte for byte (#712): a call without `tools` must send exactly what
 * it sent before tool calling existed, so no current caller changes behaviour. The files under
 * `fixtures/requests/` were recorded before tool calling was added; a change to one is a change to what leaves.
 */
import { describe, expect, it } from "vitest";
import { createAiLayer } from "../ai-layer";
import { createMemoryUsageLog } from "../testing";
import type { AiProvider, Message, TextInput } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createMistralProvider, createOpenAiProvider } from "./chat-completions";

/** A fetch that keeps each request's URL and raw body, and answers `reply`. */
function recordingFetch(reply: unknown) {
  const requests: { url: string; body: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: await request.text() });
    return Response.json(reply);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const claudeReply = { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: "Bonjour" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
const chatReply = { model: "m", choices: [{ message: { role: "assistant", content: "Bonjour" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
const fakeGoogleAuth = { getRequestHeaders: async () => new Headers({ authorization: "Bearer google-token" }) } as never;

const ADAPTERS: [string, (fetch: typeof globalThis.fetch) => AiProvider, unknown][] = [
  ["anthropic-direct", (fetch) => createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 }), claudeReply],
  ["anthropic-bedrock", (fetch) => createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1", apiKey: "k" }, fetch, maxRetries: 0 }), claudeReply],
  ["anthropic-vertex", (fetch) => createAnthropicProvider({ endpoint: { kind: "vertex", region: "europe-west1", projectId: "p", authClient: fakeGoogleAuth }, fetch, maxRetries: 0 }), claudeReply],
  ["mistral", (fetch) => createMistralProvider({ apiKey: "k", fetch }), chatReply],
  ["openai", (fetch) => createOpenAiProvider({ apiKey: "k", dataResidency: "eu", fetch }), chatReply],
];

const INPUTS: [string, TextInput][] = [
  ["prompt", { messages: [{ role: "user", content: "Améliore mon CV" }], maxTokens: 1000 }],
  [
    "conversation",
    {
      model: undefined,
      system: "Tu es le coach Jobbbox.\n\nNote : « [NOM] ».",
      messages: [
        { role: "user", content: "Bonjour" },
        { role: "assistant", content: "Bonjour, que puis-je pour vous ?" },
        { role: "user", content: "Mes candidatures \"en cours\" ?\n- une\n- deux" },
      ],
      maxTokens: 4096,
      effort: "high",
    },
  ],
];

describe("requests without tools, byte for byte as before tool calling (#712)", () => {
  for (const [adapter, create, reply] of ADAPTERS) {
    it.each(INPUTS)(`${adapter}: %s`, async (name, input) => {
      const { fetch, requests } = recordingFetch(reply);

      await create(fetch).generate!(input);

      expect(requests).toHaveLength(1);
      await expect(`${requests[0]!.url}\n${requests[0]!.body}\n`).toMatchFileSnapshot(`./fixtures/requests/${adapter}-${name}.txt`);
    });
  }
});

describe("a call through the AI layer without tools sends the recorded request, byte for byte (#712)", () => {
  const [, conversation] = INPUTS[1]!;
  it.each(ADAPTERS.filter(([adapter]) => adapter === "anthropic-direct" || adapter === "mistral"))("%s", async (adapter, create, reply) => {
    const { fetch, requests } = recordingFetch(reply);
    const provider = create(fetch);
    const ai = createAiLayer({ providers: [provider], routes: { coaching: provider.id }, usage: createMemoryUsageLog() });

    await ai.generate({ task: "coaching", candidateId: null, system: conversation.system, prompt: conversation.messages as Message[], effort: "high", containsIdentity: false });

    await expect(`${requests[0]!.url}\n${requests[0]!.body}\n`).toMatchFileSnapshot(`./fixtures/requests/${adapter}-conversation.txt`);
  });
});
