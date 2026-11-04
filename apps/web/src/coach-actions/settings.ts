/**
 * The Coach Actions' Platform Settings (ADR-0077, #713), as Paramètres sets them: COACH_ACTIONS_ENABLED (off by default)
 * and COACH_TOOL_ROUNDS_MAX (2 by default, from 0 to 4). A value that does not read keeps the default.
 */
import { parseSetting, platformSetting } from "../platform-settings/catalog";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";
import type { CoachActionsSettings } from "./index";

export const COACH_ACTIONS_ENABLED = "COACH_ACTIONS_ENABLED";
export const COACH_TOOL_ROUNDS_MAX = "COACH_TOOL_ROUNDS_MAX";

/** The setting `name` in use, as its type parses it; its default when what is set does not read. */
function settingOf(settings: Pick<PlatformSettingsSnapshot, "setting">, name: string): string | number | boolean {
  const setting = platformSetting(name)!;
  const parsed = parseSetting(setting, settings.setting(name)?.value ?? "");
  if (parsed.ok) return parsed.value;
  const fallback = parseSetting(setting, setting.default);
  return fallback.ok ? fallback.value : "";
}

export function coachActionsSettings(settings: Pick<PlatformSettingsSnapshot, "setting">): CoachActionsSettings {
  return { enabled: settingOf(settings, COACH_ACTIONS_ENABLED) === true, maxRounds: Number(settingOf(settings, COACH_TOOL_ROUNDS_MAX)) };
}
