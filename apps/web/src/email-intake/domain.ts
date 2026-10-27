import { parseSetting, platformSetting } from "../platform-settings/catalog";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";

/**
 * The Email intake domain new Forwarding addresses are on (EMAIL_INTAKE_DOMAIN, #441): the Back Office's, else
 * env's, else alertes.jobbbox.ai; the default too when env's is not a domain name.
 */
export function emailIntakeDomain(settings: PlatformSettingsSnapshot): string {
  const setting = platformSetting("EMAIL_INTAKE_DOMAIN")!;
  const parsed = parseSetting(setting, settings.setting(setting.name)?.value ?? "");
  return parsed.ok ? String(parsed.value) : setting.default;
}
