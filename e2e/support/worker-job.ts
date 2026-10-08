// Runs one of the worker's scheduled jobs once, as its schedule would, with the
// worker's clock set `hours` ahead: `tsx e2e/support/worker-job.ts <job> <hours>`.
// DATABASE_URL names the database, as for the worker itself (apps/worker/src/main.ts).
import pg from "pg";
import { createJobs } from "../../apps/worker/src/jobs";

const [name, hours = "0"] = process.argv.slice(2);
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const later = new Date(Date.now() + Number(hours) * 3_600_000);
const job = createJobs({ database, now: () => later })[name!];
if (!job) throw new Error(`The worker has no job named ${name}`);
try {
  await job.handler({});
} finally {
  await database.end();
}
