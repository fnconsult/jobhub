import { createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { getAiUsageLog } from "@/ai-usage/server";
import { candidateIdentityOf } from "@/candidate-identity";
import { sharedPool } from "@/database/pool";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { AI_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";

let instance: AiLayer | undefined;

/**
 * The app's AI layer (ADR-0007), configured from the environment with the Provider
 * Secrets over it, and rebuilt when one of its keys is replaced in the Back Office.
 * A Candidate's identity-bearing calls go to Mistral once they gave EU AI consent.
 * Every call is redacted before it leaves: what their account and latest Master CV say
 * of their identity, and every email and phone number (ADR-0007).
 * Every call is recorded in AI Usage and the AI Message Log, without waiting on them.
 */
export function getAi(): AiLayer {
  instance ??= liveObject(getSecretResolver(), AI_SECRET_NAMES, (env) =>
    createAiLayerFromEnv(env, { euAiConsent: (candidateId) => getEuAiConsents().has(candidateId), identityOf: candidateIdentityOf(sharedPool()), usage: getAiUsageLog() }),
  );
  return instance;
}
