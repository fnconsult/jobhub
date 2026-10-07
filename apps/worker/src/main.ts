import { AiConfigError, createAiLayerFromEnv } from "@jobhub/ai";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createJobSearchReports } from "@jobhub/web/job-searches";
import { createProfiles } from "@jobhub/web/profiles";
import { Pool } from "pg";
import { createJobDiscovery } from "./job-discovery";
import { startJobRunner } from "./job-runner";
import { createJobs, type JobsDeps } from "./jobs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const database = new Pool({ connectionString });

// Job discovery needs the AI layer; the other jobs do not. Without AI configuration
// (e.g. the local docker-compose stack, which has no keys) the worker still runs,
// and discovery jobs are skipped with the reason. Production fails loudly instead.
function jobDiscovery(): JobsDeps["discovery"] {
  try {
    return createJobDiscovery({ ai: createAiLayerFromEnv(process.env), jobOffers: createJobOffers(database) });
  } catch (error) {
    if (!(error instanceof AiConfigError) || process.env.NODE_ENV === "production") throw error;
    console.warn(`[worker] Job discovery is unavailable: ${error.message}`);
    return { unavailable: error.message };
  }
}

const jobs = createJobs({
  discovery: jobDiscovery(),
  profiles: createProfiles(database),
  jobSearches: createJobSearchReports(database),
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
