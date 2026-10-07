import { createAiLayerFromEnv } from "@jobhub/ai";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createProfiles } from "@jobhub/web/profiles";
import { Pool } from "pg";
import { createJobDiscovery } from "./job-discovery";
import { startJobRunner } from "./job-runner";
import { createJobs } from "./jobs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const database = new Pool({ connectionString });
const ai = createAiLayerFromEnv(process.env);
const jobs = createJobs({
  discovery: createJobDiscovery({ ai, jobOffers: createJobOffers(database) }),
  profiles: createProfiles(database),
});

const runner = await startJobRunner({ connectionString, jobs });
await runner.enqueue("system.heartbeat");
console.info(`[worker] running ${Object.keys(jobs).length} job(s)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runner
      .stop()
      .then(() => database.end())
      .then(() => process.exit(0));
  });
}
