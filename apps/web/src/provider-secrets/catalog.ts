/**
 * The Provider Secrets (CONTEXT.md, #198): the third-party keys a super-admin may
 * enter in the Back Office, each named by the env variable it stands for. Anything
 * else stays in env: non-secret configuration (models, regions, *_LIVE flags,
 * MAIL_FROM, Stripe Price IDs) and the bootstrap secrets (DATABASE_URL, AUTH_SECRET,
 * SECRETS_MASTER_KEYS). GOOGLE_CLIENT_* will use the same store, managed by the SSO
 * section.
 */

/** Who a Provider Secret is for; keys of one provider are tested together. */
export const SECRET_PROVIDERS = ["mistral", "perplexity", "brave", "tavily", "anthropic", "bedrock", "france-travail", "fantastic-jobs", "lusha", "kaspr", "apollo", "stripe", "brevo", "email-intake"] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const PROVIDER_SECRETS = [
  { name: "MISTRAL_API_KEY", provider: "mistral" },
  { name: "PERPLEXITY_API_KEY", provider: "perplexity" },
  // Search providers (ADR-0043): only the active one's key (and its fallback's) is used; without it, web search is unavailable.
  { name: "BRAVE_SEARCH_API_KEY", provider: "brave" },
  { name: "TAVILY_API_KEY", provider: "tavily" },
  // Claude: the direct API (ANTHROPIC_ENDPOINT=direct, the default; outside the EU, redacted) and/or Bedrock (EU). ANTHROPIC_ENDPOINT=auto uses whichever are entered.
  { name: "ANTHROPIC_API_KEY", provider: "anthropic" },
  { name: "AWS_BEARER_TOKEN_BEDROCK", provider: "bedrock" },
  { name: "FRANCE_TRAVAIL_CLIENT_ID", provider: "france-travail" },
  { name: "FRANCE_TRAVAIL_CLIENT_SECRET", provider: "france-travail" },
  // Fantastic.jobs: its API of ATS postings, a Job discovery source (#243). Each job it returns is charged.
  { name: "FANTASTIC_JOBS_API_KEY", provider: "fantastic-jobs" },
  // The contact-enrichment API key: only the active provider's (CONTACT_ENRICHMENT_PROVIDER) is used.
  { name: "LUSHA_API_KEY", provider: "lusha" },
  { name: "KASPR_API_KEY", provider: "kaspr" },
  { name: "APOLLO_API_KEY", provider: "apollo" },
  { name: "STRIPE_SECRET_KEY", provider: "stripe" },
  { name: "STRIPE_WEBHOOK_SECRET", provider: "stripe" },
  // Brevo: its transactional email API key, used over its SMTP relay (whose URL carries its credentials).
  { name: "BREVO_API_KEY", provider: "brevo" },
  { name: "SMTP_URL", provider: "brevo" },
  // Email intake (#580): the secret its own MTA sends with each email it posts to the app; the MTA holds the same one.
  { name: "EMAIL_INTAKE_INBOUND_SECRET", provider: "email-intake" },
] as const satisfies ReadonlyArray<{ name: string; provider: SecretProvider }>;

export type ProviderSecretName = (typeof PROVIDER_SECRETS)[number]["name"];

export const PROVIDER_SECRET_NAMES: readonly ProviderSecretName[] = PROVIDER_SECRETS.map((secret) => secret.name);

export const isProviderSecretName = (value: unknown): value is ProviderSecretName => PROVIDER_SECRET_NAMES.includes(value as ProviderSecretName);

export const providerOf = (name: ProviderSecretName): SecretProvider => PROVIDER_SECRETS.find((secret) => secret.name === name)!.provider;

/** The keys the AI layer reads among the Provider Secrets. */
export const AI_SECRET_NAMES = ["MISTRAL_API_KEY", "PERPLEXITY_API_KEY", "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "ANTHROPIC_API_KEY", "AWS_BEARER_TOKEN_BEDROCK"] as const satisfies readonly ProviderSecretName[];
export const STRIPE_SECRET_NAMES = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const satisfies readonly ProviderSecretName[];
export const FRANCE_TRAVAIL_SECRET_NAMES = ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"] as const satisfies readonly ProviderSecretName[];
export const FANTASTIC_JOBS_SECRET_NAMES = ["FANTASTIC_JOBS_API_KEY"] as const satisfies readonly ProviderSecretName[];
export const CONTACT_ENRICHMENT_SECRET_NAMES = ["LUSHA_API_KEY", "KASPR_API_KEY", "APOLLO_API_KEY"] as const satisfies readonly ProviderSecretName[];
export const MAIL_SECRET_NAMES = ["BREVO_API_KEY", "SMTP_URL"] as const satisfies readonly ProviderSecretName[];
export const EMAIL_INTAKE_SECRET_NAMES = ["EMAIL_INTAKE_INBOUND_SECRET"] as const satisfies readonly ProviderSecretName[];

/** Fewer characters than this, and no fingerprint is shown: 4 of them would give away too much. */
const FINGERPRINT_MIN_LENGTH = 16;

/** What the Back Office shows of a value: its last 4 characters, for a long enough one. Never more. */
export function fingerprintOf(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= FINGERPRINT_MIN_LENGTH ? trimmed.slice(-4) : null;
}
