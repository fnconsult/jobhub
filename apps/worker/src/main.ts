import { AiConfigError, createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { createApplications } from "@jobhub/web/applications";
import { createBilling } from "@jobhub/web/billing";
import { createEuAiConsents } from "@jobhub/web/eu-ai-consent";
import { followUpsFromEnv } from "@jobhub/web/follow-ups/env";
import { createJobDigests, jobDigestsConfigFromEnv } from "@jobhub/web/job-digests";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createJobSearchReports } from "@jobhub/web/job-searches";
import { mailerFromEnv } from "@jobhub/web/mailers";
import { createProfiles } from "@jobhub/web/profiles";
import { AI_SECRET_NAMES, FRANCE_TRAVAIL_SECRET_NAMES, liveObject, MAIL_SECRET_NAMES, rebuilding, watchProviderSecrets } from "@jobhub/web/provider-secrets";
import { Pool } from "pg";
import { createJobDiscovery, franceTravailFromEnv, jobDiscoveryBudgetFromEnv } from "./job-discovery";
import { startJobRunner, type JobRunner } from "./job-runner";
import { createJobs, PROVIDER_SECRETS_REENCRYPT } from "./jobs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const database = new Pool({ connectionString });
const euAiConsents = createEuAiConsents(database);

// Provider Secrets (ADR-0020): the keys entered in the Back Office over env's, read
// before anything is built, kept current by NOTIFY and a 60 s refresh. The clients
// holding a key are rebuilt when it changes, without a restart.
const providerSecrets = watchProviderSecrets({ database, env: process.env });
await providerSecrets.ready;
const secrets = providerSecrets.resolver;

// Job discovery needs the AI layer; the other jobs do not (Follow-ups fall back to
// a template). Without AI configuration (e.g. the local docker-compose stack with no
// repo-root .env, or one without keys) the worker still runs, and discovery jobs are
// skipped with the reason. Production fails loudly instead.
function aiLayer(): AiLayer | { unavailable: string } {
  // A Candidate's identity-bearing calls go to Mistral once they gave EU AI consent (ADR-0007).
  const build = (env: Record<string, string | undefined>) => createAiLayerFromEnv(env, { euAiConsent: (candidateId) => euAiConsents.has(candidateId) });
  try {
    build(secrets.current().env);
    return liveObject(secrets, AI_SECRET_NAMES, build);
  } catch (error) {
    if (!(error instanceof AiConfigError) || process.env.NODE_ENV === "production") throw error;
    console.warn(`[worker] Job discovery is unavailable: ${error.message}`);
    return { unavailable: error.message };
  }
}
const ai = aiLayer();

const baseURL = process.env.APP_URL || (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
if (!baseURL) {
  console.error("[worker] APP_URL is not set (see .env.example): Job Digest emails link to the web app");
  process.exit(1);
}

// France Travail is searched only with its client credentials (access is on request): without them, Job discovery goes without it.
// Built again (its access token dropped) when they are replaced in the Back Office.
const franceTravail = rebuilding(secrets, FRANCE_TRAVAIL_SECRET_NAMES, (env) => franceTravailFromEnv(env));
if (!franceTravail()) console.info("[worker] France Travail is off: FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET are not both set");
// Fails at start-up, as before, where the mailer cannot be built (production without SMTP_URL).
mailerFromEnv(secrets.current().env);
const mailer = liveObject(secrets, MAIL_SECRET_NAMES, mailerFromEnv);

const profiles = createProfiles(database);
const jobOffers = createJobOffers(database);
const billing = createBilling({ database, baseURL });
// The Job Digest schedule queues jobs on the runner, which starts once the jobs exist.
const started: { runner?: JobRunner } = {};
const jobs = createJobs({
  database,
  discovery: "unavailable" in ai ? ai : createJobDiscovery({ ai, jobOffers, budget: jobDiscoveryBudgetFromEnv(process.env), franceTravail }),
  profiles,
  // A failed Job Search gives its Plan Quota use back. Releasing needs no Stripe, only the quota table.
  jobSearches: createJobSearchReports(database, { quotas: billing }),
  followUps: followUpsFromEnv(database, process.env, "unavailable" in ai ? undefined : ai, mailer),
  jobDigests: createJobDigests(database, {
    profiles,
    jobOffers,
    applications: createApplications(database, { jobOffers, profiles }),
    billing,
    mailer,
    baseURL,
    ...jobDigestsConfigFromEnv(process.env),
  }),
  providerSecrets: providerSecrets.reader,
  enqueue: async (name, data) => {
    if (!started.runner) throw new Error("the job runner has not started yet");
    await started.runner.enqueue(name, data);
  },
});

const runner = await startJobRunner({ connectionString, jobs });
started.runner = runner;
await runner.enqueue("system.heartbeat");
// A master key added to SECRETS_MASTER_KEYS is used for every row soon after the deployment that adds it.
await runner.enqueue(PROVIDER_SECRETS_REENCRYPT);
console.info(`[worker] running ${Object.keys(jobs).length} job(s)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runner
      .stop()
      .then(() => providerSecrets.stop())
      .then(() => database.end())
      .then(() => process.exit(0));
  });
}
