// Runs one of the worker's scheduled jobs once, as its schedule would, with the
// worker's clock set `hours` ahead: `tsx e2e/support/worker-job.ts <job> <hours>`.
// DATABASE_URL names the database, and APP_URL, MAIL_TRANSPORT… the rest, as for
// the worker itself (apps/worker/src/main.ts). Without AI configuration, as the
// worker runs without it: Follow-ups are drafted from their template.
import pg from "pg";
import { followUpsFromEnv } from "../../apps/web/src/follow-ups/env";
import { createJobs } from "../../apps/worker/src/jobs";

const [name, hours = "0"] = process.argv.slice(2);
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const later = new Date(Date.now() + Number(hours) * 3_600_000);
const job = createJobs({
  database,
  now: () => later,
  discovery: { unavailable: "not run by e2e/support/worker-job.ts" },
  profiles: { get: async () => null },
  jobSearches: { record: async () => {} },
  followUps: followUpsFromEnv(database, process.env),
})[name!];
if (!job) throw new Error(`The worker has no job named ${name}`);
try {
  await job.handler({});
} finally {
  await database.end();
}
