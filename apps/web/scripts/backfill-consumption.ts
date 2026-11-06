// Rebuilds Consumption's last 12 months before #799's deploy date from the results still stored (#800, ADR-0091).
// Once per environment, after #799's migration, before « Votre consommation » (#801) ships: docs/ops/consumption-backfill.md.
// Usage: npm run db:backfill-consumption -- --live-from 2026-11-06
//   --live-from  the day #799 was deployed in this environment (French time): that day and later are counted live,
//                never touched. Run again, it gives the same rows.
import { Pool } from "pg";
import { backfillConsumption } from "../src/consumption/backfill";

const args = process.argv.slice(2);
const flag = args.findIndex((arg) => arg === "--live-from" || arg.startsWith("--live-from="));
const liveFrom = flag < 0 ? undefined : args[flag]!.includes("=") ? args[flag]!.split("=")[1] : args[flag + 1];
if (!liveFrom) {
  console.error("[consumption-backfill] Usage: --live-from YYYY-MM-DD, the day #799 was deployed in this environment");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("[consumption-backfill] Missing environment variable DATABASE_URL");
  process.exit(2);
}
const database = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const done = await backfillConsumption(database, { liveFrom, now: new Date() });
  const uses = Object.entries(done.uses).map(([tool, count]) => `${tool} ${count}`).join(", ");
  console.info(`[consumption-backfill] ${done.from} to the day before ${done.until}: ${done.rows} rows written (${uses})`);
} catch (error) {
  console.error(`[consumption-backfill] ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await database.end();
}
