import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";

// Issue #31: delivery workflows log one Agent Run per agent into
// `workflow_agent_run`, created by `npm run db:migrate` and filled by
// `npm run wf:record -- …`. Both commands are driven as a workflow script would,
// against a throwaway database; the table is the contract readers rely on.
const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
databaseUrl.pathname = `${databaseUrl.pathname}_agent_runs`;
const name = databaseUrl.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

async function withClient<T>(url: URL, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

const admin = (sql: string) => withClient(adminUrl, (c) => c.query(sql));
const query = (sql: string, params: unknown[] = []) => withClient(databaseUrl, (c) => c.query(sql, params));

function npm(...args: string[]) {
  return spawnSync("npm", ["run", ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    encoding: "utf8",
  });
}

const migrate = () => npm("db:migrate");
const record = (...flags: string[]) => npm("wf:record", "--", ...flags);

/** The exact command from the issue's "how to run". */
const issueExample = [
  "--issue", "31",
  "--workflow-id", "wf-dev",
  "--workflow-ref", ".claude/workflows/wf-dev.js",
  "--workflow-instance", "wf_c2d1ad6a-1bc",
  "--workflow-date", "2026-10-06T08:00:00Z",
  "--agent", "wf-dev/#31/implement",
  "--model", "claude-opus-5-5",
  "--effort", "high",
  "--time-ms", "754000",
  "--round", "0",
  "--tokens", "182345",
];

function withFlag(flags: string[], flag: string, value: string | null): string[] {
  const out: string[] = [];
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] === flag) {
      if (value !== null) out.push(flag, value);
    } else out.push(flags[i], flags[i + 1]);
  }
  return out;
}

async function schemaSnapshot() {
  const columns = await query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workflow_agent_run'
     ORDER BY ordinal_position`,
  );
  const indexes = await query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'workflow_agent_run' ORDER BY indexname",
  );
  return { columns: columns.rows, indexes: indexes.rows };
}

const rows = async () =>
  (await query("SELECT * FROM workflow_agent_run ORDER BY id")).rows as Record<string, unknown>[];

test.describe("Agent Run log (npm run db:migrate, npm run wf:record)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${name}`);
  });
  test.afterAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });

  test("db:migrate creates workflow_agent_run with every Agent Run column", async () => {
    const result = migrate();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Agent Run log is up to date");

    const { columns } = await schemaSnapshot();
    const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));
    // One column per field of the issue; all required.
    const expected: Record<string, RegExp> = {
      issue_id: /integer|bigint/,
      created_at: /timestamp with time zone/,
      workflow_id: /text|character varying/,
      workflow_reference: /text|character varying/,
      workflow_instance: /text|character varying/,
      workflow_date: /timestamp/,
      agent: /text|character varying/,
      model: /text|character varying/,
      effort: /text|character varying/,
      time_used_ms: /integer|bigint|numeric/,
      round_number: /integer|bigint|smallint/,
      tokens_used: /integer|bigint|numeric/,
    };
    for (const [column, type] of Object.entries(expected)) {
      expect(byName[column], `column ${column}`).toBeDefined();
      expect(byName[column].data_type, `type of ${column}`).toMatch(type);
      expect(byName[column].is_nullable, `${column} is required`).toBe("NO");
    }
    expect(byName.created_at.column_default).toMatch(/now\(\)|CURRENT_TIMESTAMP/i);
  });

  test("db:migrate indexes issue id and workflow instance", async () => {
    const { indexes } = await schemaSnapshot();
    const indexed = (column: string) =>
      indexes.some((i) => new RegExp(`\\(${column}\\)`).test(i.indexdef as string));
    expect(indexed("issue_id"), JSON.stringify(indexes)).toBe(true);
    expect(indexed("workflow_instance"), JSON.stringify(indexes)).toBe(true);
  });

  test("wf:record inserts exactly one row with the given values and a server-side creation date", async () => {
    const before = (await query("SELECT now() AS now")).rows[0].now as Date;
    const result = record(...issueExample);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Recorded Agent Run \d+/);

    const all = await rows();
    expect(all).toHaveLength(1);
    const row = all[0];
    expect(row).toMatchObject({
      issue_id: 31,
      workflow_id: "wf-dev",
      workflow_reference: ".claude/workflows/wf-dev.js",
      workflow_instance: "wf_c2d1ad6a-1bc",
      agent: "wf-dev/#31/implement",
      model: "claude-opus-5-5",
      effort: "high",
      round_number: 0,
    });
    // bigint columns come back from pg as strings.
    expect(Number(row.time_used_ms)).toBe(754000);
    expect(Number(row.tokens_used)).toBe(182345);
    expect((row.workflow_date as Date).toISOString()).toBe("2026-10-06T08:00:00.000Z");
    const createdAt = row.created_at as Date;
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  test("wf:record logs several Agent Runs of one workflow instance, defaulting the round to 0", async () => {
    const qa = withFlag(withFlag(issueExample, "--agent", "wf-dev/#31/qa-r1"), "--round", "1");
    expect(record(...qa).status).toBe(0);
    const noRound = withFlag(withFlag(issueExample, "--agent", "wf-dev/#31/e2e"), "--round", null);
    const result = record(...noRound);
    expect(result.status, result.stderr).toBe(0);

    const runs = (
      await query(
        "SELECT agent, round_number FROM workflow_agent_run WHERE workflow_instance = $1 AND issue_id = $2 ORDER BY id",
        ["wf_c2d1ad6a-1bc", 31],
      )
    ).rows;
    expect(runs).toEqual([
      { agent: "wf-dev/#31/implement", round_number: 0 },
      { agent: "wf-dev/#31/qa-r1", round_number: 1 },
      { agent: "wf-dev/#31/e2e", round_number: 0 },
    ]);
  });

  test("wf:record rejects missing or invalid flags without inserting anything", async () => {
    const countBefore = (await rows()).length;
    const cases: [string, string[], string][] = [
      ["missing --agent", withFlag(issueExample, "--agent", null), "--agent"],
      ["missing --tokens", withFlag(issueExample, "--tokens", null), "--tokens"],
      ["non-numeric --issue", withFlag(issueExample, "--issue", "abc"), "--issue"],
      ["negative --time-ms", withFlag(issueExample, "--time-ms", "-5"), "--time-ms"],
      ["bad --workflow-date", withFlag(issueExample, "--workflow-date", "not-a-date"), "--workflow-date"],
      ["unknown flag", [...issueExample, "--colour", "blue"], "colour"],
    ];
    for (const [label, flags, mentioned] of cases) {
      const result = record(...flags);
      expect(result.status, label).not.toBe(0);
      expect(result.stderr, label).toContain(mentioned);
    }
    expect(await rows()).toHaveLength(countBefore);
  });

  test("re-running db:migrate is a no-op: same schema, recorded Agent Runs kept", async () => {
    const schemaBefore = await schemaSnapshot();
    const rowsBefore = await rows();
    expect(rowsBefore.length).toBeGreaterThan(0);

    const again = migrate();
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("Agent Run log is up to date");

    expect(await schemaSnapshot()).toEqual(schemaBefore);
    expect(await rows()).toEqual(rowsBefore);
  });

  test("CONTEXT.md defines the Agent Run term", () => {
    const context = readFileSync("CONTEXT.md", "utf8");
    expect(context).toMatch(/\*\*Agent Run\*\*:\s*\n\S.*workflow/i);
  });
});
