import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { coachingNoticesEnabled } from "./legal";
/** The coaching notifications (#885) deliver nothing, and show no settings, while « Espace coach v2 » is off (ADR-0106). */
export function coachingNoticesOn() {
  if (!coachSpaceV2On()) return false;
  const current = getPlatformSettingsResolver().current();
  return coachingNoticesEnabled(
    current.setting("CAL_COM_REMINDERS_DISABLED")?.valid === true && current.setting("CAL_COM_REMINDERS_DISABLED")?.value === "true",
  );
}
