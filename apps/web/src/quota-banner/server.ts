import type { BackOfficeAccess } from "@/admin/access";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { currentToolQuotaStates } from "@/tool-quotas/server";
import { quotaBannerLines, quotaBannerShown, type QuotaBannerLine } from "./index";

/**
 * The « Quota atteint » banner's lines for `access` (#1115), on every Back Office page: gone within the cache's 30 s
 * once every Tool is ok, each billing link as Paramètres sets it now (#1123). A state that cannot be read shows no banner
 * rather than no page.
 */
export async function quotaBannerOf(access: Pick<BackOfficeAccess, "can">): Promise<QuotaBannerLine[]> {
  if (!quotaBannerShown(process.env)) return [];
  try {
    return quotaBannerLines(await currentToolQuotaStates(), access, getPlatformSettingsResolver().current());
  } catch (error) {
    console.error("[quota-banner] could not read the Tools' quota states", error);
    return [];
  }
}
