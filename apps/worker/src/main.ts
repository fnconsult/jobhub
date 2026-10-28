import { allUsageLogs, createConsoleUsageLog } from "@jobhub/ai";
import { createPostgresExternalApiLog, createPostgresUsageLog, knownSecrets } from "@jobhub/web/ai-usage";
import { createApplications } from "@jobhub/web/applications";
import { createAppointmentReminders } from "@jobhub/web/appointment-reminders";
import { candidateIdentityOf } from "@jobhub/web/candidate-identity";
import { createDiscoveryRuns } from "@jobhub/web/discovery-runs";
import { createBilling } from "@jobhub/web/billing";
import { createEmailReadings } from "@jobhub/web/email-intake/reading";
import { createReceivedOffers } from "@jobhub/web/email-intake/received-offers";
import { createEuAiConsents } from "@jobhub/web/eu-ai-consent";
import { followUpsFromEnv } from "@jobhub/web/follow-ups/env";
import { createJobDigests, jobDigestsConfigFromEnv } from "@jobhub/web/job-digests";
import { createJobOffers } from "@jobhub/web/job-offers";
import { createJobSearchReports } from "@jobhub/web/job-searches";
import { mailerFromEnv } from "@jobhub/web/mailers";
import { secretsWithSettings, watchPlatformSettings } from "@jobhub/web/platform-settings";
import { createProfiles } from "@jobhub/web/profiles";
import { permanentSuperAdminsFromEnv, superAdminEmails } from "@jobhub/web/administrators";
import { secretCipherFromEnv, watchProviderSecrets } from "@jobhub/web/provider-secrets";
import { createReferenceData } from "@jobhub/web/reference-data";
import { createSearchSites } from "@jobhub/web/search-sites";
import { appleFailureEmail, signInProvidersWorker } from "@jobhub/web/sign-in-providers";
import { createTargetCompanies } from "@jobhub/web/target-companies";
import { taskPlaybooksReader } from "@jobhub/web/task-playbooks";
import { createWebSearchAlert, postgresWebSearchAlertStore, webSearchAlertThresholdFromEnv } from "@jobhub/web/web-search-alert";
import { Pool } from "pg";
import { jobDiscoveryBudgetFromEnv, targetCompanySettingsFromEnv, webSearchSettingsFromEnv } from "./job-discovery";
import { startJobRunner, type JobRunner } from "./job-runner";
import { createEmailReading } from "./email-intake";
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

// Platform Settings (ADR-0033): the values super-admins set on Paramètres over env's, over the
// code's defaults, kept current the same way. The Job Digest and Job discovery read theirs at each
// run, so a change applies to the next one without a restart (#299), and the mailer is rebuilt when
// MAIL_FROM changes (#300). A value env holds that the code refuses still stops the worker here, at start-up.
const platformSettings = watchPlatformSettings({ database, env: process.env });
await platformSettings.ready;
const settingsEnv = () => platformSettings.resolver.current().env;
jobDiscoveryBudgetFromEnv(settingsEnv());
webSearchSettingsFromEnv(settingsEnv());
jobDigestsConfigFromEnv(settingsEnv());
webSearchAlertThresholdFromEnv(settingsEnv());

const profiles = createProfiles(database);
// The task Playbooks at the version this environment serves (JOBHUB_TARGET): Job discovery's, and Email intake's reading.
const taskPlaybooks = taskPlaybooksReader(database, process.env);
const jobOffers = createJobOffers(database);
const searchSites = createSearchSites(database);
// The Sectors', Subsectors' and Domains' labels (#236): refreshed monthly, read by each Job discovery run.
const referenceData = createReferenceData(database, { externalApis: createPostgresExternalApiLog(database) });

