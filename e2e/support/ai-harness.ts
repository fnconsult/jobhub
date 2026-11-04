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
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAiLayerFromEnv } from "@jobhub/ai";

/** A tool offered to the model, with what the harness's runner answers when it is run (#712). `error` and `containsIdentity` are passed on as the runner's outcome. */
export interface HarnessTool {
  name: string;
  result: string;
  error?: boolean;
  containsIdentity?: boolean;
}

export type HarnessCall =
  | {
      kind: "generate";
      task: string;
      candidateId: string | null;
      system?: string;
      prompt: string;
      containsIdentity?: boolean;
      route?: { provider: string; model?: string };
      effort?: "low" | "medium" | "high";
      tools?: HarnessTool[];
      maxToolRounds?: number;
    }
  | { kind: "search"; candidateId: string | null; criteria: Record<string, unknown>; filters?: Record<string, unknown> };

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

/** The tool call the request's latest user text scripts, when the request offers tools, allows them and has none of the call's results yet (or loops). */
function scriptedToolCall(body: Record<string, unknown> & { tools?: unknown; tool_choice?: unknown; messages?: unknown }): { name: string; args: string } | null {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return null;
  const choice = body.tool_choice;
  if (choice === "none" || choice?.type === "none") return null;
  const raw = JSON.stringify(body.messages ?? []);
  const asked = /E2E_TOOL=([\w-]+):(\{[^}]*\})/.exec(raw.replace(/\\"/g, '"'));
  if (!asked) return null;
  const answeredAlready = raw.includes('"role":"tool"') || raw.includes("tool_result");
  if (answeredAlready && !raw.includes("E2E_TOOL_LOOP")) return null;
  return { name: asked[1]!, args: asked[2]! };
}

function answer(url: URL, body: string): Response {
  const parsed = body ? JSON.parse(body) : {};
  const host = url.hostname;
  // Lets a test simulate a provider outage, or one provider rate limited (E2E_RATE_LIMITED_HOSTS, comma-separated).
  if (body.includes("E2E_PROVIDER_DOWN") || url.search.includes("E2E_PROVIDER_DOWN")) return new Response("upstream unavailable", { status: 503 });
  if ((process.env.E2E_RATE_LIMITED_HOSTS ?? "").split(",").includes(host)) return new Response("rate limited", { status: 429 });
  // Search providers (#110, #398): answer with the checked-in fixtures of their API replies.
  const fixture = (name: string) => json(JSON.parse(readFileSync(path.resolve("packages/ai/src/providers/fixtures", `${name}.json`), "utf8")));
  if (host === "api.search.brave.com" && url.pathname === "/res/v1/web/search") return fixture("brave-web-search");
  if (host === "api.tavily.com" && url.pathname === "/search") return fixture("tavily-search");
  if (host === "api.perplexity.ai" && url.pathname === "/search") {
    // E2E_PERPLEXITY_REPLY: a recorded Search API response (JSON file) to answer with instead.
    const recorded = process.env.E2E_PERPLEXITY_REPLY;
    if (recorded) return json(JSON.parse(readFileSync(recorded, "utf8")));
    return json({ id: "search_e2e", results: [{ title: "Offre", url: "https://jobs.example/offre-1", snippet: `reply from ${host}`, date: null, last_updated: null }] });
  }
  // Tool calling (#712): a prompt holding "E2E_TOOL=<name>:<json>" has the model, offered tools and not told to answer in text,
  // call that tool (again after each result when it also holds "E2E_TOOL_LOOP"); otherwise it answers in text.
  const toolCall = scriptedToolCall(parsed);
  if (url.pathname.endsWith("/chat/completions")) {
    if (toolCall) {
      return json({
        id: "cmpl_e2e_tool",
        model: parsed.model ?? "unknown",
        choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: `call${requests.length}`, type: "function", function: { name: toolCall.name, arguments: toolCall.args } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      });
    }
    const reply = `reply from ${host}`;
    return json({
      id: "cmpl_e2e",
      model: parsed.model ?? "unknown",
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    });
  }
  if (url.pathname.includes("/messages")) {
    if (toolCall) {
      return json({
        id: "msg_e2e_tool",
        type: "message",
        role: "assistant",
        model: parsed.model ?? "claude",
        content: [{ type: "tool_use", id: `toolu_${requests.length}`, name: toolCall.name, input: JSON.parse(toolCall.args) }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 200, output_tokens: 50 },
      });
    }
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
    // E2E_EU_AI_CONSENT: comma-separated Candidate ids who gave EU AI consent (stands for the account's stored consent).
    const consenting = (process.env.E2E_EU_AI_CONSENT ?? "").split(",").filter(Boolean);
    ai = createAiLayerFromEnv(process.env, { euAiConsent: async (candidateId) => consenting.includes(candidateId) });
  } catch (error) {
    result.startup = { ok: false, error: errorOf(error) };
  }
  if (ai) {
    for (const call of calls) {
      try {
        const executed: { name: string; arguments: unknown; round: number }[] = [];
        const tools = call.kind === "generate" ? call.tools : undefined;
        const value =
          call.kind === "generate"
            ? await ai.generate({
                task: call.task as never,
                candidateId: call.candidateId,
                system: call.system,
                prompt: call.prompt,
                containsIdentity: call.containsIdentity,
                route: call.route as never,
                ...(call.effort ? { effort: call.effort } : {}),
                ...(tools
                  ? {
                      tools: tools.map((tool) => ({ name: tool.name, description: `The ${tool.name} tool`, parameters: { type: "object", properties: {} } })),
                      ...(call.maxToolRounds !== undefined ? { maxToolRounds: call.maxToolRounds } : {}),
                      runTool: async (run) => {
                        executed.push({ name: run.name, arguments: run.arguments, round: run.round });
                        const tool = tools.find((each) => each.name === run.name)!;
                        return { content: tool.result, ...(tool.error ? { error: true } : {}), ...(tool.containsIdentity ? { containsIdentity: true } : {}) };
                      },
                    }
                  : {}),
              })
            : await ai.searchWeb({ candidateId: call.candidateId, criteria: call.criteria as never, filters: call.filters as never });
        result.outcomes.push({ ok: true, value: { ...(value as unknown as Record<string, unknown>), ...(tools ? { executed } : {}) } });
      } catch (error) {
        result.outcomes.push({ ok: false, error: errorOf(error) });
      }
    }
  }
  process.stdout.write(`AI_HARNESS_RESULT ${JSON.stringify(result)}\n`);
}

await main();
