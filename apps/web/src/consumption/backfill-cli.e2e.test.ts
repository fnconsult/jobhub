// End-to-end for #800 through its public entry point: the CLI an operator runs once per environment
// (`npm run db:backfill-consumption -- --live-from YYYY-MM-DD`, docs/ops/consumption-backfill.md), as a real process.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, connectionString } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { countUse } from "./index";

const run = promisify(execFile);
const webRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const repoRoot = resolve(webRoot, "../..");

/** A UTC midnight-noon instant `days` before today, so the test follows the real clock the CLI reads. */
function daysAgo(days: number, hour = 12): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

describe.skipIf(!connectionString)("Consumption backfill CLI, end to end (#800, needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  let url: string;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_consumption_backfill_cli");
    database = throwaway.pool;
    const u = new URL(connectionString!);
    u.pathname = `/${throwaway.name}`;
    url = u.toString();
    await migrateDatabase({ database, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-0123", mailer: { send: async () => {} } });
    await database.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt") VALUES ('marie', 'marie', 'marie@example.fr', true, 'fr', now(), now())`);
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  /** The operator's command line, as a process; resolves with its exit code and output either way. */
  async function backfill(...args: string[]) {
    try {
      const { stdout, stderr } = await run(resolve(repoRoot, "node_modules/.bin/tsx"), ["scripts/backfill-consumption.ts", ...args], {
        cwd: webRoot,
        env: { ...process.env, DATABASE_URL: url },
        timeout: 90_000,
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  async function coachReply(at: Date) {
    const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ('marie', 'C') RETURNING id`);
    await database.query(`INSERT INTO coach_message (conversation_id, author, text, created_at) VALUES ($1, 'coach', 'Bonjour', $2)`, [rows[0]!.id, at]);
  }

  async function rows() {
    const { rows } = await database.query<{ day: string; tool: string; count: number }>(`SELECT day::text AS day, tool, count FROM consumption_day ORDER BY day, tool`);
    return rows;
  }

  const liveFrom = () => isoDay(daysAgo(0));

  it("run twice as a command, it gives the same rows", async () => {
    await coachReply(daysAgo(10));
    await coachReply(daysAgo(10));
    await coachReply(daysAgo(20));

    const first = await backfill("--live-from", liveFrom());
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain("rows written");
    const afterFirst = await rows();
    expect(afterFirst).toEqual([
      { day: isoDay(daysAgo(20)), tool: "coach", count: 1 },
      { day: isoDay(daysAgo(10)), tool: "coach", count: 2 },
    ]);

    const second = await backfill(`--live-from=${liveFrom()}`);
    expect(second.code, second.stderr).toBe(0);
    expect(await rows()).toEqual(afterFirst);
  }, 120_000);

  it("never touches the deploy day or later, even with live counts on it", async () => {
    const deploy = liveFrom();
    await coachReply(daysAgo(3));
    await countUse(database, "marie", "coach", daysAgo(0));
    await countUse(database, "marie", "coach", daysAgo(0));
    await countUse(database, "marie", "jobSearch", daysAgo(0));
    const live = await rows();
    expect(live).toHaveLength(2);

    expect((await backfill("--live-from", deploy)).code).toBe(0);
    expect((await backfill("--live-from", deploy)).code).toBe(0);

    const after = await rows();
    expect(after.filter((r) => r.day >= deploy)).toEqual(live);
    expect(after.filter((r) => r.day < deploy)).toEqual([{ day: isoDay(daysAgo(3)), tool: "coach", count: 1 }]);
  }, 120_000);

  it("writes nothing older than 12 months", async () => {
    await coachReply(daysAgo(400));
    await coachReply(daysAgo(380));

    const done = await backfill("--live-from", liveFrom());

    expect(done.code, done.stderr).toBe(0);
    expect(await rows()).toEqual([]);
    expect(done.stdout).toContain("0 rows written");
  }, 120_000);

  it("refuses a missing, unreadable or future deploy date and writes nothing", async () => {
    await coachReply(daysAgo(10));
    const missing = await backfill();
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("--live-from");
    const unreadable = await backfill("--live-from", "6/11/2026");
    expect(unreadable.code).toBe(1);
    const future = await backfill("--live-from", isoDay(daysAgo(-5)));
    expect(future.code).toBe(1);
    expect(await rows()).toEqual([]);
  }, 120_000);

  it("is documented as a runbook in docs/ops: command, environments, run once before #801 ships", () => {
    const path = resolve(repoRoot, "docs/ops/consumption-backfill.md");
    expect(existsSync(path)).toBe(true);
    const doc = readFileSync(path, "utf8");
    expect(doc).toContain("npm run db:backfill-consumption -- --live-from");
    expect(doc).toMatch(/staging/);
    expect(doc).toMatch(/production/);
    expect(doc).toMatch(/Run once per environment/);
    expect(doc).toMatch(/#801/);
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:backfill-consumption"]).toBeDefined();
  });
});
