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

/** Email intake's limits (#442), each the Back Office's, else env's, else its default; a value that does not read keeps the default. */
export interface EmailIntakeLimits {
  /** How many emails one Linked mailbox may have read a day (EMAIL_INTAKE_DAILY_CAP). */
  dailyCap: number;
  /** From how many emails a day the Candidate's filter counts as « filtre trop large » (EMAIL_INTAKE_BROAD_FILTER_THRESHOLD). */
  broadFilterThreshold: number;
  /** The networks Email intake's MTA posts from (EMAIL_INTAKE_MTA_IP_RANGES): those that read. */
  mtaIpRanges: string[];
}

/** The setting in use as its type reads it, else its default (which its type always reads: the catalog's tests hold it). */
function settingOf(settings: PlatformSettingsSnapshot, name: string): string | number | boolean {
  const setting = platformSetting(name)!;
  const parsed = parseSetting(setting, settings.setting(name)?.value ?? "");
  const fallback = parseSetting(setting, setting.default);
  return parsed.ok ? parsed.value : fallback.ok ? fallback.value : setting.default;
}

/** An IPv4 range (a.b.c.d/n), an IPv4 address, or an IPv6 address compared as written. */
const IP_RANGE = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?|[0-9a-f:]*:[0-9a-f:]*)$/i;

const rangesOf = (value: string) =>
  value
    .split(",")
    .map((range) => range.trim())
    .filter((range) => IP_RANGE.test(range));

export function emailIntakeLimits(settings: PlatformSettingsSnapshot): EmailIntakeLimits {
  const ranges = rangesOf(String(settingOf(settings, "EMAIL_INTAKE_MTA_IP_RANGES")));
  return {
    dailyCap: Number(settingOf(settings, "EMAIL_INTAKE_DAILY_CAP")),
    broadFilterThreshold: Number(settingOf(settings, "EMAIL_INTAKE_BROAD_FILTER_THRESHOLD")),
    mtaIpRanges: ranges.length > 0 ? ranges : rangesOf(platformSetting("EMAIL_INTAKE_MTA_IP_RANGES")!.default),
  };
}
