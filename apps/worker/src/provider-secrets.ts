/**
 * The worker's clients that hold a Provider Secret (#208, ADR-0020), built from the
 * resolver (the database's keys over env's) and rebuilt when one of their keys
 * changes, so a key entered in the Back Office is used without a restart:
 *
 *   const worker = workerClients({ resolver, production, jobOffers, budget });
 *   worker.discovery();     // Job discovery, or why it is unavailable: asked on each job
 *   worker.ai;              // the AI layer (Follow-ups), routed by the AI routing Platform Settings (#301)
 *   worker.franceTravail(); // France Travail, or null without its credentials
 *   worker.fantasticJobs(); // Fantastic.jobs, or null without FANTASTIC_JOBS_API_KEY
 *   worker.mailer;          // BREVO_API_KEY or SMTP_URL (Brevo), and MAIL_FROM from the Platform Settings (#300)
 *
 * The AI layer is also rebuilt when an AI routing Platform Setting changes (`platformSettings`), so a provider, model or
 * endpoint set on Paramètres is used for the next call. A key refused by its provider (401/403, an SMTP 535, France Travail's or Fantastic.jobs' refusal) is
 * read again from the database and the call made once more if it changed.
 */
import { AiConfigError, createAiLayerFromEnv, type AiLayer, type CandidateIdentity, type UsageLog } from "@jobhub/ai";
import { recordingFetch, type ExternalApiLog } from "@jobhub/shared";
import { liveMailer } from "@jobhub/web/mailers";
import { AI_ROUTING_NAMES, createPlatformSettingsResolver, withPlatformSettings, type PlatformSettingsResolver } from "@jobhub/web/platform-settings";
import { AI_SECRET_NAMES, FANTASTIC_JOBS_SECRET_NAMES, FRANCE_TRAVAIL_SECRET_NAMES, liveObject, rebuilding, type SecretResolver } from "@jobhub/web/provider-secrets";
import {
  chargedCostEur,
  createJobDiscovery,
  eurPerJobFromEnv,
  fantasticJobsFromEnv,
  franceTravailFromEnv,
  type FantasticJobs,
  type FranceTravail,
  type JobDiscovery,
  type JobDiscoveryOptions,
} from "./job-discovery";
import type { DiscoveryUnavailable } from "./jobs";

type Env = Record<string, string | undefined>;

export interface WorkerClientsOptions {
  resolver: SecretResolver;
  /** The Platform Settings in use (ADR-0033): the AI layer follows the AI routing ones, the mailer its MAIL_FROM. Without it, env's alone. */
  platformSettings?: PlatformSettingsResolver;
  /** In production a missing AI key fails Job discovery loudly; elsewhere it is unavailable, with the reason. */
  production: boolean;
  jobOffers: JobDiscoveryOptions["jobOffers"];
  budget?: JobDiscoveryOptions["budget"];
  /** The Job discovery sources and sites set in the Back Office (#188), read at the start of each run. */
  settings?: JobDiscoveryOptions["settings"];
  /** The task Playbooks Job discovery runs with (ADR-0026), read at the start of each run. */
  taskPlaybooks?: JobDiscoveryOptions["taskPlaybooks"];
  /** The NAF and ROME-domain labels the web searches name the Sectors wanted by (#236). */
  industries?: JobDiscoveryOptions["industries"];
  /** Whether a Candidate gave EU AI consent (ADR-0007). */
  euAiConsent?: (candidateId: string) => Promise<boolean>;
  /** What is known of a Candidate's identity, taken out of each of their AI calls (ADR-0007). Default: emails and phone numbers alone. */
  identityOf?: (candidateId: string) => Promise<CandidateIdentity | null>;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: one JSON line per AI call on stdout. */
  usage?: UsageLog;
  /** Where each call to France Travail, the job boards, other sites' pages and Brevo is recorded (AI Usage's external APIs). Default: nowhere. */
  externalApis?: ExternalApiLog;
  log?: (line: string) => void;
}

export interface WorkerClients {
  discovery(): JobDiscovery | DiscoveryUnavailable;
  ai: AiLayer;
  franceTravail(): FranceTravail | null;
  fantasticJobs(): FantasticJobs | null;
  mailer: ReturnType<typeof liveMailer>;
}

