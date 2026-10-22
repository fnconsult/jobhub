import { enrichmentCostInEur } from "@jobhub/ai";
import { recordingFetch, type ExternalApiLog } from "@jobhub/shared";
import { CONTACT_ENRICHMENT_SECRET_NAMES } from "../provider-secrets/catalog";
import { liveObject, type SecretResolver } from "../provider-secrets/resolver";
import { createApolloProvider } from "./providers/apollo";
import { createKasprProvider } from "./providers/kaspr";
import { createLushaProvider } from "./providers/lusha";
import { CONTACT_PROVIDERS, NO_PROVIDER, type ContactEnrichmentProvider, type ContactProviderId } from "./providers/types";

type Env = Record<string, string | undefined>;

const KEY_VARIABLES: Record<ContactProviderId, string> = { lusha: "LUSHA_API_KEY", kaspr: "KASPR_API_KEY", apollo: "APOLLO_API_KEY" };

const ADAPTERS: Record<ContactProviderId, (options: { apiKey: string; baseUrl?: string; fetch?: typeof globalThis.fetch }) => ContactEnrichmentProvider> = {
  lusha: createLushaProvider,
  kaspr: createKasprProvider,
  apollo: createApolloProvider,
};

export interface ContactEnrichmentDeps {
  /** Where each call to the provider is recorded (AI Usage's external APIs): its operation, status and duration, never its payload. */
  externalApis?: ExternalApiLog;
}

export type ContactEnrichmentConfig =
  | { provider: ContactEnrichmentProvider }
  /**
   * Enriched Contacts are off: no provider chosen (or "none"), its data-processing agreement not
   * confirmed signed, or the chosen provider's key not set (Clés, else env).
   */
  | { provider: null; disabledBecause: "no_provider" | "dpa_not_signed" | "no_key" };

/** The Platform Settings Enriched Contacts read (ADR-0015, ADR-0033): set on Paramètres, over env. */
export const CONTACT_ENRICHMENT_SETTING_NAMES = ["CONTACT_ENRICHMENT_PROVIDER", "CONTACT_ENRICHMENT_DPA_SIGNED"] as const;

/**
 * The active contact-enrichment provider, from the values in use (the Platform Settings
 * CONTACT_ENRICHMENT_PROVIDER and CONTACT_ENRICHMENT_DPA_SIGNED, the Provider Secret of the
 * chosen provider's key; see .env.example). Enriched Contacts stay off unless a provider is
 * chosen and CONTACT_ENRICHMENT_DPA_SIGNED is "true", whatever the key; then off too until
 * the provider's key is set. An unknown provider is a configuration error.
 */
export function contactEnrichmentFromEnv(env: Env, deps: ContactEnrichmentDeps = {}): ContactEnrichmentConfig {
  const name = env.CONTACT_ENRICHMENT_PROVIDER?.trim().toLowerCase();
  if (!name || name === NO_PROVIDER) return { provider: null, disabledBecause: "no_provider" };
  if (!(CONTACT_PROVIDERS as readonly string[]).includes(name)) {
    throw new Error(`CONTACT_ENRICHMENT_PROVIDER must be one of ${[NO_PROVIDER, ...CONTACT_PROVIDERS].join(", ")}; got "${name}"`);
  }
  if (env.CONTACT_ENRICHMENT_DPA_SIGNED !== "true") return { provider: null, disabledBecause: "dpa_not_signed" };
  const id = name as ContactProviderId;
  const apiKey = env[KEY_VARIABLES[id]];
  if (!apiKey) return { provider: null, disabledBecause: "no_key" };
  const baseUrl = env.CONTACT_ENRICHMENT_API_URL || undefined;
  const fetch = deps.externalApis ? recordingFetch(globalThis.fetch, deps.externalApis, {
        provider: id,
        costEur: (status, operation) => enrichmentCostInEur(id, operation, status),
      }) : undefined;
  return { provider: ADAPTERS[id]({ apiKey, ...(baseUrl && { baseUrl }), ...(fetch && { fetch }) }) };
}

/**
 * The active contact-enrichment provider from env with the Provider Secrets over it
 * (#208). Its calls go through `liveObject`: one refused for its key (401/403) reads
 * the database again and is made once more with a key just replaced in the Back Office.
 */
export function contactEnrichmentFromSecrets(resolver: SecretResolver, deps: ContactEnrichmentDeps = {}): ContactEnrichmentConfig {
  const config = contactEnrichmentFromEnv(resolver.current().env, deps);
  if (!config.provider) return config;
  const configured = config.provider;
  return { provider: liveObject(resolver, CONTACT_ENRICHMENT_SECRET_NAMES, (env) => contactEnrichmentFromEnv(env, deps).provider ?? configured) };
}
