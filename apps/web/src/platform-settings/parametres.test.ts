import { toolById, type Tool } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { ProviderSecretStatus } from "../provider-secrets/index";
import { legacyRedirect, PARAMETRES_TABS, parametresHref, parametresTab, possibleProviders, providerSheetHref, settingHref, type ProvidersState } from "./parametres";
import { snapshotOfSettings, type StoredPlatformSettings } from "./resolver";

const tool = (id: string): Tool => toolById(id)!;

/** What a tab's providers are read from: `env` (Provider Secrets over it), what the Back Office set, the keys as Clés lists them (null: not shown). */
const stateOf = (env: Record<string, string> = {}, options: { stored?: StoredPlatformSettings; secrets?: ProviderSecretStatus[] | null } = {}): ProvidersState => ({
  env,
  signInTypes: [],
  settings: snapshotOfSettings(env, options.stored ?? {}),
  secrets: options.secrets === undefined ? null : options.secrets,
});
const BY_CLAIRE = { updatedBy: "claire@jobbbox.fr", updatedAt: new Date("2026-10-20T10:00:00Z") };
const secret = (name: string, provider: string, status: Partial<ProviderSecretStatus>): ProviderSecretStatus =>
  ({ name, provider, source: "missing", fingerprint: null, keyVersion: null, updatedBy: null, updatedAt: null, lastTest: null, ...status }) as ProviderSecretStatus;
const tab = (slug: string) => parametresTab(slug);

