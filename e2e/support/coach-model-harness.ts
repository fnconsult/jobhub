import { createAiLayerFromEnv } from "@jobhub/ai";

// Builds the AI layer from the environment given as JSON in argv[2] (as the web app does at start-up),
// asks the AI Coach one question against a stubbed Claude endpoint, and prints the model it was sent
// to as one JSON line. No network.
const env = JSON.parse(process.argv[2] ?? "{}") as Record<string, string>;
const models: string[] = [];
const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  models.push(((await new Request(input, init).json()) as { model: string }).model);
  return new Response(
    JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } }),
    { headers: { "content-type": "application/json" } },
  );
}) as typeof globalThis.fetch;
const ai = createAiLayerFromEnv({ PERPLEXITY_API_KEY: "unused", ...env }, { fetch, usage: { record() {} } });
await ai.generate({ task: "coaching", candidateId: "c", prompt: "Bonjour" });
console.log("CM_RESULT " + JSON.stringify({ model: models[0] }));
