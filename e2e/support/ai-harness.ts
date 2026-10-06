/**
 * Drives the AI layer through its public entry point, `createAiLayerFromEnv()` from "@jobhub/ai",
 * exactly as a server process would: configuration comes only from the process environment and
 * usage goes to the default (stdout) usage log.
 *
 * The network is the only thing replaced: `globalThis.fetch` is swapped for a recorder that answers
 * like each provider's API, so the suite can see what would leave the process and where it would go.
 * Nothing ever reaches a real provider.
 *
 *   tsx e2e/support/ai-harness.ts '<scenario JSON>'
 *
 * Prints usage lines (from the AI layer) and finally one line `AI_HARNESS_RESULT <json>`.
 */
import { createAiLayerFromEnv } from "@jobhub/ai";

export type HarnessCall =
  | { kind: "generate"; task: string; candidateId: string | null; system?: string; prompt: string }
  | { kind: "search"; candidateId: string | null; criteria: Record<string, unknown> };

export interface HarnessRequest {
  url: string;
  host: string;
  authorization: string | null;
  apiKeyHeader: string | null;
  body: string;
}

export type HarnessOutcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: { name: string; message: string } };

export interface HarnessResult {
  startup: { ok: true } | { ok: false; error: { name: string; message: string } };
  outcomes: HarnessOutcome[];
  requests: HarnessRequest[];
}

const requests: HarnessRequest[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "request-id": "req_e2e" } });
}

function answer(url: URL, body: string): Response {
  const parsed = body ? JSON.parse(body) : {};
  const host = url.hostname;
  // Lets a test simulate a provider outage.
  if (body.includes("E2E_PROVIDER_DOWN")) return new Response("upstream unavailable", { status: 503 });
  if (url.pathname.endsWith("/chat/completions")) {
    const reply = `reply from ${host}`;
    return json({
      id: "cmpl_e2e",
      model: parsed.model ?? "unknown",
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      ...(host === "api.perplexity.ai" ? { search_results: [{ url: "https://jobs.example/offre-1" }] } : {}),
    });
  }
  if (url.pathname.includes("/messages")) {
    return json({
      id: "msg_e2e",
      type: "message",
      role: "assistant",
      model: parsed.model ?? "claude",
      content: [{ type: "text", text: `reply from ${host}` }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 200, output_tokens: 50 },
    });
  }
  return new Response(`no fake route for ${url.href}`, { status: 404 });
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const body = await request.text();
  const url = new URL(request.url);
  requests.push({ url: url.href, host: url.hostname, authorization: request.headers.get("authorization"), apiKeyHeader: request.headers.get("x-api-key"), body });
  return answer(url, body);
};

const errorOf = (error: unknown) =>
  error instanceof Error ? { name: error.name, message: error.message } : { name: "Unknown", message: String(error) };

async function main() {
  const calls = JSON.parse(process.argv[2] ?? "[]") as HarnessCall[];
  const result: HarnessResult = { startup: { ok: true }, outcomes: [], requests };
  let ai: ReturnType<typeof createAiLayerFromEnv> | undefined;
  try {
    ai = createAiLayerFromEnv();
  } catch (error) {
    result.startup = { ok: false, error: errorOf(error) };
  }
  if (ai) {
    for (const call of calls) {
      try {
        const value =
          call.kind === "generate"
            ? await ai.generate({ task: call.task as never, candidateId: call.candidateId, system: call.system, prompt: call.prompt })
            : await ai.searchWeb({ candidateId: call.candidateId, criteria: call.criteria as never });
        result.outcomes.push({ ok: true, value: value as unknown as Record<string, unknown> });
      } catch (error) {
        result.outcomes.push({ ok: false, error: errorOf(error) });
      }
    }
  }
  process.stdout.write(`AI_HARNESS_RESULT ${JSON.stringify(result)}\n`);
}

await main();
