/**
 * The worker's clients that hold a Provider Secret (#208, ADR-0020), built from the
 * resolver (the database's keys over env's) and rebuilt when one of their keys
 * changes, so a key entered in the Back Office is used without a restart:
 *
 *   const worker = workerClients({ resolver, production, jobOffers, budget });
 *   worker.discovery();     // Job discovery, or why it is unavailable: asked on each job
 *   worker.ai;              // the AI layer (Follow-ups)
 *   worker.franceTravail(); // France Travail, or null without its credentials
 *   worker.mailer;          // BREVO_API_KEY or SMTP_URL (Brevo)
 *
 * A key refused by its provider (401/403, an SMTP 535, France Travail's refusal) is
 * read again from the database and the call made once more if it changed.
 */
import { AiConfigError, createAiLayerFromEnv, type AiLayer, type UsageLog } from "@jobhub/ai";
import { recordingFetch, type ExternalApiLog } from "@jobhub/shared";
import { mailerFromEnv } from "@jobhub/web/mailers";
import { AI_SECRET_NAMES, FRANCE_TRAVAIL_SECRET_NAMES, liveObject, MAIL_SECRET_NAMES, rebuilding, type SecretResolver } from "@jobhub/web/provider-secrets";
import { createJobDiscovery, franceTravailFromEnv, type FranceTravail, type JobDiscovery, type JobDiscoveryOptions } from "./job-discovery";
import type { DiscoveryUnavailable } from "./jobs";

type Env = Record<string, string | undefined>;

export interface WorkerClientsOptions {
  resolver: SecretResolver;
  /** In production a missing AI key fails Job discovery loudly; elsewhere it is unavailable, with the reason. */
  production: boolean;
  jobOffers: JobDiscoveryOptions["jobOffers"];
  budget?: JobDiscoveryOptions["budget"];
  /** The Job discovery sources and sites set in the Back Office (#188), read at the start of each run. */
  settings?: JobDiscoveryOptions["settings"];
  /** The task Playbooks Job discovery runs with (ADR-0026), read at the start of each run. */
  taskPlaybooks?: JobDiscoveryOptions["taskPlaybooks"];
  /** Whether a Candidate gave EU AI consent (ADR-0007). */
  euAiConsent?: (candidateId: string) => Promise<boolean>;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: one JSON line per AI call on stdout. */
  usage?: UsageLog;
  /** Where each call to France Travail and the job boards is recorded (AI Usage's external APIs). Default: nowhere. */
  externalApis?: ExternalApiLog;
  log?: (line: string) => void;
}

export interface WorkerClients {
  discovery(): JobDiscovery | DiscoveryUnavailable;
  ai: AiLayer;
  franceTravail(): FranceTravail | null;
  mailer: ReturnType<typeof mailerFromEnv>;
}

/** France Travail when its credentials were just cleared mid-call: refused, like a withdrawn access. */
const FRANCE_TRAVAIL_OFF: FranceTravail = { search: async () => ({ ok: false, reason: "refused", detail: "credentials cleared", calls: 0 }) };

export function workerClients(options: WorkerClientsOptions): WorkerClients {
  const { resolver } = options;
  const log = options.log ?? ((line: string) => console.info(line));
  const buildAi = (env: Env) => createAiLayerFromEnv(env, { euAiConsent: options.euAiConsent, fetch: options.fetch, usage: options.usage });
  const ai = liveObject(resolver, AI_SECRET_NAMES, buildAi);

  const franceTravailConfigured = rebuilding(resolver, FRANCE_TRAVAIL_SECRET_NAMES, (env) => franceTravailFromEnv(env) !== null);
  // France Travail's API is free: each call is recorded at no cost.
  const franceTravailFetch = options.externalApis
    ? recordingFetch(options.fetch ?? globalThis.fetch, options.externalApis, { provider: "france_travail", costEur: () => 0 })
    : options.fetch;
  const liveFranceTravail = liveObject(resolver, FRANCE_TRAVAIL_SECRET_NAMES, (env) => franceTravailFromEnv(env, { fetch: franceTravailFetch }) ?? FRANCE_TRAVAIL_OFF, {
    refused: (answer) => (answer as { ok?: boolean; reason?: string }).ok === false && (answer as { reason?: string }).reason === "refused",
  });
  const franceTravail = () => (franceTravailConfigured() ? liveFranceTravail : null);

  // Built again whenever an AI key changes: a key entered later turns Job discovery on.
  const discovery = rebuilding(resolver, AI_SECRET_NAMES, (env): JobDiscovery | DiscoveryUnavailable => {
    try {
      buildAi(env);
    } catch (error) {
      if (!(error instanceof AiConfigError) || options.production) throw error;
      // The message names the missing setting, never a value.
      log(`[worker] Job discovery is unavailable: ${error.message}`);
      return { unavailable: error.message };
    }
    return createJobDiscovery({ ai, jobOffers: options.jobOffers, budget: options.budget, franceTravail, settings: options.settings, taskPlaybooks: options.taskPlaybooks, fetch: options.fetch, externalApis: options.externalApis });
  });

  return { discovery, ai, franceTravail, mailer: liveObject(resolver, MAIL_SECRET_NAMES, mailerFromEnv) };
}
