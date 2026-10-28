// Runs the worker's `email-intake.read` job once for each Received offer email id given, as the job runner would on the
// message the inbound route queued: `tsx e2e/support/worker-email-reading.ts <id>…`. Wired as the worker is
// (apps/worker/src/main.ts): the AI layer from the environment, the task Playbooks at the version this environment
// serves, the texts opened under SECRETS_MASTER_KEYS. DATABASE_URL names the database, NODE_OPTIONS preloads the fake
// Mistral. A try that fails prints `READ_FAILED <id> <message>` (the runner would try again) and the exit status is 1.
// Not a long-lived worker: that would take the jobs other specs queue on the same queue.
import { createAiLayerFromEnv } from "@jobhub/ai";
import pg from "pg";
import { createEmailReadings } from "@jobhub/web/email-intake/reading";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createProfiles } from "@jobhub/web/profiles";
import { secretCipherFromEnv } from "@jobhub/web/provider-secrets";
import { taskPlaybooksReader } from "@jobhub/web/task-playbooks";
import { createEmailReading } from "../../apps/worker/src/email-intake";
import { createJobs } from "../../apps/worker/src/jobs";

const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cipher = secretCipherFromEnv(process.env);
const jobs = createJobs({
  database,
  discovery: { unavailable: "not run by e2e/support/worker-email-reading.ts" },
  profiles: { get: async () => null },
  jobSearches: { record: async () => {} },
  emailReading: createEmailReading({
    readings: createEmailReadings(database, { cipher: () => cipher }),
    jobOffers: createJobOffers(database),
    profiles: createProfiles(database),
    ai: createAiLayerFromEnv(process.env),
    taskPlaybooks: taskPlaybooksReader(database, process.env),
  }),
} as Parameters<typeof createJobs>[0]);
let failed = false;
try {
  for (const id of process.argv.slice(2)) {
    try {
      await jobs["email-intake.read"]!.handler({ receivedOfferEmailId: id });
    } catch (error) {
      failed = true;
      console.log(`READ_FAILED ${id} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await database.end();
}
process.exit(failed ? 1 : 0);
