/**
 * The Coach Actions' Platform Settings (ADR-0077, #713), as Paramètres sets them: COACH_ACTIONS_ENABLED (off by default)
 * and COACH_TOOL_ROUNDS_MAX (2 by default, from 0 to 4); and COACH_WEB_LOOKUP_ENABLED (#1159, ADR-0119), the Web lookup,
 * on by default for every Plan, but never in Production until its Legal Review (#1160) is done (WEB_LOOKUP_IN_PRODUCTION);
 * COACH_SEND_ENABLED (#1162), sending on the Candidate's click, off by default and never in Production either
 * (SEND_IN_PRODUCTION), with COACH_SENDS_PER_DAY (20 by default) Sends a day per Candidate at most.
 * A value that does not read keeps the default.
 */
import { parseSetting, platformSetting } from "../platform-settings/catalog";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";
import type { CoachActionsSettings } from "./index";

export const COACH_ACTIONS_ENABLED = "COACH_ACTIONS_ENABLED";
export const COACH_TOOL_ROUNDS_MAX = "COACH_TOOL_ROUNDS_MAX";
export const COACH_WEB_LOOKUP_ENABLED = "COACH_WEB_LOOKUP_ENABLED";
export const COACH_SEND_ENABLED = "COACH_SEND_ENABLED";
export const COACH_SENDS_PER_DAY = "COACH_SENDS_PER_DAY";

/**
 * Whether the Web lookup may be switched on in Production (#1159): not while the Legal Review of the coach's web search
 * (#1160: the privacy policy's web search queries) is open. The product owner's decision of 2026-11-27: it ships on the
 * Beta, closed in Production. Set to true in the change that closes #1160.
 */
export const WEB_LOOKUP_IN_PRODUCTION = false;

/**
 * Whether sending on the Candidate's click (`propose_send`, #1162) may be switched on in Production: not while the Legal
 * Review of sending in the Candidate's name (#1160: the privacy policy and the CGU) is open. The product owner's decision of
 * 2026-11-27: shipped behind COACH_SEND_ENABLED, off by default, never on in Production. Set to true in the change that
 * closes #1160.
 */
export const SEND_IN_PRODUCTION = false;

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

/** Whether the AI Coach is offered `propose_send` (#1162): COACH_SEND_ENABLED on, and in Production only once allowed. */
export function coachSendEnabled(settings: Pick<PlatformSettingsSnapshot, "setting">, env: Record<string, string | undefined> = process.env): boolean {
  if (inProduction(env) && !SEND_IN_PRODUCTION) return false;
  return settingOf(settings, COACH_SEND_ENABLED) === true;
}

/** COACH_SENDS_PER_DAY (#1162): how many emails Jobbbox sends in one Candidate's name a day at most. */
export function coachSendsPerDay(settings: Pick<PlatformSettingsSnapshot, "setting">): number {
  return Number(settingOf(settings, COACH_SENDS_PER_DAY));
}
