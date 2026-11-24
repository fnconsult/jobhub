/**
 * The Dashboard's « API » block (#1116, decisions #1111): every Administrator, whatever their roles, sees the Tool quota
 * state of each Tool with a quota that is configured, « OK » included. One row per such Tool, in the catalog's order: its
 * name, its state (« OK », « limite atteinte », « quota épuisé »), since when, when its provider said the quota renews,
 * and the « Quota atteint » banner's two links: where it is configured, its provider's billing page.
 *
 *   apiBlockRows(await createToolQuotas(database).states(), await currentState(), access)
 *
 * A Tool off or without its key (its Outils status other than « configuré ») is left out: it makes no call, so its state
 * says nothing. Where a Tool is configured: its sheet in Paramètres when its key is a Provider Secret entered there, its
 * Outils page otherwise. A reader who may open neither gets no configuration link, never one to a 404.
 */
import { toolById, toolKeys, type Tool, type ToolId } from "@jobhub/shared";
import type { BackOfficeAccess } from "../admin/access";
import { providerSheetHref } from "../platform-settings/parametres";
import { isProviderSecretName } from "../provider-secrets/catalog";
import { routes } from "../routes";
import type { ToolQuotaState, ToolQuotaStatus } from "../tool-quotas/index";
import { toolStatus, type ToolsState } from "../tools/index";

/** A configured Tool with a quota, as a row of the « API » block says it. */
export interface ApiBlockRow {
  toolId: ToolId;
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

/** Where `reader` configures `tool`: its sheet in Paramètres when its key is entered there, else its Outils page. */
function configHrefOf(tool: Tool, reader: Pick<BackOfficeAccess, "can">): string | null {
  const sheet = toolKeys(tool).some(isProviderSecretName) ? providerSheetHref(tool) : undefined;
  if (sheet && reader.can("platformSettings", "read")) return sheet;
  return reader.can("tools", "read") ? routes.adminTool(tool.id) : null;
}

/** The block's rows: one per Tool of `states` that `tools` says is configured, in their order. */
export function apiBlockRows(states: readonly ToolQuotaState[], tools: ToolsState, reader: Pick<BackOfficeAccess, "can">): ApiBlockRow[] {
  return states.flatMap(({ toolId, state, since, renewsAt }) => {
    const tool = toolById(toolId);
    if (!tool?.billingUrl || toolStatus(tool, tools).status !== "configured") return [];
    return [{ toolId, toolName: tool.name, state, since, renewsAt, configHref: configHrefOf(tool, reader), billingUrl: tool.billingUrl }];
  });
}
