/**
 * The « Quota atteint » banner (#1115, decisions #1111): at the head of every Back Office page, for every Administrator
 * whatever their roles, while at least one Tool is « limite atteinte » or « quota épuisé ». One line per such Tool, in
 * the catalog's order: its name, its state and since when, a link to where it is configured, and a link to its
 * provider's billing page (the Tool's `billingUrl`), opened in a new tab.
 *
 *   quotaBannerLines(await toolQuotaStates(database, now), access) // [] while every Tool is ok
 *
 * Where a Tool is configured: its sheet in Paramètres when its key is a Provider Secret entered there, its Outils page
 * otherwise (a key only env holds). A reader who may open neither gets no configuration link, never one to a 404.
 */
import { toolKeys, type Tool } from "@jobhub/shared";
import type { BackOfficeAccess } from "../admin/access";
import { providerSheetHref } from "../platform-settings/parametres";
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

/** The banner's lines: one per Tool of `states` refused for its quota, in their order; none while every Tool is ok. */
export function quotaBannerLines(states: readonly ToolQuotaState[], reader: Pick<BackOfficeAccess, "can">): QuotaBannerLine[] {
  return states.flatMap(({ tool, state, since }) => {
    if (state === "ok" || !tool.billingUrl) return [];
    return [{ toolId: tool.id, toolName: tool.name, state, since, configHref: quotaConfigHref(tool, reader), billingUrl: tool.billingUrl }];
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
