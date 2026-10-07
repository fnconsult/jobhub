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
    expect(first.stdout).toContain("Applications are up to date");
    expect(first.stdout).toContain("Action Cards are up to date");
    expect(first.stdout).toContain("Plans and Plan Quotas are up to date");
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
        "application",
        "candidate",
        "candidate_plan", // issue #22: Plans and Plan Quotas
        "interview",
        "job_offer",
        "master_cv_version",
        "plan_quota",
        "profile",
        "quota_usage",
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
        ORDER BY from_table, from_column, to_table`);
      expect(references.rows).toEqual([
        { from_table: "account", from_column: "userId", to_table: "candidate" },
        { from_table: "action_card", from_column: "candidate_id", to_table: "candidate" },
        // Applications (issue #12) hang off the Candidate and their Profile; their Job Offers are kept (ADR-0010).
        { from_table: "application", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "application", from_column: "job_offer_id", to_table: "job_offer" },
        { from_table: "application", from_column: "profile_id", to_table: "profile" },
        { from_table: "candidate_plan", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "candidate_plan", from_column: "plan", to_table: "plan_quota" },
        { from_table: "interview", from_column: "application_id", to_table: "application" },
        { from_table: "master_cv_version", from_column: "profile_id", to_table: "profile" },
        { from_table: "profile", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "quota_usage", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "session", from_column: "userId", to_table: "candidate" },
      ]);
      // The Plans start with the quotas of issue #22; re-running keeps them.
      const quotas = await db.query("SELECT plan, profiles, match_scores, ats_scores, enriched_contacts, job_digest FROM plan_quota ORDER BY profiles NULLS LAST");
      expect(quotas.rows).toEqual([
        { plan: "free", profiles: 1, match_scores: 3, ats_scores: 1, enriched_contacts: 0, job_digest: "none" },
        { plan: "standard", profiles: 3, match_scores: null, ats_scores: null, enriched_contacts: 0, job_digest: "weekly" },
        { plan: "premium", profiles: null, match_scores: null, ats_scores: null, enriched_contacts: 20, job_digest: "daily" },
      ]);
    } finally {
      await db.end();
    }
  });
});
