import { AiConfigError, createAiLayerFromEnv } from "@jobhub/ai";
import { createApplications } from "@jobhub/web/applications";
import { createBilling } from "@jobhub/web/billing";
import { createJobDigests } from "@jobhub/web/job-digests";
import { createJobOffers } from "@jobhub/web/job-offers";
import { mailerFromEnv } from "@jobhub/web/mailers";
import { createJobSearchReports } from "@jobhub/web/job-searches";
import { createProfiles } from "@jobhub/web/profiles";
import { Pool } from "pg";
import { createJobDiscovery } from "./job-discovery";
import { startJobRunner, type JobRunner } from "./job-runner";
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

const baseURL = process.env.APP_URL || (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
if (!baseURL) {
  console.error("[worker] APP_URL is not set (see .env.example): Job Digest emails link to the web app");
  process.exit(1);
}

const profiles = createProfiles(database);
const jobOffers = createJobOffers(database);
// The Job Digest schedule queues jobs on the runner, which starts once the jobs exist.
const started: { runner?: JobRunner } = {};
const jobs = createJobs({
  database,
  discovery: jobDiscovery(),
  profiles,
  jobSearches: createJobSearchReports(database),
  jobDigests: createJobDigests(database, {
    profiles,
    jobOffers,
    applications: createApplications(database, { jobOffers, profiles }),
    billing: createBilling({ database, baseURL }),
    mailer: mailerFromEnv(process.env),
    baseURL,
  }),
  enqueue: async (name, data) => {
    if (!started.runner) throw new Error("the job runner has not started yet");
    await started.runner.enqueue(name, data);
  },
});

const runner = await startJobRunner({ connectionString, jobs });
started.runner = runner;
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
