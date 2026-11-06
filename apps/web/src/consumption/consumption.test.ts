import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { inTransaction } from "../database/pool";
import { consumptionOf, countUse, createConsumption, dayInFrance, giveBackUse, migrateConsumption, purgeExpiredConsumption, RETENTION_MONTHS } from "./index";

describe("dayInFrance — the French day a use counts on", () => {
  it("is the calendar day in Paris, winter and summer time", () => {
    expect(dayInFrance(new Date("2026-11-05T22:59:00Z"))).toBe("2026-11-05");
    expect(dayInFrance(new Date("2026-11-05T23:00:00Z"))).toBe("2026-11-06");
    expect(dayInFrance(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
    expect(dayInFrance(new Date("2026-07-14T22:00:00Z"))).toBe("2026-07-15");
  });
});

describe.skipIf(!connectionString)("Consumption: a per-Candidate daily count of uses per Tool (#799, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  const NOW = new Date("2026-11-05T10:00:00Z");
  const at = (iso: string) => new Date(iso);

  async function candidate(id: string) {
    await database.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, 'fr', $3, $3)`, [
      id,
      `${id}@example.fr`,
      "2026-01-15T10:00:00Z",
    ]);
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateConsumption(database);
    await migrateConsumption(database); // safe to run twice
    await candidate("marie");
    await candidate("john");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("counts each use on its French day, per Tool, and reads them back per day with totals per Tool for the range", async () => {
    await countUse(database, "marie", "coach", at("2026-11-04T08:00:00Z"));
    await countUse(database, "marie", "coach", at("2026-11-04T23:30:00Z")); // 00:30 on the 5th in Paris
    await countUse(database, "marie", "coach", NOW);
    await countUse(database, "marie", "matchScore", NOW, 2);
    await countUse(database, "john", "coach", NOW);

    const consumption = createConsumption(database);
    const read = await consumption.forCandidate("marie", { from: at("2026-11-01T00:00:00Z"), to: NOW });

    expect(read.days).toEqual([
      { day: "2026-11-04", tool: "coach", count: 1 },
      { day: "2026-11-05", tool: "coach", count: 2 },
      { day: "2026-11-05", tool: "matchScore", count: 2 },
    ]);
    expect(read.totals).toEqual({ coach: 3, jobSearch: 0, matchScore: 2, tailoredCv: 0, tailoredDocument: 0, atsScore: 0, companyDossier: 0, enrichedContact: 0, cvReading: 0 });
    // The range is in French days, both ends included.
    const fifth = await consumption.forCandidate("marie", { from: at("2026-11-04T23:00:00Z"), to: at("2026-11-05T22:59:00Z") });
    expect(fifth.totals.coach).toBe(2);
    expect((await consumption.forCandidate("john", { from: NOW, to: NOW })).totals.coach).toBe(1);
  });

  it("counts within the caller's transaction: rolled back with the write that marks the use", async () => {
    await expect(
      inTransaction(database, async (client) => {
        await countUse(client, "marie", "tailoredCv", NOW);
        throw new Error("the result could not be saved");
      }),
    ).rejects.toThrow();

    expect((await createConsumption(database).forCandidate("marie", { from: NOW, to: NOW })).days).toEqual([]);
  });

  it("gives a use back on the latest day it counted since the given day, never below 0", async () => {
    await countUse(database, "marie", "jobSearch", at("2026-11-02T09:00:00Z"));
    await countUse(database, "marie", "jobSearch", at("2026-11-04T09:00:00Z"));

    // Given back the next day: the 4th's use, the latest since Monday the 2nd.
    await giveBackUse(database, "marie", "jobSearch", NOW, { since: "2026-11-02" });
    await giveBackUse(database, "marie", "jobSearch", NOW, { since: "2026-11-03" });

    const read = await createConsumption(database).forCandidate("marie", { from: at("2026-11-01T00:00:00Z"), to: NOW });
    expect(read.days).toEqual([{ day: "2026-11-02", tool: "jobSearch", count: 1 }]);
    expect(read.totals.jobSearch).toBe(1);
    const { rows } = await database.query(`SELECT min(count) AS lowest FROM consumption_day`);
    expect(rows[0].lowest).toBeGreaterThanOrEqual(0);
  });

  it("is in the Data export: day, Tool key and count, newest day first", async () => {
    await countUse(database, "marie", "coach", at("2026-10-01T10:00:00Z"));
    await countUse(database, "marie", "cvReading", NOW);
    await countUse(database, "marie", "coach", NOW);
    await countUse(database, "john", "coach", NOW);

    expect(await consumptionOf(database, "marie")).toEqual([
      { day: "2026-11-05", tool: "coach", count: 1 },
      { day: "2026-11-05", tool: "cvReading", count: 1 },
      { day: "2026-10-01", tool: "coach", count: 1 },
    ]);
  });

  it(`purges the days more than ${RETENTION_MONTHS} months old (French time); the day 12 months ago stays`, async () => {
    await countUse(database, "marie", "coach", at("2025-11-04T12:00:00Z"));
    await countUse(database, "marie", "coach", at("2025-11-05T12:00:00Z"));
    await countUse(database, "marie", "coach", NOW);

    // 00:30 on the 5th in Paris: the 4th of November 2025 is 12 months and a day old, the 5th exactly 12 months.
    expect(await purgeExpiredConsumption(database, at("2026-11-04T23:30:00Z"))).toBe(1);
    expect((await consumptionOf(database, "marie")).map((row) => row.day)).toEqual(["2026-11-05", "2025-11-05"]);
    expect(await purgeExpiredConsumption(database, at("2026-11-05T23:30:00Z"))).toBe(1);
    expect(await purgeExpiredConsumption(database, at("2026-11-05T23:30:00Z"))).toBe(0);
    expect(await consumptionOf(database, "marie")).toEqual([{ day: "2026-11-05", tool: "coach", count: 1 }]);
  });

  it("goes with the account: deleting the Candidate leaves no row", async () => {
    await countUse(database, "marie", "coach", NOW);
    await countUse(database, "john", "coach", NOW);
    await database.query(`DELETE FROM candidate WHERE id = $1`, ["marie"]);

    const { rows } = await database.query(`SELECT candidate_id FROM consumption_day`);
    expect(rows).toEqual([{ candidate_id: "john" }]);
  });

  it("holds nothing that could identify a result, a model or a provider: only the Candidate, the day, the Tool and the count", async () => {
    const { rows: columns } = await database.query<{ column: string; type: string }>(
      `SELECT column_name AS column, data_type AS type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'consumption_day' ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      { column: "candidate_id", type: "text" },
      { column: "day", type: "date" },
      { column: "tool", type: "text" },
      { column: "count", type: "integer" },
    ]);
    const { rows: references } = await database.query<{ references: string }>(
      `SELECT confrelid::regclass::text AS references FROM pg_constraint WHERE contype = 'f' AND conrelid = 'consumption_day'::regclass`,
    );
    expect(references).toEqual([{ references: "candidate" }]);
    // Only the Tool keys, so no text can slip in as one.
    await expect(countUse(database, "marie", "claude-opus-5-5" as never, NOW)).rejects.toThrow();
  });
});
