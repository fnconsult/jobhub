import { expect, it } from "vitest";
import { createMemoryUsageLog } from "./testing";
import type { UsageEntry } from "./types";
import { allUsageLogs, createConsoleUsageLog } from "./usage";

const entry: UsageEntry = {
  candidateId: "cand-1",
  task: "scoring",
  provider: "anthropic",
  endpoint: "bedrock eu-west-3",
  model: "anthropic.claude-opus-5-5",
  inputTokens: 1200,
  outputTokens: 300,
  ok: true,
  durationMs: 840,
  costEur: 0.009,
  tools: [],
  transcript: { system: "Tu notes des CV.", messages: [{ role: "user", content: "Le CV de Marie Dupont" }], reply: "82" },
  at: new Date("2026-10-06T10:00:00Z"),
};

it("writes one JSON line per AI call with the Candidate and token usage, never what the call said", () => {
  const lines: string[] = [];
  const log = createConsoleUsageLog((line) => lines.push(line));

  log.record(entry);

  expect(lines.map((line) => JSON.parse(line))).toEqual([
    {
      event: "ai_usage",
      candidateId: "cand-1",
      task: "scoring",
      provider: "anthropic",
      endpoint: "bedrock eu-west-3",
      model: "anthropic.claude-opus-5-5",
      inputTokens: 1200,
      outputTokens: 300,
      ok: true,
      durationMs: 840,
      costEur: 0.009,
      tools: [],
      at: "2026-10-06T10:00:00.000Z",
    },
  ]);
  expect(lines.join("")).not.toContain("Marie Dupont");
});

it("hands each call to every usage log, whichever of them fails", async () => {
  const kept = createMemoryUsageLog();
  const log = allUsageLogs([{ record: () => Promise.reject(new Error("insert failed")) }, { record: () => { throw new Error("down"); } }, kept], () => {});

  await log.record(entry);

  expect(kept.entries).toEqual([entry]);
});
