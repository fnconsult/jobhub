import { QUOTA_TOOL_IDS, type ToolId } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { backOfficeAccess, BACK_OFFICE_ROLES } from "../admin/access";
import { snapshotOfSettings } from "../platform-settings/resolver";
import type { ToolQuotaState } from "../tool-quotas/index";
import type { ToolsState } from "../tools/index";
import { apiBlockRows } from "./api-block";

const SINCE = new Date("2026-11-24T09:00:00Z");
const RENEWS = new Date("2026-12-01T00:00:00Z");

/** Every Tool with a quota ok, but those of `refused`. */
const statesWith = (refused: Partial<Record<ToolId, ToolQuotaState["state"]>> = {}, renewsAt: Date | null = null): ToolQuotaState[] =>
  QUOTA_TOOL_IDS.map((toolId) => {
    const state = refused[toolId];
    return state ? { toolId, state, since: SINCE, renewsAt } : { toolId, state: "ok", since: null, renewsAt: null };
  });

/** The Tools' status read from `env`, nothing set in the Back Office. */
const toolsWith = (env: Record<string, string>): ToolsState => ({ env, signInTypes: [], settings: snapshotOfSettings(env, {}) });

/** Mistral and Perplexity keyed, every other Tool with a quota without its key. */
const MISTRAL_AND_PERPLEXITY = toolsWith({ MISTRAL_API_KEY: "key", PERPLEXITY_API_KEY: "key" });
const superAdmin = backOfficeAccess(["super-admin"]);

describe("the Dashboard's « API » block (#1116)", () => {
  it("lists each configured Tool with a quota, in the catalog's order, « OK » while its provider accepts its calls", () => {
    expect(apiBlockRows(statesWith(), MISTRAL_AND_PERPLEXITY, superAdmin)).toEqual([
      {
        toolId: "mistral",
        toolName: "Mistral AI",
        state: "ok",
        since: null,
        renewsAt: null,
        configHref: "/admin/parametres?tab=ia&fournisseur=mistral",
        billingUrl: "https://console.mistral.ai/billing",
      },
      {
        toolId: "perplexity",
        toolName: "Perplexity",
        state: "ok",
        since: null,
        renewsAt: null,
        configHref: "/admin/parametres?tab=recherche-web&fournisseur=perplexity",
        billingUrl: "https://www.perplexity.ai/account/api/billing",
      },
    ]);
  });

  it("says a Tool's « quota épuisé » or « limite atteinte », since when and, when its provider gave it, when it renews", () => {
    const rows = apiBlockRows(statesWith({ mistral: "quota_exhausted", perplexity: "rate_limited" }, RENEWS), MISTRAL_AND_PERPLEXITY, superAdmin);

    expect(rows.map(({ toolId, state, since, renewsAt }) => ({ toolId, state, since, renewsAt }))).toEqual([
      { toolId: "mistral", state: "quota_exhausted", since: SINCE, renewsAt: RENEWS },
      { toolId: "perplexity", state: "rate_limited", since: SINCE, renewsAt: RENEWS },
    ]);
  });

  it("leaves out a Tool that is off or without its key, even refused for its quota before", () => {
    const rows = apiBlockRows(statesWith({ tavily: "quota_exhausted", "anthropic-vertex": "rate_limited" }), MISTRAL_AND_PERPLEXITY, superAdmin);

    expect(rows.map((row) => row.toolId)).toEqual(["mistral", "perplexity"]);
    // Apollo keyed but not the contact enrichment provider chosen: off (« désactivé »).
    const apolloOff = toolsWith({ APOLLO_API_KEY: "key" });
    expect(apiBlockRows(statesWith({ apollo: "quota_exhausted" }), apolloOff, superAdmin)).toEqual([]);
  });

  it("is empty when no Tool with a quota is configured", () => {
    expect(apiBlockRows(statesWith({ mistral: "quota_exhausted" }), toolsWith({}), superAdmin)).toEqual([]);
  });

  it("leads to the Tool's sheet in Paramètres where its key is entered there, to its Outils page otherwise", () => {
    const apollo = { APOLLO_API_KEY: "key", CONTACT_ENRICHMENT_PROVIDER: "apollo", CONTACT_ENRICHMENT_DPA_SIGNED: "true" };
    const rows = apiBlockRows(statesWith(), toolsWith({ OPENAI_API_KEY: "key", ...apollo }), superAdmin);

    expect(Object.fromEntries(rows.map((row) => [row.toolId, row.configHref]))).toEqual({
      // OpenAI's key stays in env: its Outils page says what it needs.
      openai: "/admin/outils/openai",
      apollo: "/admin/parametres?tab=enrichissement&fournisseur=apollo",
    });
  });

  it("is the same list for every Back Office Role, each leading only where the reader may go", () => {
    const configOf = (role: (typeof BACK_OFFICE_ROLES)[number]) => apiBlockRows(statesWith({ mistral: "quota_exhausted" }), MISTRAL_AND_PERPLEXITY, backOfficeAccess([role]));

    for (const role of BACK_OFFICE_ROLES) expect(configOf(role).map((row) => [row.toolId, row.state, row.billingUrl]), role).toEqual([
      ["mistral", "quota_exhausted", "https://console.mistral.ai/billing"],
      ["perplexity", "ok", "https://www.perplexity.ai/account/api/billing"],
    ]);
    expect(configOf("support")[0]!.configHref).toBe("/admin/parametres?tab=ia&fournisseur=mistral");
    // Neither Paramètres nor Outils: the billing page alone.
    expect(configOf("plans-manager")[0]!.configHref).toBeNull();
  });
});