/** France Travail when its credentials were just cleared mid-call: refused, like a withdrawn access. */
const FRANCE_TRAVAIL_OFF: FranceTravail = { search: async () => ({ ok: false, reason: "refused", detail: "credentials cleared", calls: 0 }) };

/** Fantastic.jobs when its key was just cleared mid-call: refused, like a rejected key. */
const FANTASTIC_JOBS_OFF: FantasticJobs = { search: async () => ({ ok: false, reason: "refused", detail: "key cleared", calls: 0 }) };

/** A search answer by which the provider turned the key down: worth asking again with a key just replaced. */
const refusedSearch = (answer: unknown) => (answer as { ok?: boolean; reason?: string }).ok === false && (answer as { reason?: string }).reason === "refused";

export function workerClients(options: WorkerClientsOptions): WorkerClients {
  const { resolver } = options;
  const log = options.log ?? ((line: string) => console.info(line));
  const buildAi = (env: Env) => createAiLayerFromEnv(env, { euAiConsent: options.euAiConsent, identityOf: options.identityOf, fetch: options.fetch, usage: options.usage });
  // The AI layer's keys and its routing: rebuilt when one of either changes.
  const aiResolver = options.platformSettings ? withPlatformSettings(resolver, options.platformSettings) : resolver;
  const aiNames = [...AI_SECRET_NAMES, ...AI_ROUTING_NAMES];
  const ai = liveObject(aiResolver, aiNames, buildAi);

  const franceTravailConfigured = rebuilding(resolver, FRANCE_TRAVAIL_SECRET_NAMES, (env) => franceTravailFromEnv(env) !== null);
  // France Travail's API is free: each call is recorded at no cost.
  const franceTravailFetch = options.externalApis
    ? recordingFetch(options.fetch ?? globalThis.fetch, options.externalApis, { provider: "france_travail", costEur: () => 0 })
    : options.fetch;
  const liveFranceTravail = liveObject(resolver, FRANCE_TRAVAIL_SECRET_NAMES, (env) => franceTravailFromEnv(env, { fetch: franceTravailFetch }) ?? FRANCE_TRAVAIL_OFF, {
    refused: refusedSearch,
  });
  const franceTravail = () => (franceTravailConfigured() ? liveFranceTravail : null);

  const fantasticJobsConfigured = rebuilding(resolver, FANTASTIC_JOBS_SECRET_NAMES, (env) => fantasticJobsFromEnv(env) !== null);
  const liveFantasticJobs = liveObject(
    resolver,
    FANTASTIC_JOBS_SECRET_NAMES,
    (env) => {
      // Each call is recorded with the estimated cost of the jobs it says it charged.
      const eurPerJob = eurPerJobFromEnv(env);
      const fetch = options.externalApis
        ? recordingFetch(options.fetch ?? globalThis.fetch, options.externalApis, { provider: "fantastic_jobs", costEur: (_, __, response) => (response ? chargedCostEur(response.headers, eurPerJob) : null) })
        : options.fetch;
      return fantasticJobsFromEnv(env, { fetch }) ?? FANTASTIC_JOBS_OFF;
    },
    { refused: refusedSearch },
  );
  const fantasticJobs = () => (fantasticJobsConfigured() ? liveFantasticJobs : null);

  // Built again whenever an AI key or routing setting changes: a key entered later turns Job discovery on.
  const discovery = rebuilding(aiResolver, aiNames, (env): JobDiscovery | DiscoveryUnavailable => {
    try {
      buildAi(env);
    } catch (error) {
      if (!(error instanceof AiConfigError) || options.production) throw error;
      // The message names the missing setting, never a value.
      log(`[worker] Job discovery is unavailable: ${error.message}`);
      return { unavailable: error.message };
    }
    return createJobDiscovery({ ai, jobOffers: options.jobOffers, budget: options.budget, franceTravail, fantasticJobs, settings: options.settings, taskPlaybooks: options.taskPlaybooks, industries: options.industries, fetch: options.fetch, externalApis: options.externalApis });
  });

  // Rebuilt when Brevo's key or MAIL_FROM changes in the Back Office. Each email sent is recorded with the other
  // external API calls, never who it was for.
  const settings = options.platformSettings ?? createPlatformSettingsResolver({ load: async () => ({}), env: {} });
  return { discovery, ai, franceTravail, fantasticJobs, mailer: liveMailer({ secrets: resolver, settings }, { externalApis: options.externalApis }) };
}
