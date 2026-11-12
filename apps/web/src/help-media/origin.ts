import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachSpaceV2In } from "@/coach-space-v2";
import { helpMediaOrigin } from ".";

/**
 * The Help Centre's media origin in use (HELP_MEDIA_ORIGIN), from the Platform Settings' per-process cache, never the
 * database; its default when they cannot be read. Light enough for the proxy: it bundles no Help Article.
 */
export function currentHelpMediaOrigin(): string {
  try {
    return helpMediaOrigin(getPlatformSettingsResolver().current());
  } catch {
    return helpMediaOrigin({ setting: () => undefined });
  }
}

/** Whether « Espace coach v2 » is on, from the same per-process cache; off when the settings cannot be read. */
export function currentCoachSpaceV2(): boolean {
  try {
    return coachSpaceV2In(getPlatformSettingsResolver().current());
  } catch {
    return false;
  }
}
