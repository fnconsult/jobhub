import { getPlatformSettingsResolver } from "@/platform-settings/server";
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
