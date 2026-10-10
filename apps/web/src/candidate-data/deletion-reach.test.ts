import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, connectionString } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";

/** Tables kept when a Candidate is deleted (ADR-0010): shared, not personal data. */
const KEPT = ["job_offer", "plan_quota"];

interface ForeignKey {
  table: string;
  references: string;
  onDelete: "cascade" | "other";
}

describe.skipIf(!connectionString)("What deleting a Candidate reaches, across every table (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let foreignKeys: ForeignKey[];

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_deletion_reach");
    await migrateDatabase({ database: throwaway.pool, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-0123", mailer: { send: async () => {} } });
    const { rows } = await throwaway.pool.query<ForeignKey>(
      `SELECT c.conrelid::regclass::text AS table, c.confrelid::regclass::text AS references,
              CASE c.confdeltype WHEN 'c' THEN 'cascade' ELSE 'other' END AS "onDelete"
         FROM pg_constraint c WHERE c.contype = 'f'`,
    );
    foreignKeys = rows;
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  /** Every table holding rows tied to a Candidate: theirs, and those hanging off them, however deep. */
  function tablesTiedToCandidate(): Set<string> {
    const tied = new Set(["candidate"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const key of foreignKeys) {
        if (tied.has(key.references) && !tied.has(key.table)) {
          tied.add(key.table);
          grew = true;
        }
      }
    }
    return tied;
  }

  it("every table tied to a Candidate, directly or through their Profiles, Applications..., is deleted with them", () => {
    const blocking = foreignKeys.filter((key) => tablesTiedToCandidate().has(key.references) && key.onDelete !== "cascade");

    expect(blocking).toEqual([]);
    expect([...tablesTiedToCandidate()]).toEqual(expect.arrayContaining(["profile", "master_cv_version", "application", "tailored_cv", "tailored_document", "session"]));
  });

  it("every table naming a Candidate hangs off the Candidate table, so none is forgotten", async () => {
    const { rows } = await throwaway.pool.query<{ table: string }>(
      `SELECT table_name AS table FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name IN ('candidate_id', 'userId', 'user_id')`,
    );

    expect(rows.length).toBeGreaterThan(5);
    const loose = rows.map((row) => row.table).filter((table) => !tablesTiedToCandidate().has(table));

    expect(loose).toEqual([]);
  });

  it("shared Job Offers and Plan Quotas are not tied to any Candidate, so they are kept", () => {
    expect([...tablesTiedToCandidate()].filter((table) => KEPT.includes(table))).toEqual([]);
  });
});