// Job discovery needs the AI layer; the other jobs do not (Follow-ups fall back to
// a template). Without AI configuration (e.g. the local docker-compose stack with no
// repo-root .env, or one without keys) the worker still runs, and discovery jobs are
// skipped with the reason, until a key is entered in the Back Office. Production fails
// loudly instead. A Candidate's identity-bearing calls go to Mistral once they gave EU
// AI consent, and every call is redacted of their identity before it leaves (ADR-0007).
// Every AI call goes to stdout and to AI Usage with its AI Message Log (every key in use
// scrubbed); every France Travail call to AI Usage's external APIs. Neither waits on the insert.
const externalApis = createPostgresExternalApiLog(database);
const worker = workerClients({
  resolver: secrets,
  // The AI routing set on Paramètres (#301): the AI layer is rebuilt when it changes, within seconds.
  platformSettings: platformSettings.resolver,
  usage: allUsageLogs([createConsoleUsageLog(), createPostgresUsageLog(database, { secrets: () => knownSecrets(secrets.current().env) })]),
  externalApis,
  production: process.env.NODE_ENV === "production",
  jobOffers,
  budget: () => jobDiscoveryBudgetFromEnv(settingsEnv()),
  // The web search's settings on Paramètres' Recherche web tab (#402): country, age, results per query, job titles, languages.
  search: () => webSearchSettingsFromEnv(settingsEnv()),
  // The Job discovery sources and sites Administrators set in the Back Office, read at the start of each run.
  settings: () => searchSites.jobDiscoverySettings(),
  // The web searches name the Sectors wanted by their labels.
  industries: () => referenceData.read(),
  // Each Profile's Target Companies (#406): La Bonne Boite's and the Candidate's own, how many a run visits and how often.
  targetCompanies: createTargetCompanies(database),
  targetCompanySettings: () => targetCompanySettingsFromEnv(settingsEnv()),
  // The task Playbooks at the version this environment serves (JOBHUB_TARGET), as the web app reads them.
  taskPlaybooks,
  euAiConsent: (candidateId) => euAiConsents.has(candidateId),
  identityOf: candidateIdentityOf(database),
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
// Fantastic.jobs is searched only with its key (Back Office → Clés, else env): without it, Job discovery goes without it.
if (!worker.fantasticJobs()) console.info("[worker] Fantastic.jobs is off: FANTASTIC_JOBS_API_KEY is not set");
// Fails at start-up, as before, where the mailer cannot be built (production without BREVO_API_KEY or SMTP_URL,
// or without MAIL_FROM in env or on Paramètres).
mailerFromEnv(secretsWithSettings(secrets, platformSettings.resolver).current().env);
const mailer = worker.mailer;

const billing = createBilling({ database, baseURL });
// SECRETS_MASTER_KEYS: Apple's client secret is sealed under it, and so are the Received offer emails' texts.
const secretCipher = secretCipherFromEnv(process.env);
const digestApplications = createApplications(database, { jobOffers, profiles });
// The Job Digest schedule queues jobs on the runner, which starts once the jobs exist.
const started: { runner?: JobRunner } = {};
const jobs = createJobs({
  database,
  discovery: worker.discovery,
  profiles,
  // A failed Job Search gives its Plan Quota use back. Releasing needs no Stripe, only the quota table.
  jobSearches: createJobSearchReports(database, { quotas: billing }),
  discoveryRuns: createDiscoveryRuns(database),
  // Without an AI key the AI call fails and the Follow-up falls back to its template.
  followUps: followUpsFromEnv(database, process.env, worker.ai, mailer),
  jobDigests: createJobDigests(database, {
    profiles,
    jobOffers,
    applications: digestApplications,
    billing,
    // The Job Offers Email intake gave each Profile join its Job Digest (#447).
    receivedOffers: createReceivedOffers(database, { jobOffers, profiles, applications: digestApplications }),
    mailer,
    baseURL,
    config: () => jobDigestsConfigFromEnv(settingsEnv()),
  }),
  // The email the day before each Agenda Item, in the Candidate's Interface Language; links to the web app.
  appointmentReminders: createAppointmentReminders(database, { mailer, baseURL }),
  providerSecrets: providerSecrets.reader,
  referenceData,
  signInProviders: signInProvidersWorker(database, { cipher: secretCipher, env: process.env }),
  // Every super-admin hears of it once a month: the month's web search spend reached WEB_SEARCH_MONTHLY_ALERT_EUR (#403).
  webSearchAlert: createWebSearchAlert({
    store: postgresWebSearchAlertStore(database),
    thresholdEur: () => webSearchAlertThresholdFromEnv(settingsEnv()),
    superAdmins: () => superAdminEmails(database, permanentSuperAdminsFromEnv(process.env)),
    mailer,
    appUrl: baseURL,
  }),
  // Every super-admin hears of it: Apple sign-in stops once the client secret in use expires.
  alertAppleFailure: async (failed) => {
    const email = appleFailureEmail(failed, baseURL);
    for (const to of await superAdminEmails(database, permanentSuperAdminsFromEnv(process.env))) await mailer.send({ to, ...email });
  },
  // The source re-check's page reads, as Job discovery's: a page_read of each site's domain.
  externalApis,
  // Email intake (#445): each Received offer email the inbound route queued, read on the served version of its Task
  // Playbook (only on an EU endpoint, ADR-0052), its text opened under SECRETS_MASTER_KEYS as the web app sealed it.
  emailReading: createEmailReading({
    readings: createEmailReadings(database, { cipher: () => secretCipher }),
    jobOffers,
    profiles,
    ai: worker.ai,
    taskPlaybooks,
  }),
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
      .then(() => platformSettings.stop())
      .then(() => database.end())
      .then(() => process.exit(0));
  });
}
