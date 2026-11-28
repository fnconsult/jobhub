import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachActionsSettings, coachSendEnabled, coachWebLookupEnabled } from "./settings";

/** Whether the AI Coach is offered Coach Actions now (#719): COACH_ACTIONS_ENABLED on, with at least one round. */
export function coachActionsOn(): boolean {
  const { enabled, maxRounds } = coachActionsSettings(getPlatformSettingsResolver().current());
  return enabled && maxRounds >= 1;
}

/** Whether the AI Coach is offered its Web lookup now (#1159): COACH_WEB_LOOKUP_ENABLED on, never in Production yet. */
export function coachWebLookupOn(): boolean {
  return coachWebLookupEnabled(getPlatformSettingsResolver().current());
}

/** Whether the AI Coach is offered `propose_send` now (#1162): COACH_SEND_ENABLED on, never in Production yet. */
export function coachSendOn(): boolean {
  return coachSendEnabled(getPlatformSettingsResolver().current());
}
