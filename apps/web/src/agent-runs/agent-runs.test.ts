import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  let admin: Pool;
  let database: Pool;
  let name: string;

  beforeEach(async () => {
    name = `test_agent_runs_${randomUUID().replaceAll("-", "")}`;
    admin = new Pool({ connectionString });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(connectionString!);
    url.pathname = `/${name}`;
    database = new Pool({ connectionString: url.toString() });
    await migrateAgentRunLog(database);
  });
  afterEach(async () => {
    await database.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
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

  it("refuses an unknown flag", () => {
    expect(() => agentRunFromArgs([...argv, "--colour", "red"])).toThrow(/--colour/);
  });
});
