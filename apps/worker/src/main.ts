import { startJobRunner } from "./job-runner";
import { jobs } from "./jobs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const runner = await startJobRunner({ connectionString, jobs });
await runner.enqueue("system.heartbeat");
console.info(`[worker] running ${Object.keys(jobs).length} job(s)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runner.stop().then(() => process.exit(0));
  });
}
