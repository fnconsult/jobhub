import { sharedPool } from "@/database/pool";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { postgresWebSearchAlertStore, webSearchAlertState, webSearchAlertThresholdFromEnv, type WebSearchAlertState } from "./index";

/** This month's web search spend against WEB_SEARCH_MONTHLY_ALERT_EUR as Paramètres sets it (#403): Consommation IA's banner. */
export function currentWebSearchAlert(): Promise<WebSearchAlertState> {
  return webSearchAlertState({
    store: postgresWebSearchAlertStore(sharedPool()),
    thresholdEur: () => webSearchAlertThresholdFromEnv(getPlatformSettingsResolver().current().env),
  });
}
