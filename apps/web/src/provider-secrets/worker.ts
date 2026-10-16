/** What the worker uses of Provider Secrets (`@jobhub/web/provider-secrets`): the same resolver as the web app. */
export { AI_SECRET_NAMES, FRANCE_TRAVAIL_SECRET_NAMES, MAIL_SECRET_NAMES } from "./catalog";
export type { ProviderSecretsReader } from "./index";
export { createSecretResolver, liveObject, rebuilding, type SecretResolver, type StoredSecrets } from "./resolver";
export { watchProviderSecrets, type WatchedProviderSecrets } from "./watch";
