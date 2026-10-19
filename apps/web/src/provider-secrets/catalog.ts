/**
 * The Provider Secrets (CONTEXT.md, #198): the third-party keys a super-admin may
 * enter in the Back Office, each named by the env variable it stands for. Anything
 * else stays in env: non-secret configuration (models, regions, *_LIVE flags,
 * MAIL_FROM, Stripe Price IDs) and the bootstrap secrets (DATABASE_URL, AUTH_SECRET,
 * SECRETS_MASTER_KEYS). GOOGLE_CLIENT_* will use the same store, managed by the SSO
 * section.
 */

/** Who a Provider Secret is for; keys of one provider are tested together. */
export const SECRET_PROVIDERS = ["mistral", "perplexity", "anthropic", "bedrock", "france-travail", "lusha", "kaspr", "apollo", "stripe", "brevo"] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const PROVIDER_SECRETS = [
  { name: "MISTRAL_API_KEY", provider: "mistral" },
  { name: "PERPLEXITY_API_KEY", provider: "perplexity" },
  // Claude: the direct API (outside the EU: tasks without personal data only) and/or Bedrock (EU). ANTHROPIC_ENDPOINT=auto uses whichever are entered.
  { name: "ANTHROPIC_API_KEY", provider: "anthropic" },
  { name: "AWS_BEARER_TOKEN_BEDROCK", provider: "bedrock" },
  { name: "FRANCE_TRAVAIL_CLIENT_ID", provider: "france-travail" },
  { name: "FRANCE_TRAVAIL_CLIENT_SECRET", provider: "france-travail" },
  // The contact-enrichment API key: only the active provider's (CONTACT_ENRICHMENT_PROVIDER) is used.
  { name: "LUSHA_API_KEY", provider: "lusha" },
  { name: "KASPR_API_KEY", provider: "kaspr" },
  { name: "APOLLO_API_KEY", provider: "apollo" },
  { name: "STRIPE_SECRET_KEY", provider: "stripe" },
  { name: "STRIPE_WEBHOOK_SECRET", provider: "stripe" },
  // Brevo's SMTP relay: the URL carries its credentials.
  { name: "SMTP_URL", provider: "brevo" },
] as const satisfies ReadonlyArray<{ name: string; provider: SecretProvider }>;

export type ProviderSecretName = (typeof PROVIDER_SECRETS)[number]["name"];

export const PROVIDER_SECRET_NAMES: readonly ProviderSecretName[] = PROVIDER_SECRETS.map((secret) => secret.name);

export const isProviderSecretName = (value: unknown): value is ProviderSecretName => PROVIDER_SECRET_NAMES.includes(value as ProviderSecretName);

export const providerOf = (name: ProviderSecretName): SecretProvider => PROVIDER_SECRETS.find((secret) => secret.name === name)!.provider;

/** The keys the AI layer reads among the Provider Secrets. */
export const AI_SECRET_NAMES = ["MISTRAL_API_KEY", "PERPLEXITY_API_KEY", "ANTHROPIC_API_KEY", "AWS_BEARER_TOKEN_BEDROCK"] as const satisfies readonly ProviderSecretName[];
export const STRIPE_SECRET_NAMES = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const satisfies readonly ProviderSecretName[];
export const FRANCE_TRAVAIL_SECRET_NAMES = ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"] as const satisfies readonly ProviderSecretName[];
export const CONTACT_ENRICHMENT_SECRET_NAMES = ["LUSHA_API_KEY", "KASPR_API_KEY", "APOLLO_API_KEY"] as const satisfies readonly ProviderSecretName[];
export const MAIL_SECRET_NAMES = ["SMTP_URL"] as const satisfies readonly ProviderSecretName[];

/** Fewer characters than this, and no fingerprint is shown: 4 of them would give away too much. */
const FINGERPRINT_MIN_LENGTH = 16;

/** What the Back Office shows of a value: its last 4 characters, for a long enough one. Never more. */
export function fingerprintOf(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= FINGERPRINT_MIN_LENGTH ? trimmed.slice(-4) : null;
}
