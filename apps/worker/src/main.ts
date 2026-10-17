import { createApplications } from "@jobhub/web/applications";
import { createBilling } from "@jobhub/web/billing";
import { createEuAiConsents } from "@jobhub/web/eu-ai-consent";
import { followUpsFromEnv } from "@jobhub/web/follow-ups/env";
import { createJobDigests, jobDigestsConfigFromEnv } from "@jobhub/web/job-digests";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createJobSearchReports } from "@jobhub/web/job-searches";
import { mailerFromEnv } from "@jobhub/web/mailers";
import { createProfiles } from "@jobhub/web/profiles";
import { permanentSuperAdminsFromEnv, superAdminEmails } from "@jobhub/web/administrators";
import { secretCipherFromEnv, watchProviderSecrets } from "@jobhub/web/provider-secrets";
import { appleFailureEmail, signInProvidersWorker } from "@jobhub/web/sign-in-providers";
import { Pool } from "pg";
import { jobDiscoveryBudgetFromEnv } from "./job-discovery";
import { startJobRunner, type JobRunner } from "./job-runner";
import { createJobs, PROVIDER_SECRETS_REENCRYPT } from "./jobs";
import { workerClients } from "./provider-secrets";

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

const profiles = createProfiles(database);
const jobOffers = createJobOffers(database);

// Job discovery needs the AI layer; the other jobs do not (Follow-ups fall back to
// a template). Without AI configuration (e.g. the local docker-compose stack with no
// repo-root .env, or one without keys) the worker still runs, and discovery jobs are
// skipped with the reason, until a key is entered in the Back Office. Production fails
// loudly instead. A Candidate's identity-bearing calls go to Mistral once they gave EU
// AI consent (ADR-0007).
const worker = workerClients({
  resolver: secrets,
  production: process.env.NODE_ENV === "production",
  jobOffers,
  budget: jobDiscoveryBudgetFromEnv(process.env),
  euAiConsent: (candidateId) => euAiConsents.has(candidateId),
  log: (line) => console.warn(line),
});
worker.discovery();

const baseURL = process.env.APP_URL || (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
if (!baseURL) {
  console.error("[worker] APP_URL is not set (see .env.example): Job Digest emails link to the web app");
  process.exit(1);
}

// France Travail is searched only with its client credentials (access is on request): without them, Job discovery goes without it.
if (!worker.franceTravail()) console.info("[worker] France Travail is off: FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET are not both set");
// Fails at start-up, as before, where the mailer cannot be built (production without SMTP_URL).
mailerFromEnv(secrets.current().env);
const mailer = worker.mailer;

const billing = createBilling({ database, baseURL });
// The Job Digest schedule queues jobs on the runner, which starts once the jobs exist.
const started: { runner?: JobRunner } = {};
const jobs = createJobs({
  database,
  discovery: worker.discovery,
  profiles,
  // A failed Job Search gives its Plan Quota use back. Releasing needs no Stripe, only the quota table.
  jobSearches: createJobSearchReports(database, { quotas: billing }),
  // Without an AI key the AI call fails and the Follow-up falls back to its template.
  followUps: followUpsFromEnv(database, process.env, worker.ai, mailer),
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
  signInProviders: signInProvidersWorker(database, { cipher: secretCipherFromEnv(process.env), env: process.env }),
  // Every super-admin hears of it: Apple sign-in stops once the client secret in use expires.
  alertAppleFailure: async (failed) => {
    const email = appleFailureEmail(failed, baseURL);
    for (const to of await superAdminEmails(database, permanentSuperAdminsFromEnv(process.env))) await mailer.send({ to, ...email });
  },
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