describe("Paramètres in tabs (#396, ADR-0042)", () => {
  it("has one tab per kind of Tool, then Extension and, last, Environnement", () => {
    expect(PARAMETRES_TABS.map((tab) => tab.slug)).toEqual(["recherche-web", "ia", "sources", "enrichissement", "e-mail", "paiement", "connexion", "extension", "environnement"]);
  });

  it("reads the tab from the address, the first one when it names none or an unknown one", () => {
    expect(parametresTab("sources").id).toBe("sources");
    expect(parametresTab("connexion").id).toBe("sign_in");
    expect(parametresTab(undefined).id).toBe("web_search");
    expect(parametresTab("cles").id).toBe("web_search");
  });

  it("says a tab's address, with its query and an anchor", () => {
    expect(parametresHref("web_search")).toBe("/admin/parametres?tab=recherche-web");
    expect(parametresHref("sign_in", { tested: "jobbbox-sso", empty: undefined })).toBe("/admin/parametres?tab=connexion&tested=jobbbox-sso");
    expect(parametresHref("sources", {}, "setting-JOB_DIGEST_TARGET_COUNT")).toBe("/admin/parametres?tab=sources#setting-JOB_DIGEST_TARGET_COUNT");
  });

  it("links a setting to the tab that shows it, Environnement for one only env holds", () => {
    expect(settingHref("AI_WEB_SEARCH_PROVIDER")).toBe("/admin/parametres?tab=recherche-web#setting-AI_WEB_SEARCH_PROVIDER");
    expect(settingHref("AI_IDENTITY_MODEL")).toBe("/admin/parametres?tab=ia#setting-AI_IDENTITY_MODEL");
    expect(settingHref("JOB_DISCOVERY_BUDGET_EUR")).toBe("/admin/parametres?tab=sources#setting-JOB_DISCOVERY_BUDGET_EUR");
    expect(settingHref("CONTACT_ENRICHMENT_DPA_SIGNED")).toBe("/admin/parametres?tab=enrichissement#setting-CONTACT_ENRICHMENT_DPA_SIGNED");
    expect(settingHref("MAIL_FROM")).toBe("/admin/parametres?tab=e-mail#setting-MAIL_FROM");
    expect(settingHref("EXTENSION_STORE_URL")).toBe("/admin/parametres?tab=extension#setting-EXTENSION_STORE_URL");
    expect(settingHref("DATABASE_URL")).toBe("/admin/parametres?tab=environnement#setting-DATABASE_URL");
  });

  it("opens a Tool's sheet on the tab of its kind; none for a Tool no tab holds", () => {
    expect(providerSheetHref(tool("brave"))).toBe("/admin/parametres?tab=recherche-web&fournisseur=brave");
    expect(providerSheetHref(tool("mistral"))).toBe("/admin/parametres?tab=ia&fournisseur=mistral");
    expect(providerSheetHref(tool("france-travail"))).toBe("/admin/parametres?tab=sources&fournisseur=france-travail");
    expect(providerSheetHref(tool("stripe"))).toBe("/admin/parametres?tab=paiement&fournisseur=stripe");
    expect(providerSheetHref(tool("brevo-smtp"))).toBe("/admin/parametres?tab=e-mail&fournisseur=brevo-smtp");
    expect(providerSheetHref(tool("geo-api-gouv"))).toBeUndefined();
  });

  describe("the old addresses", () => {
    it("Clés goes to the sheet of the Tool a key is for, else the first tab", () => {
      expect(legacyRedirect("cles", { key: "MISTRAL_API_KEY" })).toBe("/admin/parametres?tab=ia&fournisseur=mistral");
      expect(legacyRedirect("cles", { key: "FANTASTIC_JOBS_API_KEY" })).toBe("/admin/parametres?tab=sources&fournisseur=fantastic-jobs");
      expect(legacyRedirect("cles", { key: "STRIPE_WEBHOOK_SECRET" })).toBe("/admin/parametres?tab=paiement&fournisseur=stripe");
      expect(legacyRedirect("cles", { key: "NOT_A_KEY" })).toBe("/admin/parametres?tab=recherche-web");
      expect(legacyRedirect("cles", {})).toBe("/admin/parametres?tab=recherche-web");
    });

    it("Connexion goes to its tab, keeping what a test sign-in came back with", () => {
      expect(legacyRedirect("connexion", {})).toBe("/admin/parametres?tab=connexion");
      expect(legacyRedirect("connexion", { testFailed: "okta", error: "access_denied", other: ["a", "b"] })).toBe("/admin/parametres?tab=connexion&testFailed=okta&error=access_denied");
    });

    it("Sites de recherche goes to Sources", () => {
      expect(legacyRedirect("sites", { notice: "saved" })).toBe("/admin/parametres?tab=sources");
    });
  });

  describe("« Fournisseurs possibles »", () => {
    it("lists every web search Tool, the active one marked, the others ready to be made active, a missing key named", () => {
      const rows = possibleProviders(tab("recherche-web"), stateOf({ PERPLEXITY_API_KEY: "pplx-0123456789abcdef" }));
      expect(rows.map((row) => row.tool.id)).toEqual(["perplexity", "brave", "tavily", "linkup"]);
      expect(rows[0]).toMatchObject({ active: true, selectable: false, status: "configured", usedBy: ["web_search"] });
      expect(rows[1]).toMatchObject({ active: false, selectable: true, status: "key_missing", usedBy: [], keys: [{ name: "BRAVE_SEARCH_API_KEY", set: false }] });
    });

    it("follows the active provider the Back Office set, over env's and the code's default", () => {
      const rows = possibleProviders(tab("recherche-web"), stateOf({ AI_WEB_SEARCH_PROVIDER: "perplexity", TAVILY_API_KEY: "tvly-key" }, { stored: { AI_WEB_SEARCH_PROVIDER: { value: "tavily", ...BY_CLAIRE } } }));
      expect(rows.filter((row) => row.active).map((row) => row.tool.id)).toEqual(["tavily"]);
      expect(rows.find((row) => row.tool.id === "tavily")).toMatchObject({ usedBy: ["web_search"], selectable: false });
      expect(rows.find((row) => row.tool.id === "perplexity")).toMatchObject({ usedBy: [], selectable: true });
    });

    it("shows a key's source, last 4 characters and last connection test to who reads the Provider Secrets, only whether it is set to others", () => {
      const tested = { at: new Date("2026-10-21T08:00:00Z"), passed: false };
      const secrets = [secret("PERPLEXITY_API_KEY", "perplexity", { source: "database", fingerprint: "cdef", ...BY_CLAIRE, lastTest: tested })];
      const env = { PERPLEXITY_API_KEY: "pplx-0123456789abcdef" };
      expect(possibleProviders(tab("recherche-web"), stateOf(env, { secrets }))[0]!.keys).toEqual([
        { name: "PERPLEXITY_API_KEY", secret: true, set: true, source: "database", fingerprint: "cdef", lastTest: tested },
      ]);
      expect(possibleProviders(tab("recherche-web"), stateOf(env))[0]!.keys).toEqual([{ name: "PERPLEXITY_API_KEY", secret: true, set: true }]);
      // A key outside the Provider Secrets (Brave's, until #399): only whether env sets it.
      expect(possibleProviders(tab("recherche-web"), stateOf(env, { secrets }))[1]!.keys).toEqual([{ name: "BRAVE_SEARCH_API_KEY", secret: false, set: false }]);
    });

    it("says which AI tasks each AI model serves, the identity route Mistral's; none is « made active » on IA", () => {
      const rows = possibleProviders(tab("ia"), stateOf({ AI_SCORING_PROVIDER: "mistral", AI_COACHING_PROVIDER: "mistral", MISTRAL_API_KEY: "key", ANTHROPIC_ENDPOINT: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "token" }));
      const mistral = rows.find((row) => row.tool.id === "mistral")!;
      expect(mistral.usedBy).toEqual(expect.arrayContaining(["scoring", "coaching", "back_office_assistant", "guardrail", "eval", "identity"]));
      expect(mistral.usedBy).not.toContain("writing");
      expect(rows.find((row) => row.tool.id === "anthropic-bedrock")!.usedBy).toEqual(expect.arrayContaining(["writing", "offer_analysis", "job_titles"]));
      expect(rows.some((row) => row.active || row.selectable)).toBe(false);
    });

    it("marks the contact-enrichment provider chosen as active, used by Enriched Contacts once its DPA is signed", () => {
      const signed = { CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "key", CONTACT_ENRICHMENT_DPA_SIGNED: "true" };
      const rows = possibleProviders(tab("enrichissement"), stateOf(signed));
      expect(rows.find((row) => row.tool.id === "apollo")).toMatchObject({ active: true, usedBy: ["enriched_contacts"], status: "configured" });
      expect(rows.find((row) => row.tool.id === "lusha")).toMatchObject({ active: false, selectable: true, usedBy: [] });
      const unsigned = possibleProviders(tab("enrichissement"), stateOf({ ...signed, CONTACT_ENRICHMENT_DPA_SIGNED: "false" }));
      expect(unsigned.find((row) => row.tool.id === "apollo")).toMatchObject({ active: true, usedBy: [], status: "disabled" });
    });

    it("says what each other Tool serves while it can be called", () => {
      expect(possibleProviders(tab("paiement"), stateOf({ STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "whsec" }))[0]).toMatchObject({ usedBy: ["billing"] });
      expect(possibleProviders(tab("paiement"), stateOf())[0]).toMatchObject({ usedBy: [], status: "key_missing" });
      expect(possibleProviders(tab("sources"), stateOf()).find((row) => row.tool.id === "greenhouse")).toMatchObject({ usedBy: ["job_discovery"] });
    });

    it("lists nothing on the tabs with no kind of Tool", () => {
      expect(possibleProviders(tab("extension"), stateOf())).toEqual([]);
      expect(possibleProviders(tab("environnement"), stateOf())).toEqual([]);
    });
  });
});
