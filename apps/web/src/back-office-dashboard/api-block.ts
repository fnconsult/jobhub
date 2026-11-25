/**
 * The Dashboard's « API » block (#1116, decisions #1111): every Administrator, whatever their roles, sees the Tool quota
 * state of each Tool with a quota that is configured, « OK » included. One row per such Tool, in the catalog's order: its
 * name, its state (« OK », « limite atteinte », « quota épuisé »), since when, when its provider said the quota renews,
 * and the « Quota atteint » banner's two links (#1115): where it is configured, its provider's billing page.
 *
 *   apiBlockRows(await currentToolQuotaStates(), await currentState(), access)
 *
 * A Tool off or without its key (its Outils status other than « configuré ») is left out: it makes no call, so its state
 * says nothing. Its configuration link is the banner's (`quotaConfigHref`): none for a reader who may open neither
 * Paramètres nor Outils, never one to a 404.
 */
import type { Tool } from "@jobhub/shared";
import type { BackOfficeAccess } from "../admin/access";
import { quotaConfigHref } from "../quota-banner/index";
import type { ToolQuotaState, ToolQuotaStatus } from "../tool-quotas/index";
import { toolStatus, type ToolsState } from "../tools/index";

/** A configured Tool with a quota, as a row of the « API » block says it. */
export interface ApiBlockRow {
  toolId: Tool["id"];
  toolName: string;
  state: ToolQuotaStatus;
  /** When its state began; null while ok. */
  since: Date | null;
  /** When its provider said the quota renews; null when it did not. */
  renewsAt: Date | null;
  /** Where the reader configures the Tool in the Back Office; null when they may open neither Paramètres nor Outils. */
  configHref: string | null;
  /** Its provider's billing page. */
  billingUrl: string;
}

/** The block's rows: one per Tool of `states` that `tools` says is configured, in their order. */
export function apiBlockRows(states: readonly ToolQuotaState[], tools: ToolsState, reader: Pick<BackOfficeAccess, "can">): ApiBlockRow[] {
  return states.flatMap(({ tool, state, since, renewsAt }) => {
    if (!tool.billingUrl || toolStatus(tool, tools).status !== "configured") return [];
    return [{ toolId: tool.id, toolName: tool.name, state, since, renewsAt, configHref: quotaConfigHref(tool, reader), billingUrl: tool.billingUrl }];
  });
}
