/**
 * Consumption (#799, ADR-0085): a per-Candidate daily count of uses per Tool, the store « Votre consommation » reads.
 * AI Usage (`ai_usage`) is another record and names no one (ADR-0007, ADR-0034); nothing here links to it.
 *
 * One small module in front of Postgres:
 *  - `countUse` one use (or `n`) of a Tool on its French day, inside the transaction of the write that already marks
 *    the use: a Coach reply's insert, a Plan Quota use, a result saved with its Provenance. Each Tool is counted at
 *    one place only (consumption-sites.test.ts);
 *  - `giveBackUse` takes back a use whose Plan Quota use was given back (an empty Job Search stopped, ADR-0037);
 *  - `createConsumption(database).forCandidate` is the read model: rows per day and Tool, totals per Tool;
 *  - `consumptionOf` is what the Data export holds;
 *  - `purgeExpiredConsumption` deletes the days more than RETENTION_MONTHS old (the worker, nightly).
 * A row holds the Candidate, the day, the Tool key and the count: no text, no result, no model, no provider, no cost.
 * Its table is the Candidate's: deleted with their account.
 */
import { consumptionTools, type ConsumptionTool } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";

export { CONSUMPTION_TOOLS, QUOTA_CONSUMPTION_TOOLS, consumptionTools, type ConsumptionTool } from "@jobhub/shared";

/** How long a day's counts are kept: 12 months, French time. */
export const RETENTION_MONTHS = 12;

/** One day's count of one Tool. `day` is the French calendar day, "2026-11-05". */
export interface ConsumptionDay {
  day: string;
  tool: ConsumptionTool;
  count: number;
}

/** What « Votre consommation » reads for a range: each day's count per Tool (none at 0), and each Tool's total. */
export interface CandidateConsumption {
  days: ConsumptionDay[];
  totals: Record<ConsumptionTool, number>;
}

export interface Consumption {
  /** The Candidate's counts from the French day of `from` to that of `to`, both included. */
  forCandidate(candidateId: string, range: { from: Date; to: Date }): Promise<CandidateConsumption>;
}

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-11-05": the calendar day of `date` in France, which a use counts on. */
export function dayInFrance(date: Date): string {
  return DAY.format(date);
}

/** Adds `n` uses of `tool` to the Candidate's count for the French day of `at`, in `within` (the caller's transaction). */
export async function countUse(within: Queryable, candidateId: string, tool: ConsumptionTool, at: Date, n = 1): Promise<void> {
  await within.query(
    `INSERT INTO consumption_day (candidate_id, day, tool, count) VALUES ($1, $2, $3, $4)
     ON CONFLICT (candidate_id, day, tool) DO UPDATE SET count = consumption_day.count + EXCLUDED.count`,
    [candidateId, dayInFrance(at), tool, n],
  );
}

/**
 * Takes back `n` uses of `tool` whose Plan Quota use was given back: from the latest day it was counted on, from the
 * French day `since` (the week of the Plan Quota use) to that of `at`. Never below 0.
 */
export async function giveBackUse(within: Queryable, candidateId: string, tool: ConsumptionTool, at: Date, { since, n = 1 }: { since: string; n?: number }): Promise<void> {
  await within.query(
    `UPDATE consumption_day SET count = GREATEST(count - $5, 0)
      WHERE (candidate_id, day, tool) = (
        SELECT candidate_id, day, tool FROM consumption_day
         WHERE candidate_id = $1 AND tool = $2 AND day BETWEEN $3::date AND $4::date AND count > 0
         ORDER BY day DESC LIMIT 1)`,
    [candidateId, tool, since, dayInFrance(at), n],
  );
}

export function createConsumption(database: Queryable): Consumption {
  return {
    async forCandidate(candidateId, { from, to }) {
      const { rows } = await database.query<ConsumptionDay>(
        `SELECT day::text AS day, tool, count FROM consumption_day
          WHERE candidate_id = $1 AND day BETWEEN $2::date AND $3::date AND count > 0`,
        [candidateId, dayInFrance(from), dayInFrance(to)],
      );
      const order = consumptionTools();
      const days = rows.sort((a, b) => a.day.localeCompare(b.day) || order.indexOf(a.tool) - order.indexOf(b.tool));
      const totals = Object.fromEntries(order.map((tool) => [tool, 0])) as Record<ConsumptionTool, number>;
      for (const { tool, count } of days) totals[tool] += count;
      return { days, totals };
    },
  };
}

/** What the Data export holds: every day's count per Tool kept, newest day first. */
export async function consumptionOf(database: Queryable, candidateId: string): Promise<ConsumptionDay[]> {
  const { rows } = await database.query<ConsumptionDay>(`SELECT day::text AS day, tool, count FROM consumption_day WHERE candidate_id = $1 AND count > 0`, [candidateId]);
  const order = consumptionTools();
  return rows.sort((a, b) => b.day.localeCompare(a.day) || order.indexOf(a.tool) - order.indexOf(b.tool));
}

/** Deletes the days more than RETENTION_MONTHS old, French time; the day exactly RETENTION_MONTHS ago stays. How many rows went. */
export async function purgeExpiredConsumption(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query(`DELETE FROM consumption_day WHERE day < $1::date - make_interval(months => $2)`, [dayInFrance(now), RETENTION_MONTHS]);
  return rowCount ?? 0;
}

/** Creates the Consumption table. Run after Candidate accounts. Safe to run repeatedly; a new Tool key widens its check. */
export async function migrateConsumption(database: Pool): Promise<void> {
  const tools = consumptionTools()
    .map((tool) => `'${tool}'`)
    .join(", ");
  await database.query(`
    -- « Votre consommation » (#799, ADR-0085): how many times a Candidate used each Tool, per French day. Nothing else:
    -- no text, no result, no model, no provider, no cost. Kept 12 months.
    CREATE TABLE IF NOT EXISTS consumption_day (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      day date NOT NULL,
      tool text NOT NULL,
      count integer NOT NULL CHECK (count >= 0),
      PRIMARY KEY (candidate_id, day, tool)
    );
    ALTER TABLE consumption_day DROP CONSTRAINT IF EXISTS consumption_day_tool_check;
    ALTER TABLE consumption_day ADD CONSTRAINT consumption_day_tool_check CHECK (tool IN (${tools}));
  `);
}
