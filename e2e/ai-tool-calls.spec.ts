import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { HarnessCall, HarnessResult } from "./support/ai-harness";

// AI layer: tool calling and its bounded loop (#712, ADR-0077). Like ai.spec.ts, each test boots the AI layer through its
// public entry point `createAiLayerFromEnv()` in a fresh process (support/ai-harness.ts), offers tools to a text call and
// observes what would leave the process (recorded requests) and the AI Usage lines written to stdout. The harness's fake
// providers answer a prompt holding `E2E_TOOL=<name>:<json>` with a tool call; the caller's tool runner is scripted.

/** A parsed provider request or reply: JSON whose shape the test checks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/ai-harness.ts");

interface UsageLine {
  event: "ai_usage";
  candidateId: string | null;
  task: string;
  provider: string;
  endpoint: string;
  inputTokens: number;
  outputTokens: number;
  outcome: string;
  costEur: number;
}

function runAi(env: Record<string, string>, calls: HarnessCall[]) {
  const result = spawnSync(tsx, [harness, JSON.stringify(calls)], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  const lines = result.stdout.split("\n");
  const resultLine = lines.find((line) => line.startsWith("AI_HARNESS_RESULT "));
  if (!resultLine) throw new Error(`AI harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  const usage = lines.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as UsageLine).filter((l) => l.event === "ai_usage");
  return { ...(JSON.parse(resultLine.slice("AI_HARNESS_RESULT ".length)) as HarnessResult), usage };
}

const KEYS = {
  AWS_BEARER_TOKEN_BEDROCK: "test-bedrock-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  MISTRAL_API_KEY: "test-mistral-key",
  OPENAI_API_KEY: "test-openai-key",
  PERPLEXITY_API_KEY: "test-perplexity-key",
};

const ask = (over: Partial<Extract<HarnessCall, { kind: "generate" }>> = {}, marker = 'E2E_TOOL=lookup:{"q":"x"}'): HarnessCall => ({
  kind: "generate",
  task: "writing",
  candidateId: "cand-1",
  prompt: `Cherche. ${marker}`,
  tools: [{ name: "lookup", result: "found: 3 offers" }],
  ...over,
});
const value = (r: ReturnType<typeof runAi>, index = 0) => {
  expect(r.startup).toEqual({ ok: true });
  const outcome = r.outcomes[index]!;
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
  return (outcome as { value: Json }).value;
};
const bodies = (r: ReturnType<typeof runAi>) => r.requests.map((req) => JSON.parse(req.body) as Json);

test.describe("AI layer: tool calling per provider (#712)", () => {
  test("Anthropic: tools, tool_use and tool_result, then the text answer", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "anthropic" }, [ask()]);
    const v = value(r);
    expect(v.text).toBe("reply from api.anthropic.com");
    expect(v.executed).toEqual([{ name: "lookup", arguments: { q: "x" }, round: 1 }]);
    const [first, second] = bodies(r);
    expect(r.requests.map((req) => req.host)).toEqual(["api.anthropic.com", "api.anthropic.com"]);
    expect(first!.tools).toEqual([expect.objectContaining({ name: "lookup", input_schema: expect.any(Object) })]);
    const blocks = second!.messages.flatMap((m: Json) => (Array.isArray(m.content) ? m.content : []));
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_use", name: "lookup", input: { q: "x" } }),
        expect.objectContaining({ type: "tool_result", content: expect.stringContaining("found: 3 offers") }),
      ]),
    );
    const use = blocks.find((b: Json) => b.type === "tool_use");
    expect(blocks.find((b: Json) => b.type === "tool_result").tool_use_id).toBe(use.id);
  });

  for (const [provider, host] of [
    ["mistral", "api.eu.mistral.ai"],
    ["openai", "eu.api.openai.com"],
  ] as const) {
    test(`${provider}: tools, tool_calls and the tool role, then the text answer`, () => {
      const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: provider }, [ask()]);
      const v = value(r);
      expect(v.text).toBe(`reply from ${host}`);
      expect(v.executed).toHaveLength(1);
      const [first, second] = bodies(r);
      expect(first!.tools).toEqual([expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "lookup" }) })]);
      const assistant = second!.messages.find((m: Json) => m.role === "assistant" && m.tool_calls);
      expect(assistant.tool_calls[0]).toMatchObject({ type: "function", function: { name: "lookup" } });
      const tool = second!.messages.find((m: Json) => m.role === "tool");
      expect(tool).toMatchObject({ tool_call_id: assistant.tool_calls[0].id, content: expect.stringContaining("found: 3 offers") });
    });
  }
});

test.describe("AI layer: the tool loop is bounded, and the model never runs a tool (#712)", () => {
  test("a model that keeps calling tools gets maxToolRounds rounds, then a last turn asking for text only", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "mistral" }, [ask({ maxToolRounds: 2 }, 'E2E_TOOL_LOOP E2E_TOOL=lookup:{"q":"x"}')]);
    const v = value(r);
    expect(v.executed.map((e: Json) => e.round)).toEqual([1, 2]);
    expect(r.requests).toHaveLength(3);
    const all = bodies(r);
    expect(all[0]!.tool_choice).toBeUndefined();
    expect(all[2]!.tool_choice).toBe("none");
    expect(v.text).toBe("reply from api.eu.mistral.ai");
  });

  test("maxToolRounds 0: one turn asking for text only, no tool run", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "anthropic" }, [ask({ maxToolRounds: 0 })]);
    const v = value(r);
    expect(v.executed).toEqual([]);
    expect(r.requests).toHaveLength(1);
  });

  for (const provider of ["anthropic", "mistral"]) {
    test(`${provider}: an unknown tool is not executed; the model gets an error result`, () => {
      const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: provider }, [ask({}, 'E2E_TOOL=delete_everything:{"all":true}')]);
      // The fake only scripts a call when tools are offered; it calls a tool the request never defined.
      const v = value(r);
      expect(v.executed).toEqual([]);
      const second = bodies(r)[1]!;
      const sent = JSON.stringify(second.messages);
      expect(sent).toContain("Unknown tool");
      expect(sent).toContain("delete_everything");
      if (provider === "anthropic") expect(sent).toContain('"is_error":true');
    });
  }
});

test.describe("AI layer: Redaction and identity rerouting apply to tool results (#712)", () => {
  const leaky = { name: "lookup", result: "Contact : jean.dupont@example.fr, 06 12 34 56 78" };

  test("a tool result holding an email address and a phone number leaves redacted", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "anthropic" }, [ask({ tools: [leaky] })]);
    value(r);
    const second = r.requests[1]!.body;
    expect(second).not.toMatch(/jean\.dupont@example\.fr|06 12 34 56 78/);
    expect(second).toContain("[E-MAIL]");
    expect(second).toContain("[TÉLÉPHONE]");
  });

  test("a tool result carrying the Identity block sends the next turn to the EU AI Consent route (Mistral) for a consenting Candidate", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "anthropic", E2E_EU_AI_CONSENT: "cand-1" }, [ask({ tools: [{ ...leaky, containsIdentity: true }] })]);
    value(r);
    expect(r.requests.map((req) => req.host)).toEqual(["api.anthropic.com", "api.eu.mistral.ai"]);
    expect(r.usage.map((u) => u.provider)).toEqual(["anthropic", "mistral"]);
  });

  test("without the Candidate's consent, the identity never reaches the first provider unredacted and the call stays on its route", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "anthropic" }, [ask({ tools: [{ ...leaky, containsIdentity: true }] })]);
    value(r);
    for (const req of r.requests) expect(req.body).not.toMatch(/jean\.dupont@example\.fr|06 12 34 56 78/);
    expect(r.requests.every((req) => req.host !== "api.eu.mistral.ai")).toBe(true);
  });
});

test.describe("AI layer: AI Usage records one line per turn (#712)", () => {
  test("N turns are N ai_usage lines, same task, and the answer's cost is their sum", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "mistral" }, [ask({ maxToolRounds: 2 }, 'E2E_TOOL_LOOP E2E_TOOL=lookup:{"q":"x"}')]);
    const v = value(r);
    expect(r.requests).toHaveLength(3);
    expect(r.usage).toHaveLength(3);
    for (const line of r.usage) expect(line).toMatchObject({ candidateId: "cand-1", task: "writing", provider: "mistral", outcome: "ok" });
    const sum = (pick: (l: UsageLine) => number) => r.usage.reduce((total, l) => total + pick(l), 0);
    expect(v.usage.inputTokens).toBe(sum((l) => l.inputTokens));
    expect(v.usage.outputTokens).toBe(sum((l) => l.outputTokens));
    expect(sum((l) => l.costEur)).toBeGreaterThan(0);
    expect(v.costEur).toBeCloseTo(sum((l) => l.costEur), 10);
    expect(v.turns).toHaveLength(3);
  });

  test("a call that answers at once is a single line", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "anthropic" }, [ask({}, "no tool wanted")]);
    value(r);
    expect(r.usage).toHaveLength(1);
  });
});

test.describe("AI layer: callers without tools are unchanged (#712)", () => {
  const plain = (task: string): HarnessCall => ({ kind: "generate", task, candidateId: "cand-1", system: "Sys.", prompt: "Jean Dupont, jean.dupont@example.fr. Dev TS." });
  for (const provider of ["anthropic", "mistral", "openai"]) {
    test(`${provider}: the request is byte for byte the same with no tools or with an empty list of them`, () => {
      const env = { ...KEYS, AI_WRITING_PROVIDER: provider };
      const without = runAi(env, [plain("writing")]);
      const empty = runAi(env, [{ ...plain("writing"), tools: [] } as HarnessCall]);
      value(without);
      value(empty);
      expect(without.requests).toHaveLength(1);
      expect(empty.requests[0]!.body).toBe(without.requests[0]!.body);
      expect(without.requests[0]!.body).not.toMatch(/"tools?"|tool_choice|tool_calls|tool_use/);
      expect(without.usage).toHaveLength(1);
    });
  }
});
