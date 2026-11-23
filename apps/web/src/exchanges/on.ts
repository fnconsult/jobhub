import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { exchangesEnabled } from "./settings";

/** Whether an Application's Exchanges are on now (#1099, ADR-0115): APPLICATION_EXCHANGES_ENABLED, off by default. */
export function exchangesOn(): boolean {
  return exchangesEnabled(getPlatformSettingsResolver().current());
}
