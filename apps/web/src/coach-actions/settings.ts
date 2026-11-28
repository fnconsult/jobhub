/**
 * The Coach Actions' Platform Settings (ADR-0077, #713), as Paramètres sets them: COACH_ACTIONS_ENABLED (off by default)
 * and COACH_TOOL_ROUNDS_MAX (2 by default, from 0 to 4); and COACH_WEB_LOOKUP_ENABLED (#1159, ADR-0119), the Web lookup,
 * on by default for every Plan, but never in Production until its Legal Review (#1160) is done (WEB_LOOKUP_IN_PRODUCTION).
 * A value that does not read keeps the default.
 */
import { parseSetting, platformSetting } from "../platform-settings/catalog";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";
import type { CoachActionsSettings } from "./index";

export const COACH_ACTIONS_ENABLED = "COACH_ACTIONS_ENABLED";
export const COACH_TOOL_ROUNDS_MAX = "COACH_TOOL_ROUNDS_MAX";
export const COACH_WEB_LOOKUP_ENABLED = "COACH_WEB_LOOKUP_ENABLED";

/**
 * Whether the Web lookup may be switched on in Production (#1159): not while the Legal Review of the coach's web search
 * (#1160: the privacy policy's web search queries) is open. The product owner's decision of 2026-11-27: it ships on the
 * Beta, closed in Production. Set to true in the change that closes #1160.
 */
export const WEB_LOOKUP_IN_PRODUCTION = false;

/** Production is JOBHUB_TARGET=production, or a production build that names no target (ADR-0021, as the Release reads it). */
const inProduction = (env: Record<string, string | undefined>) => {
  const target = env.JOBHUB_TARGET?.trim();
  return target ? target === "production" : env.NODE_ENV === "production";
};

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

/** Whether the AI Coach is offered `search_web` (#1159): COACH_WEB_LOOKUP_ENABLED on, and in Production only once allowed. */
export function coachWebLookupEnabled(settings: Pick<PlatformSettingsSnapshot, "setting">, env: Record<string, string | undefined> = process.env): boolean {
  if (inProduction(env) && !WEB_LOOKUP_IN_PRODUCTION) return false;
  return settingOf(settings, COACH_WEB_LOOKUP_ENABLED) === true;
}
