import { createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { getEuAiConsents } from "@/eu-ai-consent/server";

let instance: AiLayer | undefined;

/**
 * The app's AI layer (ADR-0007), configured from the environment on first use.
 * A Candidate's identity-bearing calls go to Mistral once they gave EU AI consent.
 */
export function getAi(): AiLayer {
  instance ??= createAiLayerFromEnv(process.env, { euAiConsent: (candidateId) => getEuAiConsents().has(candidateId) });
  return instance;
}
