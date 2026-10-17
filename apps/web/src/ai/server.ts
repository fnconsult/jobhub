import { createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { AI_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";

let instance: AiLayer | undefined;

/**
 * The app's AI layer (ADR-0007), configured from the environment with the Provider
 * Secrets over it, and rebuilt when one of its keys is replaced in the Back Office.
 * A Candidate's identity-bearing calls go to Mistral once they gave EU AI consent.
 */
export function getAi(): AiLayer {
  instance ??= liveObject(getSecretResolver(), AI_SECRET_NAMES, (env) =>
    createAiLayerFromEnv(env, { euAiConsent: (candidateId) => getEuAiConsents().has(candidateId) }),
  );
  return instance;
}
