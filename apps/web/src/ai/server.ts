import { createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { getAiUsageLog } from "@/ai-usage/server";
import { candidateIdentityOf } from "@/candidate-identity";
import { sharedPool } from "@/database/pool";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { AI_LAYER_SETTING_NAMES, withPlatformSettings } from "@/platform-settings/ai-routing";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { AI_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";

let instance: AiLayer | undefined;

/**
 * The app's AI layer (ADR-0007), configured from the environment with the Provider
 * Secrets and the AI routing Platform Settings over it (ADR-0033), and rebuilt when one
 * of its keys is replaced in the Back Office, or its routing (#301) or a price (#403) changed on Paramètres.
 * A Candidate's identity-bearing calls go to Mistral once they gave EU AI consent.
 * Every call is redacted before it leaves: what their account and latest Master CV say
 * of their identity, and every email and phone number (ADR-0007).
 * Every call is recorded in AI Usage and the AI Message Log, without waiting on them.
 * A text task routed to a provider whose key is missing fails its calls as key_missing; the others work.
 */
export function getAi(): AiLayer {
  instance ??= liveObject(withPlatformSettings(getSecretResolver(), getPlatformSettingsResolver()), [...AI_SECRET_NAMES, ...AI_LAYER_SETTING_NAMES], (env) =>
    createAiLayerFromEnv(env, {
      euAiConsent: (candidateId) => getEuAiConsents().has(candidateId),
      identityOf: candidateIdentityOf(sharedPool()),
      usage: getAiUsageLog(),
      // A text task routed on Paramètres to a provider whose key is not entered yet fails its own calls, nothing else (ADR-0042).
      tolerateMissingKeys: true,
    }),
  );
  return instance;
}
