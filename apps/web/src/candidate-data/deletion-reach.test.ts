import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, connectionString } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { EXPORTED_TABLES, OPERATIONS_RECORD_TABLES } from "./index";

/** Tables kept when a Candidate is deleted (ADR-0010): shared, not personal data. */
const KEPT = ["job_offer", "plan_quota"];

interface ForeignKey {
  table: string;
  references: string;
  onDelete: "cascade" | "set null" | "other";
}

describe.skipIf(!connectionString)("What deleting or exporting a Candidate reaches, across every table (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let foreignKeys: ForeignKey[];

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_deletion_reach");
    await migrateDatabase({ database: throwaway.pool, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-0123", mailer: { send: async () => {} } });
    const { rows } = await throwaway.pool.query<ForeignKey>(
      `SELECT c.conrelid::regclass::text AS table, c.confrelid::regclass::text AS references,
              CASE c.confdeltype WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' ELSE 'other' END AS "onDelete"
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

  /** The tables of the Candidate's own data: those tied to them, but Jobbbox's operations record. */
  function candidateDataTables(): string[] {
    return [...tablesTiedToCandidate()].filter((table) => !(table in OPERATIONS_RECORD_TABLES));
  }

  it("every table tied to a Candidate, directly or through their Profiles, Applications..., is deleted with them", () => {
    const blocking = foreignKeys.filter((key) => tablesTiedToCandidate().has(key.references) && candidateDataTables().includes(key.table) && key.onDelete !== "cascade");

    expect(blocking).toEqual([]);
    expect([...tablesTiedToCandidate()]).toEqual(expect.arrayContaining(["profile", "master_cv_version", "application", "tailored_cv", "tailored_document", "session", "coach_conversation", "coach_message", "coach_memory_item"]));
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

  it("every table tied to a Candidate is in their data export (GDPR art. 15 / 20), so a new table cannot be left out of it", () => {
    const missing = candidateDataTables().filter((table) => !(table in EXPORTED_TABLES));

    expect(missing).toEqual([]);
  });

  it("Jobbbox's operations record outlives the Candidate: their id is set to null, nothing hangs off it, and it is not exported", () => {
    for (const table of Object.keys(OPERATIONS_RECORD_TABLES)) {
      expect(foreignKeys.filter((key) => key.table === table && key.references === "candidate")).toEqual([{ table, references: "candidate", onDelete: "set null" }]);
      expect(foreignKeys.filter((key) => key.references === table)).toEqual([]);
      expect(EXPORTED_TABLES).not.toHaveProperty(table);
    }
  });

  it("Provider Secrets name no Candidate, so they are never swept into a Candidate's data export (#208)", async () => {
    const { rows } = await throwaway.pool.query<{ column: string }>(
      `SELECT column_name AS column FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'provider_secret'`,
    );

    expect(rows.map((row) => row.column)).toContain("ciphertext");
    expect(rows.map((row) => row.column)).not.toEqual(expect.arrayContaining(["candidate_id"]));
    expect([...tablesTiedToCandidate()]).not.toContain("provider_secret");
    expect(EXPORTED_TABLES).not.toHaveProperty("provider_secret");
  });

  it("shared Job Offers and Plan Quotas are not tied to any Candidate, so they are kept", () => {
    expect([...tablesTiedToCandidate()].filter((table) => KEPT.includes(table))).toEqual([]);
  });
});
