import { expect, it } from "vitest";
import { createConsoleUsageLog } from "./usage";

it("writes one JSON line per AI call with the Candidate and token usage", () => {
  const lines: string[] = [];
  const log = createConsoleUsageLog((line) => lines.push(line));

  log.record({
    candidateId: "cand-1",
    task: "scoring",
    provider: "anthropic",
    endpoint: "bedrock eu-west-3",
    model: "anthropic.claude-opus-5-5",
    inputTokens: 1200,
    outputTokens: 300,
    at: new Date("2026-10-06T10:00:00Z"),
  });

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
      at: "2026-10-06T10:00:00.000Z",
    },
  ]);
});
