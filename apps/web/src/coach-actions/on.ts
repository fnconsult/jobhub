import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachActionsSettings, coachWebLookupEnabled } from "./settings";

/** Whether the AI Coach is offered Coach Actions now (#719): COACH_ACTIONS_ENABLED on, with at least one round. */
export function coachActionsOn(): boolean {
  const { enabled, maxRounds } = coachActionsSettings(getPlatformSettingsResolver().current());
  return enabled && maxRounds >= 1;
}

/** Whether the AI Coach is offered its Web lookup now (#1159): COACH_WEB_LOOKUP_ENABLED on, never in Production yet. */
export function coachWebLookupOn(): boolean {
  return coachWebLookupEnabled(getPlatformSettingsResolver().current());
}
