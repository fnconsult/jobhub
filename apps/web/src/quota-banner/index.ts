/**
 * The « Quota atteint » banner (#1115, decisions #1111): at the head of every Back Office page, for every Administrator
 * whatever their roles, while at least one Tool is « limite atteinte » or « quota épuisé ». One line per such Tool, in
 * the catalog's order: its name, its state and since when, a link to where it is configured, and a link to its
 * provider's billing page, opened in a new tab: its Platform Setting in use (`<TOOL>_BILLING_URL`, #1123), set on the
 * Tool's sheet, else the catalog's `billingUrl`.
 *
 *   quotaBannerLines(await toolQuotaStates(database, now), access, settings) // [] while every Tool is ok
 *
 * Where a Tool is configured: its sheet in Paramètres when its key is a Provider Secret entered there, its Outils page
 * otherwise (a key only env holds). A reader who may open neither gets no configuration link, never one to a 404.
 */
import { billingUrlSettingName, toolKeys, type Tool } from "@jobhub/shared";
import type { BackOfficeAccess } from "../admin/access";
import { providerSheetHref } from "../platform-settings/parametres";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";
import { isProviderSecretName } from "../provider-secrets/catalog";
import { routes } from "../routes";
import type { ToolQuotaState } from "../tool-quotas/index";

/** A Tool refused for its quota, as a line of the banner says it. */
export interface QuotaBannerLine {
  toolId: Tool["id"];
  toolName: string;
  state: Exclude<ToolQuotaState["state"], "ok">;
  /** When the state began. */
  since: Date | null;
  /** Where the reader configures the Tool in the Back Office; null when they may open neither Paramètres nor Outils. */
  configHref: string | null;
  /** The provider's billing page. */
  billingUrl: string;
}

/**
 * Where `reader` configures `tool`: its sheet in Paramètres when its key is entered there, else its Outils page; null
 * when they may open neither. The banner's « configuration » link, and the Dashboard's « API » block's (#1116).
 */
export function quotaConfigHref(tool: Tool, reader: Pick<BackOfficeAccess, "can">): string | null {
  const sheet = toolKeys(tool).some(isProviderSecretName) ? providerSheetHref(tool) : undefined;
  if (sheet && reader.can("platformSettings", "read")) return sheet;
  return reader.can("tools", "read") ? routes.adminTool(tool.id) : null;
}

/**
 * `tool`'s billing page in use (#1123): its Platform Setting's value (the Back Office's, else env's) when it is an https
 * URL, else the catalog's `billingUrl`; none for a Tool without a quota. The banner's, the « API » block's and the daily
 * email's « Facturation » link.
 */
export function billingUrlOf(tool: Tool, settings: Pick<PlatformSettingsSnapshot, "setting">): string | undefined {
  if (!tool.billingUrl) return undefined;
  const setting = settings.setting(billingUrlSettingName(tool));
  return setting?.value && setting.valid ? setting.value : tool.billingUrl;
}

/** The banner's lines: one per Tool of `states` refused for its quota, in their order, as `settings` link them; none while every Tool is ok. */
export function quotaBannerLines(states: readonly ToolQuotaState[], reader: Pick<BackOfficeAccess, "can">, settings: Pick<PlatformSettingsSnapshot, "setting">): QuotaBannerLine[] {
  return states.flatMap(({ tool, state, since }) => {
    const billingUrl = billingUrlOf(tool, settings);
    if (state === "ok" || !billingUrl) return [];
    return [{ toolId: tool.id, toolName: tool.name, state, since, configHref: quotaConfigHref(tool, reader), billingUrl }];
  });
}

/**
 * Whether the banner is shown at all: everywhere, but on the e2e suite's shared server (JOBHUB_TARGET=e2e with
 * E2E_QUOTA_BANNER_OFF=1, playwright.config.ts). There, specs running side by side make calls refused for a quota
 * (a Guardrail's 429, #262; Consommation IA's counts, #1114), and the banner would join their pages' own status;
 * e2e/quota-banner.spec.ts checks it on a server of its own.
 */
export function quotaBannerShown(env: Record<string, string | undefined>): boolean {
  return !(env.JOBHUB_TARGET?.trim() === "e2e" && env.E2E_QUOTA_BANNER_OFF?.trim() === "1");
}
