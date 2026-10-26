"use server";

/**
 * What Paramètres changes (#396): Platform Settings (« Rendre actif » among them), Provider Secrets from a provider's
 * sheet, Job discovery sources and sites, Job Sites, and Sign-in Providers. Each checks the Administrator's Back Office
 * Roles for its own resource, as the sections it replaces did, and comes back to the tab (and sheet) it was sent from,
 * saying how it went: by key name, setting name and code only, never a value.
 */
import { toolById } from "@jobhub/shared";
import { redirect } from "next/navigation";
import { getPlatformSettingsBackOffice, getSearchSitesBackOffice, requireBackOffice } from "@/admin/server";
import { applyLatestSignIn } from "@/auth/server";
import { parametresHref, parametresTab, providerSheetHref, type ParametresTabId } from "@/platform-settings/parametres";
import { isProviderSecretName } from "@/provider-secrets/catalog";
import { getProviderSecrets, getSecretResolver } from "@/provider-secrets/server";
import { getSignInProviders } from "@/sign-in-providers/server";
import { CONFIRMED, FORM, type PlatformSettingNotice, type SitesNotice } from "./notices";

/** The longest technical detail of a refusal carried back to the page; the Journal keeps it whole. */
const DETAIL_MAX_LENGTH = 300;

/** The tab, and the provider's sheet, a form was sent from. */
function hereOf(form: FormData): { tab: ParametresTabId; fournisseur?: string } {
  const tab = parametresTab(String(form.get(FORM.tab) ?? "")).id;
  const sheet = String(form.get(FORM.sheet) ?? "");
  return { tab, ...(toolById(sheet) ? { fournisseur: sheet } : {}) };
}

/** Back to where `form` was sent from, with `query`. */
function back(form: FormData, query: Record<string, string | undefined>, hash?: string): never {
  const { tab, fournisseur } = hereOf(form);
  redirect(parametresHref(tab, { fournisseur, ...query }, hash));
}

const text = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

// ---- Platform Settings (#299 to #303) ----

/** Back at the setting's row, saying how it went; a refused change with its Failure Reason and technical detail (#301). */
const settingBack = (form: FormData, notice: PlatformSettingNotice, name: string, refusal?: { reason: string; technical: { message: string } }): never =>
  back(form, { notice, setting: name, ...(refusal ? { reason: refusal.reason, detail: refusal.technical.message.slice(0, DETAIL_MAX_LENGTH) } : {}) }, `setting-${name}`);

/**
 * A super-admin saves a value, parsed as env's is; a value the setting refuses is recorded in the Journal (#299).
 * « Rendre actif » saves the tab's active provider this way. The DPA marked signed is asked to be confirmed first (#302).
 */
export async function saveSetting(form: FormData) {
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const done = await getPlatformSettingsBackOffice().set(administrator, name, String(form.get("value") ?? ""), { confirmed: form.get(FORM.confirmed) === CONFIRMED });
  if (!done.ok && done.error === "refused") settingBack(form, "refused", name, done);
  settingBack(form, done.ok ? (done.changed ? "saved" : "unchanged") : (done.error as Exclude<typeof done.error, "refused">), name);
}

/** « Rétablir »: the Back Office's value is cleared, env's is used, else the code's default (#299); env's DPA marked signed is confirmed first (#302). */
export async function restoreSetting(form: FormData) {
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const done = await getPlatformSettingsBackOffice().restore(administrator, name, { confirmed: form.get(FORM.confirmed) === CONFIRMED });
  if (!done.ok && done.error === "refused") settingBack(form, "refused", name, done);
  settingBack(form, done.ok ? (done.changed ? "restored" : "notRestored") : done.error === "unconfirmed" ? "restoreUnconfirmed" : (done.error as Exclude<typeof done.error, "refused" | "unconfirmed">), name);
}

// ---- Provider Secrets, on a provider's sheet (ADR-0020, super-admins only) ----

/** « + Ajouter » a provider: its sheet, where its key is entered. */
export async function openProviderSheet(form: FormData) {
  await requireBackOffice("providerSecrets", "write");
  const tool = toolById(String(form.get("provider") ?? ""));
  const sheet = tool ? providerSheetHref(tool) : undefined;
  if (sheet) redirect(sheet);
  back(form, {});
}

/** The HTTP status a failed connection test quotes, if any: the only part of its detail the page shows. */
const statusIn = (detail: string): string | undefined => /\bHTTP (\d{3})\b/.exec(detail)?.[1];

export async function replaceSecret(form: FormData) {
  const { administrator } = await requireBackOffice("providerSecrets", "write");
  const name = form.get("name");
  const replaced = await getProviderSecrets().replace(administrator, name, form.get("value"), { saveAnyway: form.get("saveAnyway") === "on" });
  if (!replaced.ok) back(form, { error: replaced.error, key: String(name), status: replaced.error === "test_failed" ? statusIn(replaced.detail) : undefined });
  // This process uses it at once; the others hear the NOTIFY.
  await getSecretResolver().refresh();
  back(form, { saved: String(name), test: replaced.test });
}

