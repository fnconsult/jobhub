import { cache } from "react";
import type { BackOfficeAccess } from "@/admin/access";
import { sharedPool } from "@/database/pool";
import { createToolQuotas, type ToolQuotaState } from "@/tool-quotas";
import { quotaBannerLines, type QuotaBannerLine } from "./index";

/** Each Tool's quota state, read in one query, once per request however many times the page asks. */
const toolQuotaStates = cache((): Promise<ToolQuotaState[]> => createToolQuotas(sharedPool()).states());

/**
 * The « Quota atteint » banner's lines for `access` (#1115), read afresh on every Back Office page: the banner is gone at
 * the next page once every Tool is ok. A state that cannot be read shows no banner rather than no page.
 */
export async function quotaBannerOf(access: Pick<BackOfficeAccess, "can">): Promise<QuotaBannerLine[]> {
  try {
    return quotaBannerLines(await toolQuotaStates(), access);
  } catch (error) {
    console.error("[quota-banner] could not read the Tools' quota states", error);
    return [];
  }
}
