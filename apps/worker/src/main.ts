import { AiConfigError, createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { followUpsFromEnv } from "@jobhub/web/follow-ups/env";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createJobSearchReports } from "@jobhub/web/job-searches";
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

// Job discovery needs the AI layer; the other jobs do not (Follow-ups fall back to
// a template). Without AI configuration (e.g. the local docker-compose stack with no
// repo-root .env, or one without keys) the worker still runs, and discovery jobs are
// skipped with the reason. Production fails loudly instead.
function aiLayer(): AiLayer | { unavailable: string } {
  try {
    return createAiLayerFromEnv(process.env);
  } catch (error) {
    if (!(error instanceof AiConfigError) || process.env.NODE_ENV === "production") throw error;
    console.warn(`[worker] Job discovery is unavailable: ${error.message}`);
    return { unavailable: error.message };
  }
}
const ai = aiLayer();

const jobs = createJobs({
  database,
  discovery: "unavailable" in ai ? ai : createJobDiscovery({ ai, jobOffers: createJobOffers(database) }),
  profiles: createProfiles(database),
  jobSearches: createJobSearchReports(database),
  followUps: followUpsFromEnv(database, process.env, "unavailable" in ai ? undefined : ai),
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