export async function clearSecret(form: FormData) {
  const { administrator } = await requireBackOffice("providerSecrets", "write");
  const name = form.get("name");
  const cleared = await getProviderSecrets().clear(administrator, name);
  if (!cleared.ok) back(form, { error: cleared.error });
  await getSecretResolver().refresh();
  back(form, { cleared: String(name) });
}

export async function testSecret(form: FormData) {
  const { administrator } = await requireBackOffice("providerSecrets", "write");
  const name = form.get("name");
  if (!isProviderSecretName(name)) back(form, { error: "unknown_secret" });
  const tested = await getProviderSecrets().test(administrator, name);
  back(form, { tested: name, result: tested.ok ? "passed" : "failed", status: tested.ok ? undefined : statusIn(tested.detail) });
}

// ---- Job discovery sources and sites, Job Sites (the former Sites de recherche) ----

const sitesBack = (form: FormData, notice: SitesNotice): never => back(form, { sites: notice });
const enabledIn = (form: FormData) => form.get("enabled") === "true";

export async function setJobDiscoverySource(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const known = await getSearchSitesBackOffice().setJobDiscoverySourceEnabled(administrator, String(form.get("source")), enabledIn(form));
  sitesBack(form, known ? "saved" : "notFound");
}

export async function addJobDiscoverySite(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const added = await getSearchSitesBackOffice().addJobDiscoverySite(administrator, form.get("domain"));
  if (added.ok) sitesBack(form, "siteAdded");
  sitesBack(form, !added.ok && added.error === "forbidden" ? "siteForbidden" : !added.ok && added.error === "exists" ? "siteExists" : "siteInvalid");
}

export async function setJobDiscoverySite(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const result = await getSearchSitesBackOffice().setJobDiscoverySiteEnabled(administrator, String(form.get("domain")), enabledIn(form));
  sitesBack(form, result.ok ? "saved" : result.error === "forbidden" ? "siteForbidden" : "notFound");
}

export async function removeJobDiscoverySite(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  sitesBack(form, (await getSearchSitesBackOffice().removeJobDiscoverySite(administrator, String(form.get("domain")))) ? "siteRemoved" : "notFound");
}

export async function addJobSite(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const added = await getSearchSitesBackOffice().addJobSite(administrator, { pattern: form.get("pattern"), postingPages: form.get("postingPages") });
  if (added.ok) sitesBack(form, "jobSiteAdded");
  sitesBack(form, !added.ok && added.error === "exists" ? "jobSiteExists" : "jobSiteInvalid");
}

export async function setJobSite(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  sitesBack(form, (await getSearchSitesBackOffice().setJobSiteEnabled(administrator, String(form.get("pattern")), enabledIn(form))) ? "saved" : "notFound");
}

export async function removeJobSite(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const removed = await getSearchSitesBackOffice().removeJobSite(administrator, String(form.get("pattern")));
  sitesBack(form, removed.ok ? "jobSiteRemoved" : removed.error === "built_in" ? "jobSiteBuiltIn" : "notFound");
}

// ---- Sign-in Providers (the former Connexion) ----

/** The provider form's switches: the form fields saveProvider reads. */
const SWITCHES = { shownToCandidates: "shownToCandidates", allowedForAdministrators: "allowedForAdministrators", trustedForLinking: "trustedForLinking", enabled: "enabled" } as const;

export async function saveProvider(form: FormData) {
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const saved = await getSignInProviders().save(administrator, {
    type: text(form, "type"),
    id: text(form, "id"),
    displayName: text(form, "displayName"),
    clientId: text(form, "clientId"),
    discoveryUrl: text(form, "discoveryUrl"),
    tenantId: text(form, "tenantId"),
    appBundleIdentifier: text(form, "appBundleIdentifier"),
    enabled: form.get(SWITCHES.enabled) === "on",
    shownToCandidates: form.get(SWITCHES.shownToCandidates) === "on",
    allowedForAdministrators: form.get(SWITCHES.allowedForAdministrators) === "on",
    trustedForLinking: form.get(SWITCHES.trustedForLinking) === "on",
    secrets: { clientSecret: text(form, "clientSecret"), teamId: text(form, "teamId"), keyId: text(form, "keyId"), privateKey: text(form, "privateKey") },
  });
  if (!saved.ok) back(form, { error: saved.error, form: text(form, "formKey") });
  // This process uses it at once; the others hear the NOTIFY.
  await applyLatestSignIn();
  back(form, { saved: saved.id });
}

export async function removeProvider(form: FormData) {
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const removed = await getSignInProviders().remove(administrator, form.get("id"));
  if (!removed.ok) back(form, { error: removed.error });
  await applyLatestSignIn();
  back(form, { removed: "1" });
}

export async function setRequireSso(form: FormData) {
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  await getSignInProviders().setRequireSsoForAdministrators(administrator, form.get("requireSso") === "on");
  await applyLatestSignIn();
  back(form, { sso: "saved" });
}

/**
 * Starts a test sign-in through a provider not enabled: registers it for a few minutes and
 * returns the nonce its callback must bring back, so only this super-admin's sign-in can pass it.
 */
export async function startTestSignIn(providerId: string): Promise<{ nonce: string } | { error: string }> {
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const started = await getSignInProviders().startTestSignIn(administrator, providerId);
  if (!started.ok) return { error: started.error };
  await applyLatestSignIn();
  return { nonce: started.nonce };
}
