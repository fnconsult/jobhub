import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachingNoticesEnabled } from "./legal";
export function coachingNoticesOn() {
  const current = getPlatformSettingsResolver().current();
  return coachingNoticesEnabled(
    current.setting("COACH_SPACE_V2_ENABLED")?.valid === true && current.setting("COACH_SPACE_V2_ENABLED")?.value === "true",
    current.setting("CAL_COM_REMINDERS_DISABLED")?.valid === true && current.setting("CAL_COM_REMINDERS_DISABLED")?.value === "true",
  );
}
