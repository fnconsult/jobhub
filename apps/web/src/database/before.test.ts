import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { utcBefore } from "./before";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("a retention cutoff in SQL (needs Postgres: DATABASE_URL)", () => {
  const paris = new Pool({ connectionString, max: 1, options: "-c TimeZone=Europe/Paris" });
  const utc = new Pool({ connectionString, max: 1, options: "-c TimeZone=UTC" });
  afterAll(() => Promise.all([paris.end(), utc.end()]));

  const cutoff = async (database: Pool, now: string, interval: string) =>
    ((await database.query(`SELECT ${utcBefore("$1", interval)} AS at`, [now])).rows[0].at as Date).toISOString();

  it("is the same instant whatever the database's time zone, even across a daylight-saving change", async () => {
    // 27 October 2028 is summer time in Paris, 27 October 2026 winter time: counted in Paris, 24 months back lands at 10:29 UTC.
    for (const database of [paris, utc]) {
      expect(await cutoff(database, "2028-10-27T09:29:00Z", "make_interval(months => 24)")).toBe("2026-10-27T09:29:00.000Z");
      expect(await cutoff(database, "2029-10-27T09:29:00Z", "make_interval(years => 3)")).toBe("2026-10-27T09:29:00.000Z");
      expect(await cutoff(database, "2026-11-01T09:29:00Z", "make_interval(days => 7)")).toBe("2026-10-25T09:29:00.000Z");
    }
  });
});

describe("retention cutoffs in the web app's SQL", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const root = join(__dirname, "..");

  it("count days, months and years in UTC (utcBefore), never in the database session's time zone", () => {
    const zoneDependent = /timestamptz\s*-\s*make_interval\(\s*(days|weeks|months|years)\b/;
    const offenders = sources(root).filter((path) => zoneDependent.test(readFileSync(path, "utf8")));
    expect(offenders.map((path) => relative(root, path))).toEqual([]);
  });
});
