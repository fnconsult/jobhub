import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { agentRunFromArgs, migrateAgentRunLog, recordAgentRun, type AgentRun } from "./index";

const connectionString = process.env.DATABASE_URL;

const run: AgentRun = {
  issueId: 31,
  workflowId: "wf-dev",
  workflowReference: ".claude/workflows/wf-dev.js@9e80939",
  workflowInstance: "wf_c2d1ad6a-1bc",
  workflowDate: new Date("2026-10-06T08:00:00.000Z"),
  agent: "wf-dev/#31/implement",
  model: "claude-opus-5-5",
  effort: "high",
  timeUsedMs: 754_000,
  roundNumber: 0,
  tokensUsed: 182_345,
};

describe.skipIf(!connectionString)("Agent Run log (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_agent_runs");
    database = throwaway.pool;
    await migrateAgentRunLog(database);
  });
  afterEach(async () => {
    await throwaway.drop();
  });

  it("records one Agent Run and stamps when it was recorded", async () => {
    const before = Date.now();
    const recorded = await recordAgentRun(database, run);

    expect(recorded).toEqual({ ...run, id: expect.any(Number), createdAt: expect.any(Date) });
    expect(recorded.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("keeps every run of the same agent, one row each", async () => {
    const first = await recordAgentRun(database, run);
    const second = await recordAgentRun(database, { ...run, agent: "wf-dev/#31/qa-r1", roundNumber: 1 });

    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ agent: "wf-dev/#31/qa-r1", roundNumber: 1 });
  });

  it("can be migrated again without losing recorded runs", async () => {
    const recorded = await recordAgentRun(database, run);

    await migrateAgentRunLog(database);
    const next = await recordAgentRun(database, run);

    expect(next.id).toBeGreaterThan(recorded.id);
  });

  it("refuses an issue or round the integer columns cannot hold instead of letting Postgres throw", async () => {
    await expect(recordAgentRun(database, { ...run, issueId: 3_000_000_000 })).rejects.toThrow(/issueId/);
    await expect(recordAgentRun(database, { ...run, roundNumber: 3_000_000_000 })).rejects.toThrow(/roundNumber/);
  });

  it("refuses an invalid run instead of recording it", async () => {
    await expect(recordAgentRun(database, { ...run, tokensUsed: -1 })).rejects.toThrow(/tokensUsed/);
  });
});

describe("agentRunFromArgs (the wf:record command line)", () => {
  const argv = [
    "--issue", "31",
    "--workflow-id", "wf-dev",
    "--workflow-ref", ".claude/workflows/wf-dev.js@9e80939",
    "--workflow-instance", "wf_c2d1ad6a-1bc",
    "--workflow-date", "2026-10-06T08:00:00.000Z",
    "--agent", "wf-dev/#31/implement",
    "--model", "claude-opus-5-5",
    "--effort", "high",
    "--time-ms", "754000",
    "--round", "0",
    "--tokens", "182345",
  ];

  it("reads an Agent Run from command-line flags", () => {
    expect(agentRunFromArgs(argv)).toEqual(run);
  });

  it("accepts --flag=value as well", () => {
    expect(agentRunFromArgs(argv.map((a, i) => (a.startsWith("--") ? `${a}=${argv[i + 1]}` : null)).filter((a) => a !== null))).toEqual(run);
  });

  it("defaults the round number to the first pass", () => {
    const i = argv.indexOf("--round");
    expect(agentRunFromArgs([...argv.slice(0, i), ...argv.slice(i + 2)]).roundNumber).toBe(0);
  });

  it("names every missing flag", () => {
    expect(() => agentRunFromArgs(["--issue", "31"])).toThrow(/--agent/);
  });

  it("refuses a non-numeric issue", () => {
    expect(() => agentRunFromArgs(argv.map((a) => (a === "31" ? "abc" : a)))).toThrow(/--issue/);
  });

  it.each(["--issue", "--round"])("refuses %s above what the database can store", (flag) => {
    const i = argv.indexOf(flag);
    const args = [...argv.slice(0, i + 1), "3000000000", ...argv.slice(i + 2)];
    expect(() => agentRunFromArgs(args)).toThrow(new RegExp(`Invalid ${flag}`));
  });

  it.each(["2026-02-30", "2026-13-01", "1", "2026-10-06T08:00:00", "yesterday", "2026-10-06T25:00:00Z"])(
    "refuses the impossible or ambiguous --workflow-date %s",
    (date) => {
      const i = argv.indexOf("--workflow-date");
      const args = [...argv.slice(0, i + 1), date, ...argv.slice(i + 2)];
      expect(() => agentRunFromArgs(args)).toThrow(/Invalid --workflow-date/);
    },
  );

  it.each([
    ["2026-10-06", "2026-10-06T00:00:00.000Z"],
    ["2026-10-06T10:00:00+02:00", "2026-10-06T08:00:00.000Z"],
    ["2026-10-06T08:00:00Z", "2026-10-06T08:00:00.000Z"],
  ])("reads the --workflow-date %s as %s", (date, iso) => {
    const i = argv.indexOf("--workflow-date");
    const args = [...argv.slice(0, i + 1), date, ...argv.slice(i + 2)];
    expect(agentRunFromArgs(args).workflowDate.toISOString()).toBe(iso);
  });

  it("refuses an unknown flag", () => {
    expect(() => agentRunFromArgs([...argv, "--colour", "red"])).toThrow(/--colour/);
  });
});
