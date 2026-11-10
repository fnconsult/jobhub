import { notFound } from "next/navigation";
import { requireHumanCoach } from "@/human-coaches/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

/** The legacy Coach space stays in use until the deliberate rollout (#888). */
export function coachSpaceV2On(): boolean {
  const setting = getPlatformSettingsResolver().current().setting("COACH_SPACE_V2_ENABLED");
  return setting?.valid === true && setting.value === "true";
}

/** Every v2 entry point rechecks both the rollout and the active Human Coach. */
export async function requireCoachSpaceV2() {
  const coach = await requireHumanCoach();
  if (!coachSpaceV2On()) notFound();
  return coach;
}
