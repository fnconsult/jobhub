import { hasQuota, TOOLS, type Tool, type ToolId } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { backOfficeAccess, BACK_OFFICE_ROLES, type BackOfficeRole } from "../admin/access";
import { snapshotOfSettings } from "../platform-settings/resolver";
import type { ToolQuotaState } from "../tool-quotas/index";
import { quotaBannerLines as linesIn, quotaBannerShown } from "./index";

const SINCE = new Date("2026-11-24T09:00:00Z");

/** Every Tool with a quota ok, but those of `refused`. */
const statesWith = (refused: Partial<Record<ToolId, ToolQuotaState["state"]>>): ToolQuotaState[] =>
  (TOOLS as readonly Tool[]).filter(hasQuota).map((tool) => {
    const state = refused[tool.id as ToolId];
    return state ? { tool, state, since: SINCE, renewsAt: null } : { tool, state: "ok", since: null, renewsAt: null };
  });

const superAdmin = backOfficeAccess(["super-admin"]);

/** Nothing set in env nor in the Back Office: the catalog's billing pages. */
const DEFAULTS = snapshotOfSettings({}, {});
const quotaBannerLines = (states: readonly ToolQuotaState[], reader: Parameters<typeof linesIn>[1]) => linesIn(states, reader, DEFAULTS);
const setBy = { updatedBy: "ops@jobbbox.ai", updatedAt: new Date("2026-11-25T08:00:00Z") };

describe("the « Quota atteint » banner's lines (#1115)", () => {
  it("are none while every Tool is ok", () => {
    expect(quotaBannerLines(statesWith({}), superAdmin)).toEqual([]);
  });

  it("are one per Tool refused for its quota, in the catalog's order: its name, its state, since when, and its provider's billing page", () => {
    expect(quotaBannerLines(statesWith({ tavily: "rate_limited", mistral: "quota_exhausted" }), superAdmin)).toEqual([
      {
        toolId: "mistral",
        toolName: "Mistral AI",
        state: "quota_exhausted",
        since: SINCE,
        configHref: "/admin/parametres?tab=ia&fournisseur=mistral",
        billingUrl: "https://console.mistral.ai/billing",
      },
      {
        toolId: "tavily",
        toolName: "Tavily",
        state: "rate_limited",
        since: SINCE,
        configHref: "/admin/parametres?tab=recherche-web&fournisseur=tavily",
        billingUrl: "https://app.tavily.com/billing",
      },
    ]);
  });

  it("lead to the Tool's sheet in Paramètres where its key is entered there, to its Outils page otherwise", () => {
    const lines = quotaBannerLines(statesWith({ lusha: "quota_exhausted", "fantastic-jobs": "quota_exhausted", openai: "quota_exhausted", "anthropic-vertex": "rate_limited" }), superAdmin);

    expect(Object.fromEntries(lines.map((line) => [line.toolId, line.configHref]))).toEqual({
      lusha: "/admin/parametres?tab=enrichissement&fournisseur=lusha",
      "fantastic-jobs": "/admin/parametres?tab=sources&fournisseur=fantastic-jobs",
      // OpenAI's key and Vertex's credentials stay in env: their Outils page says what they need.
      openai: "/admin/outils/openai",
      "anthropic-vertex": "/admin/outils/anthropic-vertex",
    });
  });

  it("are shown to every Back Office Role, each leading only where the reader may go", () => {
    const refused = statesWith({ mistral: "quota_exhausted" });
    const configOf = (role: BackOfficeRole) => quotaBannerLines(refused, backOfficeAccess([role]))[0]?.configHref;

    expect(Object.fromEntries(BACK_OFFICE_ROLES.map((role) => [role, configOf(role)]))).toEqual({
      "super-admin": "/admin/parametres?tab=ia&fournisseur=mistral",
      "platform-manager": "/admin/parametres?tab=ia&fournisseur=mistral",
      support: "/admin/parametres?tab=ia&fournisseur=mistral",
      // Neither Paramètres nor Outils: the billing page alone.
      "plans-manager": null,
      "coach-manager": null,
      "playbook-editor": null,
      "help-editor": null,
    });
    for (const role of BACK_OFFICE_ROLES) expect(quotaBannerLines(refused, backOfficeAccess([role])), role).toHaveLength(1);
  });
});

describe("the « Quota atteint » banner's billing links (#1123)", () => {
  const refused = statesWith({ perplexity: "quota_exhausted", mistral: "quota_exhausted" });
  const billingOf = (settings: Parameters<typeof linesIn>[2]) => Object.fromEntries(linesIn(refused, superAdmin, settings).map((line) => [line.toolId, line.billingUrl]));

  it("follow the page a super-admin set on the Tool's sheet, over env's", () => {
    const project = "https://console.perplexity.ai/project/abc123/billing";
    const settings = snapshotOfSettings({ PERPLEXITY_BILLING_URL: "https://example.test/env" }, { PERPLEXITY_BILLING_URL: { value: project, ...setBy } });

    expect(billingOf(settings)).toEqual({ mistral: "https://console.mistral.ai/billing", perplexity: project });
    expect(billingOf(snapshotOfSettings({ MISTRAL_BILLING_URL: " https://admin.mistral.ai/organization/billing " }, {})).mistral).toBe("https://admin.mistral.ai/organization/billing");
  });

  it("go back to the catalog's page once cleared, and when env's is not an https URL", () => {
    expect(billingOf(DEFAULTS)).toEqual({ mistral: "https://console.mistral.ai/billing", perplexity: "https://console.perplexity.ai/project/billing" });
    expect(billingOf(snapshotOfSettings({ PERPLEXITY_BILLING_URL: "" }, {})).perplexity).toBe("https://console.perplexity.ai/project/billing");
    for (const refusedValue of ["http://console.perplexity.ai/project/billing", "javascript:alert(1)", "console.perplexity.ai"]) {
      expect(billingOf(snapshotOfSettings({ PERPLEXITY_BILLING_URL: refusedValue }, {})).perplexity, refusedValue).toBe("https://console.perplexity.ai/project/billing");
    }
  });
});

describe("where the « Quota atteint » banner is shown (#1115)", () => {
  it("everywhere, but on the e2e suite's shared server when it asks for none: there, other specs' refused calls would put it beside their pages' own status", () => {
    expect(quotaBannerShown({})).toBe(true);
    expect(quotaBannerShown({ JOBHUB_TARGET: "production" })).toBe(true);
    expect(quotaBannerShown({ JOBHUB_TARGET: "e2e" })).toBe(true);
    expect(quotaBannerShown({ JOBHUB_TARGET: "e2e", E2E_QUOTA_BANNER_OFF: "1" })).toBe(false);
    // Never anywhere but the e2e suite.
    expect(quotaBannerShown({ JOBHUB_TARGET: "production", E2E_QUOTA_BANNER_OFF: "1" })).toBe(true);
  });
});
