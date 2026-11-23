/**
 * The feature flag of an Application's Exchanges (#1099, ADR-0115, proposed): APPLICATION_EXCHANGES_ENABLED, a Platform
 * Setting off by default, switched on in Paramètres (Email intake's sheet) only once the Legal Review of its « Légal : »
 * issue is done, with a confirmation. Off, everything is as before Exchanges: Email intake keeps no text of an email
 * about an Application, and there is no « Échanges » Section, no route and no Coach Action on them.
 */
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";

export const APPLICATION_EXCHANGES_ENABLED = "APPLICATION_EXCHANGES_ENABLED";

/** Whether Exchanges are on in `settings`: only once set to "true". */
export function exchangesEnabled(settings: Pick<PlatformSettingsSnapshot, "setting">): boolean {
  const flag = settings.setting(APPLICATION_EXCHANGES_ENABLED);
  return flag?.valid === true && flag.value === "true";
}
