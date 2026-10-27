import { sharedPool } from "@/database/pool";
import { readNumberSetting } from "@/platform-settings/catalog";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { webSearchAlertThresholdFromEnv } from "@/web-search-alert";
import { jobDiscoveryDashboard, type JobDiscoveryDashboard } from "./index";

/** This month's Job discovery figures so far, against the alert threshold and the run budget Paramètres sets now. */
export function currentJobDiscoveryDashboard(): Promise<JobDiscoveryDashboard> {
  const { env } = getPlatformSettingsResolver().current();
  return jobDiscoveryDashboard(sharedPool(), {
    now: new Date(),
    thresholdEur: webSearchAlertThresholdFromEnv(env),
    runBudgetEur: readNumberSetting(env, "JOB_DISCOVERY_BUDGET_EUR"),
  });
}
