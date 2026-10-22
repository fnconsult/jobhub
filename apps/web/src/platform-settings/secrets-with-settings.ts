/**
 * The Provider Secrets in use with the Platform Settings in use over them, as one resolver: for a
 * client that holds both, such as the mailers (Brevo's key, and `MAIL_FROM`). Built with `liveObject`
 * over it, the client is rebuilt when either changes, so a key replaced in Clés and a value saved on
 * Paramètres are both used without a restart (ADR-0020, ADR-0033).
 *
 *   const resolver = secretsWithSettings(secrets, settings);
 *   const mailer = liveObject(resolver, [...MAIL_SECRET_NAMES, "MAIL_FROM"], (env) => mailerFromEnv(env));
 *
 * Its `env` is env with the database's Provider Secrets and the Back Office's Platform Settings over it:
 * a setting the Back Office did not set keeps env's value, or none (the reader of env applies its own
 * default). Only types are imported here: the catalog reads the mailers, which read this.
 */
import type { SecretResolver, SecretsSnapshot } from "../provider-secrets/resolver";
import type { PlatformSettingsResolver, PlatformSettingsSnapshot } from "./resolver";

function combined(secrets: SecretsSnapshot, settings: PlatformSettingsSnapshot): SecretsSnapshot {
  const env = { ...secrets.env };
  for (const setting of settings.settings) if (setting.source === "back_office") env[setting.name] = setting.value;
  return {
    env,
    source: secrets.source,
    versionOf: (names) => names.map((name) => (settings.setting(name) ? settings.versionOf([name]) : secrets.versionOf([name]))).join(","),
  };
}

export function secretsWithSettings(secrets: SecretResolver, settings: PlatformSettingsResolver): SecretResolver {
  return {
    current: () => combined(secrets.current(), settings.current()),
    async refresh() {
      const [secretsNow, settingsNow] = await Promise.all([secrets.refresh(), settings.refresh()]);
      return combined(secretsNow, settingsNow);
    },
  };
}
