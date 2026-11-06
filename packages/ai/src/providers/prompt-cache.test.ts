/**
 * The prompt cache of a call with tools (#790), in each text provider's own terms: Claude's `cache_control` breakpoints
 * (system text, end of the conversation asked, end of the latest message), Mistral's `prompt_cache_key`, nothing for
 * OpenAI (which caches by itself). Without `cache`, every adapter sends what it always sent (the recorded requests).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TextInput } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createMistralProvider, createOpenAiProvider } from "./chat-completions";

const answer = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/tool-calls/${name}.json`, import.meta.url), "utf8"));

function recordingFetch(reply: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(await new Request(input, init).text()) as Record<string, unknown>);
    return Response.json(reply);
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

const TOOLS = [{ name: "candidatures_lister", description: "Liste les candidatures.", parameters: { type: "object", properties: {} } }];
/** A second Turn: two messages asked, then the model's call and its result. */
const SECOND_TURN: TextInput = {
  system: "Tu es le coach Jobbbox.",
  maxTokens: 1000,
  tools: TOOLS,
  cache: { key: "c0ffee00-0000-4000-8000-000000000000", prefixMessages: 3 },
  messages: [
    { role: "user", content: "Bonjour" },
    { role: "assistant", content: "Bonjour Marie." },
    { role: "user", content: "Où en sont mes candidatures ?" },
    { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "candidatures_lister", arguments: {} }] },
    { role: "user", content: [{ type: "tool_result", id: "call_1", content: '[{"poste":"DAF"}]' }] },
  ],
};

describe("the prompt cache of a call with tools (#790)", () => {
  it("Claude: marks the system text, the end of the conversation asked and the end of the latest message, 3 breakpoints of 4", async () => {
    const { fetch, bodies } = recordingFetch(answer("anthropic-tool-use"));
    const claude = createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1", apiKey: "k" }, fetch, maxRetries: 0 });

    await claude.generate!(SECOND_TURN);

    const body = bodies[0] as { system: unknown; messages: { content: unknown }[] };
    expect(claude.promptCache).toBe("explicit");
    expect(body.system).toEqual([{ type: "text", text: "Tu es le coach Jobbbox.", cache_control: { type: "ephemeral" } }]);
    expect(body.messages.map((message) => message.content)).toEqual([
      "Bonjour",
      "Bonjour Marie.",
      [{ type: "text", text: "Où en sont mes candidatures ?", cache_control: { type: "ephemeral" } }],
      [{ type: "tool_use", id: "call_1", name: "candidatures_lister", input: {} }],
      [{ type: "tool_result", tool_use_id: "call_1", content: '[{"poste":"DAF"}]', cache_control: { type: "ephemeral" } }],
    ]);
    expect(JSON.stringify(body).match(/cache_control/g)).toHaveLength(3);
  });

  it("Claude: on the first Turn, the conversation asked and the latest message are the same one: one breakpoint there", async () => {
    const { fetch, bodies } = recordingFetch(answer("anthropic-tool-use"));

    await createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 }).generate!({ ...SECOND_TURN, messages: SECOND_TURN.messages.slice(0, 3) });

    expect(JSON.stringify(bodies[0]).match(/cache_control/g)).toHaveLength(2);
  });

  it("Claude: reads what it read from and wrote to the cache, priced apart", async () => {
    const reply = { ...(answer("anthropic-tool-use") as object), usage: { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 } };
    const { fetch } = recordingFetch(reply);

    const output = await createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 }).generate!(SECOND_TURN);

    expect(output.usage).toEqual({ inputTokens: 540, outputTokens: 20, cachedInputTokens: 3000, cacheWriteTokens: 500 });
  });

  it("Mistral: sends the call's key as prompt_cache_key, and reads its cached tokens", async () => {
    const reply = { ...(answer("mistral-tool-calls") as object), usage: { prompt_tokens: 4000, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 3584 } } };
    const { fetch, bodies } = recordingFetch(reply);
    const mistral = createMistralProvider({ apiKey: "k", fetch });

    const output = await mistral.generate!(SECOND_TURN);

    expect(mistral.promptCache).toBe("automatic");
    expect(bodies[0]).toMatchObject({ prompt_cache_key: "c0ffee00-0000-4000-8000-000000000000" });
    expect(JSON.stringify(bodies[0])).not.toContain("cache_control");
    expect(output.usage).toEqual({ inputTokens: 416, outputTokens: 30, cachedInputTokens: 3584 });
  });

  it("OpenAI: caches by itself; nothing is added to the request", async () => {
    const { fetch, bodies } = recordingFetch(answer("openai-tool-calls"));
    const openai = createOpenAiProvider({ apiKey: "k", dataResidency: "eu", fetch });

    await openai.generate!(SECOND_TURN);

    expect(openai.promptCache).toBe("automatic");
    expect(bodies[0]).not.toHaveProperty("prompt_cache_key");
  });

  it("without `cache`, nothing is marked: the request is what it always was", async () => {
    const uncached: TextInput = { ...SECOND_TURN };
    delete uncached.cache;
    for (const [create, reply] of [
      [(fetch: typeof globalThis.fetch) => createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 }), "anthropic-tool-use"],
      [(fetch: typeof globalThis.fetch) => createMistralProvider({ apiKey: "k", fetch }), "mistral-tool-calls"],
    ] as const) {
      const { fetch, bodies } = recordingFetch(answer(reply));
      await create(fetch).generate!(uncached);
      expect(JSON.stringify(bodies[0])).not.toMatch(/cache_control|prompt_cache_key/);
    }
  });
});
