import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachActionsSettings } from "./settings";

/** Whether the AI Coach is offered Coach Actions now (#719): COACH_ACTIONS_ENABLED on, with at least one round. */
export function coachActionsOn(): boolean {
  const { enabled, maxRounds } = coachActionsSettings(getPlatformSettingsResolver().current());
  return enabled && maxRounds >= 1;
}
