/**
 * Tool calling in each text provider's own format (#712, ADR-0077): Claude's `tools` / `tool_use` / `tool_result`,
 * Mistral's and OpenAI's `tools` / `tool_calls` / role `tool`. The requests are recorded under `fixtures/requests/`,
 * the answers are the providers' (`fixtures/tool-calls/`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AiProvider, TextInput, ToolDefinition } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createMistralProvider, createOpenAiProvider } from "./chat-completions";

const answer = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/tool-calls/${name}.json`, import.meta.url), "utf8"));

function recordingFetch(reply: unknown) {
  const requests: { url: string; body: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: await request.text() });
    return Response.json(reply);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const TOOLS: ToolDefinition[] = [
  {
    name: "candidatures_lister",
    description: "Liste les candidatures du Candidate, par statut.",
    parameters: { type: "object", properties: { statut: { type: "string", enum: ["envoyée", "entretien"] } }, additionalProperties: false },
  },
  { name: "agenda_lister", description: "Liste les entretiens à venir.", parameters: { type: "object", properties: {} } },
];

/** A first turn: the Candidate's message, the tools. */
const FIRST: TextInput = { system: "Tu es le coach Jobbbox.", messages: [{ role: "user", content: "Où en sont mes candidatures ?" }], maxTokens: 1000, tools: TOOLS };

/** A turn after a tool round: the model's calls, their results (one failed), then text only. */
const AFTER_ROUND: TextInput = {
  ...FIRST,
  messages: [
    { role: "user", content: "Où en sont mes candidatures ?" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Je regarde vos candidatures." },
        { type: "tool_call", id: "call_1", name: "candidatures_lister", arguments: { statut: "envoyée" } },
        { type: "tool_call", id: "call_2", name: "agenda_lister", arguments: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", id: "call_1", content: '[{"poste":"DAF","entreprise":"Globex"}]' },
        { type: "tool_result", id: "call_2", content: "Unknown tool", error: true },
      ],
    },
  ],
  toolChoice: "none",
};

const ADAPTERS: [string, (fetch: typeof globalThis.fetch) => AiProvider, string][] = [
  ["anthropic-direct", (fetch) => createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 }), "anthropic-tool-use"],
  ["anthropic-bedrock", (fetch) => createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-north-1", apiKey: "k" }, fetch, maxRetries: 0 }), "anthropic-tool-use"],
  ["mistral", (fetch) => createMistralProvider({ apiKey: "k", fetch }), "mistral-tool-calls"],
  ["openai", (fetch) => createOpenAiProvider({ apiKey: "k", dataResidency: "eu", fetch }), "openai-tool-calls"],
];

describe.each(ADAPTERS)("tool calling: %s", (adapter, create, reply) => {
  it("declares it", () => {
    expect(create(globalThis.fetch).toolCalling).toBe(true);
  });

  it("sends the tools in its format (recorded)", async () => {
    const { fetch, requests } = recordingFetch(answer(reply));

    await create(fetch).generate!(FIRST);

    await expect(`${requests[0]!.url}\n${requests[0]!.body}\n`).toMatchFileSnapshot(`./fixtures/requests/${adapter}-tools.txt`);
  });

  it("sends the model's calls and the tools' results back, an error said as one, and asks for text only (recorded)", async () => {
    const { fetch, requests } = recordingFetch(answer(reply));

    await create(fetch).generate!(AFTER_ROUND);

    await expect(`${requests[0]!.url}\n${requests[0]!.body}\n`).toMatchFileSnapshot(`./fixtures/requests/${adapter}-tool-results.txt`);
  });

  it("reads the model's tool calls, in order, with their ids and arguments", async () => {
    const { fetch } = recordingFetch(answer(reply));

    const output = await create(fetch).generate!(FIRST);

    expect(output.toolCalls).toEqual([
      { type: "tool_call", id: expect.any(String), name: "candidatures_lister", arguments: { statut: "envoyée" } },
      { type: "tool_call", id: expect.any(String), name: "agenda_lister", arguments: {} },
    ]);
    expect(output.usage.inputTokens).toBe(512);
  });
});

describe("tool calling, as each provider says it", () => {
  it("Claude: keeps its text beside its tool calls, and each call's id", async () => {
    const { fetch } = recordingFetch(answer("anthropic-tool-use"));

    const output = await createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 }).generate!(FIRST);

    expect(output.text).toBe("Je regarde vos candidatures.");
    expect(output.toolCalls?.map((call) => call.id)).toEqual(["toolu_01A09q90qw90lq917835lq9", "toolu_01B7xq2d3oKp9mN4rT6vW8yZ"]);
  });

  it("Mistral: each call's id, and no text", async () => {
    const { fetch } = recordingFetch(answer("mistral-tool-calls"));

    const output = await createMistralProvider({ apiKey: "k", fetch }).generate!(FIRST);

    expect(output.text).toBe("");
    expect(output.toolCalls?.map((call) => call.id)).toEqual(["D681PevKs", "Qm3t9XbLp"]);
  });

  it("chat completions: arguments that are not JSON are kept as written, for the AI layer to refuse", async () => {
    const garbled = answer("mistral-tool-calls") as { choices: { message: { tool_calls: { function: { arguments: string } }[] } }[] };
    garbled.choices[0]!.message.tool_calls[0]!.function.arguments = '{"statut": ';
    const { fetch } = recordingFetch(garbled);

    const output = await createMistralProvider({ apiKey: "k", fetch }).generate!(FIRST);

    expect(output.toolCalls?.[0]).toMatchObject({ name: "candidatures_lister", arguments: '{"statut": ' });
  });

  it("chat completions: arguments already an object are taken as they are", async () => {
    const asObject = answer("mistral-tool-calls") as { choices: { message: { tool_calls: { function: { arguments: unknown } }[] } }[] };
    asObject.choices[0]!.message.tool_calls[0]!.function.arguments = { statut: "entretien" };
    const { fetch } = recordingFetch(asObject);

    const output = await createMistralProvider({ apiKey: "k", fetch }).generate!(FIRST);

    expect(output.toolCalls?.[0]).toMatchObject({ arguments: { statut: "entretien" } });
  });

  it("Mistral: a call id it does not take (Claude's, once rerouted to Mistral) is sent as one it takes, the same for the call and its result", async () => {
    const { fetch, requests } = recordingFetch(answer("mistral-tool-calls"));
    const claudeIds = JSON.parse(JSON.stringify(AFTER_ROUND).replaceAll("call_1", "toolu_01A09q90qw90lq917835lq9").replaceAll("call_2", "D681PevKs")) as TextInput;

    await createMistralProvider({ apiKey: "k", fetch }).generate!(claudeIds);

    const sent = JSON.parse(requests[0]!.body) as { messages: { tool_calls?: { id: string }[]; tool_call_id?: string }[] };
    const [first, second] = sent.messages[2]!.tool_calls!.map((call) => call.id);
    expect(first).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(second).toBe("D681PevKs");
    expect(sent.messages.slice(3).map((message) => message.tool_call_id)).toEqual([first, "D681PevKs"]);
  });

  it("a reply without tool calls has none", async () => {
    const { fetch } = recordingFetch({ model: "m", choices: [{ message: { role: "assistant", content: "Bonjour" } }], usage: {} });

    const output = await createMistralProvider({ apiKey: "k", fetch }).generate!(FIRST);

    expect(output).toEqual({ text: "Bonjour", model: "m", usage: { inputTokens: 0, outputTokens: 0 } });
  });
});
