import type { BackOfficeAccess } from "@/admin/access";
import { sharedPool } from "@/database/pool";
import { readNumberSetting } from "@/platform-settings/catalog";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { currentToolQuotaStates } from "@/tool-quotas/server";
import { currentState } from "@/tools/server";
import { webSearchAlertThresholdFromEnv } from "@/web-search-alert";
import { apiBlockRows, type ApiBlockRow } from "./api-block";
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

/**
 * The « API » block's rows now (#1116): each configured Tool's quota state, read with the « Quota atteint » banner's
 * (cached, bounded), as `reader` follows its links.
 */
export async function currentApiBlock(reader: Pick<BackOfficeAccess, "can">): Promise<ApiBlockRow[]> {
  const [states, tools] = await Promise.all([currentToolQuotaStates(), currentState()]);
  return apiBlockRows(states, tools, reader);
}
