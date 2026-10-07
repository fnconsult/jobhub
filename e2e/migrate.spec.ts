import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import pg from "pg";

// Issue #2 / ADR-0004: `npm run db:migrate` lays Candidate accounts out so an
// Organisation layer can later sit above Candidates (a membership table
// pointing at `candidate`) without reshaping Candidate data.
const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
databaseUrl.pathname = `${databaseUrl.pathname}_migrate`;
const name = databaseUrl.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

async function admin(sql: string) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function migrate() {
  return spawnSync("npm", ["run", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    encoding: "utf8",
  });
}

test.describe("Candidate accounts database (npm run db:migrate)", () => {
  test.beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${name}`);
  });
  test.afterAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });

  test("creates the Candidate account tables, can be re-run, and keeps every account hanging off `candidate`", async () => {
    const first = migrate();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Candidate accounts are up to date");
    expect(first.stdout).toContain("Profiles are up to date");
    expect(first.stdout).toContain("Job Offers are up to date");
    expect(first.stdout).toContain("Action Cards are up to date");
    const again = migrate();
    expect(again.status, again.stderr).toBe(0);

    const db = new pg.Client({ connectionString: databaseUrl.toString() });
    await db.connect();
    try {
      const tables = await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      // Plus the Agent Run log (issue #31) and the Job Offers (issue #9), which stand apart from Candidate data.
      expect(tables.rows.map((r) => r.table_name)).toEqual([
        "account",
        "action_card",
        "candidate",
        "job_offer",
        "master_cv_version",
        "profile",
        "session",
        "verification",
        "workflow_agent_run",
      ]);

      const candidateColumns = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'candidate'",
      );
      const columns = candidateColumns.rows.map((r) => r.column_name as string);
      expect(columns).toEqual(expect.arrayContaining(["id", "email", "interfaceLanguage"]));
      // No tenant column baked into Candidates: Organisations will link to them from above.
      expect(columns.filter((c) => /organi[sz]ation|tenant/i.test(c))).toEqual([]);

      const references = await db.query(`
        SELECT tc.table_name AS from_table, kcu.column_name AS from_column, ccu.table_name AS to_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY from_table, from_column`);
      expect(references.rows).toEqual([
        { from_table: "account", from_column: "userId", to_table: "candidate" },
        { from_table: "action_card", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "master_cv_version", from_column: "profile_id", to_table: "profile" },
        { from_table: "profile", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "session", from_column: "userId", to_table: "candidate" },
      ]);
    } finally {
      await db.end();
    }
  });
});
