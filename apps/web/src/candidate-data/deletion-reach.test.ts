import { createAiLayer, createProvenanceRecorder, readJobPage } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { Provenance } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, connectionString } from "../auth/test-support";
import { createJobOffers } from "../job-offers";
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

  it("AI Usage names no Candidate and holds no text, so it stays out of the data export and outlives the account; the AI Message Log does neither (#218)", async () => {
    const { rows } = await throwaway.pool.query<{ table: string; column: string }>(
      `SELECT table_name AS table, column_name AS column FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN ('ai_usage', 'ai_tool_usage', 'external_api_usage')`,
    );

    expect(new Set(rows.map((row) => row.table))).toEqual(new Set(["ai_usage", "ai_tool_usage", "external_api_usage"]));
    expect(rows.map((row) => row.column)).not.toEqual(expect.arrayContaining(["candidate_id"]));
    expect(rows.map((row) => row.column).filter((column) => /text|message|prompt|reply|system|body|payload|query/.test(column))).toEqual([]);
    for (const table of ["ai_usage", "ai_tool_usage", "external_api_usage"]) {
      expect([...tablesTiedToCandidate()]).not.toContain(table);
      expect(EXPORTED_TABLES).not.toHaveProperty(table);
    }
    expect(candidateDataTables()).toContain("ai_message_log");
  });

  it("Unanswered Questions name no Candidate and no Coach Conversation, so the Data export is unchanged and they outlive the account (#344)", async () => {
    const { rows } = await throwaway.pool.query<{ column: string }>(
      `SELECT column_name AS column FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'unanswered_question'`,
    );

    expect(rows.map((row) => row.column)).toContain("question");
    expect(rows.map((row) => row.column).filter((column) => /candidate|conversation|user|account|session/.test(column))).toEqual([]);
    expect(foreignKeys.filter((key) => key.table === "unanswered_question")).toEqual([]);
    expect([...tablesTiedToCandidate()]).not.toContain("unanswered_question");
    expect(EXPORTED_TABLES).not.toHaveProperty("unanswered_question");
  });

  it("shared Job Offers and Plan Quotas are not tied to any Candidate, so they are kept", () => {
    expect([...tablesTiedToCandidate()].filter((table) => KEPT.includes(table))).toEqual([]);
  });

  it("a shared Job Offer's Provenance names no Candidate, whoever's search found it (#329)", async () => {
    const candidateId = "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b";
    const llm = createFakeProvider({ id: "anthropic", reply: '{"isJobOffer": true, "title": "DAF H/F", "content": "Groupe Seb recrute son DAF."}' });
    const ai = createAiLayer({ providers: [llm], routes: { offer_analysis: "anthropic" }, usage: createMemoryUsageLog() });
    const reading = createProvenanceRecorder(ai);
    const details = await readJobPage(reading.aiFor("read_job_page"), candidateId, "DAF H/F. Groupe Seb recrute son DAF.");
    reading.site(`https://carrieres.groupe-seb.fr/offres/daf?candidate=${candidateId}`);
    const jobOffers = createJobOffers(throwaway.pool);

    await jobOffers.capture({ source: { url: "https://carrieres.groupe-seb.fr/offres/daf" }, ...details }, "candidate", { provenance: reading.provenance() });
    const naming = { ...reading.provenance(), steps: [{ kind: "tool", activity: "read", tool: "job-site", ms: 1, at: new Date().toISOString(), outcome: "ok", count: 1, candidateId }] };
    await jobOffers.capture({ title: "RAF", content: "Poste de RAF." }, "candidate", { provenance: naming as unknown as Provenance });

    const { rows } = await throwaway.pool.query<{ provenance: string | null }>(`SELECT provenance::text AS provenance FROM job_offer ORDER BY created_at`);
    expect(rows.map((row) => row.provenance !== null)).toEqual([true, false]);
    expect(rows.map((row) => row.provenance ?? "").join()).not.toContain(candidateId);
    expect(rows[0]!.provenance).toMatch(/"offer_analysis"/);
    expect([...tablesTiedToCandidate()]).not.toContain("job_offer");
  });
});
