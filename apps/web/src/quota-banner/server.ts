import type { BackOfficeAccess } from "@/admin/access";
import { sharedPool } from "@/database/pool";
import { cachedToolQuotaStates, toolQuotaStates, type ToolQuotaState } from "@/tool-quotas";
import { quotaBannerLines, type QuotaBannerLine } from "./index";

let states: (() => Promise<ToolQuotaState[]>) | null = null;

/**
 * Each Tool's quota state, read in one bounded query at most every 30 s for every page of every Administrator
 * (`cachedToolQuotaStates`). The e2e suite writes the calls itself and reads the very next page: it reads every time.
 */
function quotaStates(): Promise<ToolQuotaState[]> {
  states ??= cachedToolQuotaStates((now) => toolQuotaStates(sharedPool(), now), process.env.JOBHUB_TARGET?.trim() === "e2e" ? { ttlMs: 0 } : {});
  return states();
}

/**
 * The « Quota atteint » banner's lines for `access` (#1115), on every Back Office page: gone within the cache's 30 s
 * once every Tool is ok. A state that cannot be read shows no banner rather than no page.
 */
export async function quotaBannerOf(access: Pick<BackOfficeAccess, "can">): Promise<QuotaBannerLine[]> {
  try {
    return quotaBannerLines(await quotaStates(), access);
  } catch (error) {
    console.error("[quota-banner] could not read the Tools' quota states", error);
    return [];
  }
}
