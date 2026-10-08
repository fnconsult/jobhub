import { createApolloProvider } from "./providers/apollo";
import { createKasprProvider } from "./providers/kaspr";
import { createLushaProvider } from "./providers/lusha";
import { CONTACT_PROVIDERS, type ContactEnrichmentProvider, type ContactProviderId } from "./providers/types";

type Env = Record<string, string | undefined>;

const KEY_VARIABLES: Record<ContactProviderId, string> = { lusha: "LUSHA_API_KEY", kaspr: "KASPR_API_KEY", apollo: "APOLLO_API_KEY" };

const ADAPTERS: Record<ContactProviderId, (options: { apiKey: string; baseUrl?: string }) => ContactEnrichmentProvider> = {
  lusha: createLushaProvider,
  kaspr: createKasprProvider,
  apollo: createApolloProvider,
};

export type ContactEnrichmentConfig =
  | { provider: ContactEnrichmentProvider }
  /** Enriched Contacts are off: no provider chosen, or its data-processing agreement is not confirmed signed. */
  | { provider: null; disabledBecause: "no_provider" | "dpa_not_signed" };

/**
 * The active contact-enrichment provider, from environment variables (see
 * .env.example; secrets come from the secret manager in production). Enriched
 * Contacts stay off unless a provider is chosen and CONTACT_ENRICHMENT_DPA_SIGNED
 * is "true". A provider chosen without its key, or an unknown one, is a configuration error.
 */
export function contactEnrichmentFromEnv(env: Env): ContactEnrichmentConfig {
  const name = env.CONTACT_ENRICHMENT_PROVIDER?.trim().toLowerCase();
  if (!name) return { provider: null, disabledBecause: "no_provider" };
  if (!(CONTACT_PROVIDERS as readonly string[]).includes(name)) {
    throw new Error(`CONTACT_ENRICHMENT_PROVIDER must be one of ${CONTACT_PROVIDERS.join(", ")}; got "${name}"`);
  }
  const id = name as ContactProviderId;
  const apiKey = env[KEY_VARIABLES[id]];
  if (!apiKey) throw new Error(`Missing environment variable ${KEY_VARIABLES[id]} for CONTACT_ENRICHMENT_PROVIDER=${id}`);
  if (env.CONTACT_ENRICHMENT_DPA_SIGNED !== "true") return { provider: null, disabledBecause: "dpa_not_signed" };
  const baseUrl = env.CONTACT_ENRICHMENT_API_URL || undefined;
  return { provider: ADAPTERS[id]({ apiKey, ...(baseUrl && { baseUrl }) }) };
}
