import { toolById, type Tool } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { legacyRedirect, PARAMETRES_TABS, parametresHref, parametresTab, providerSheetHref, settingHref } from "./parametres";

const tool = (id: string): Tool => toolById(id)!;

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
});
