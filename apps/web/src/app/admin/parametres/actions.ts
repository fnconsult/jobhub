"use server";

/**
 * What Paramètres changes (#396): Platform Settings (« Rendre actif » among them), Provider Secrets from a provider's
 * sheet, Job discovery sources and sites, Job Sites, and Sign-in Providers. Each checks the Administrator's Back Office
 * Roles for its own resource, as the sections it replaces did, and comes back to the tab (and sheet) it was sent from,
 * saying how it went: by key name, setting name and code only, never a value.
 */
import { parisDay, privacyPolicyCoverage } from "@jobhub/help";
import { toolById } from "@jobhub/shared";
import { redirect } from "next/navigation";
import type { TextTask } from "@jobhub/ai";
import type { BackOfficeActor } from "@/admin/back-office";
import type { PlatformSettingValueChange } from "@/admin/platform-settings-back-office";
import { getBackOffice, getCoachingPlaybooksBackOffice, getPlatformSettingsBackOffice, getRecognisedSendersBackOffice, getSearchSitesBackOffice, requireBackOffice } from "@/admin/server";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { aiTaskRoutes, playbookAgentChange, routeChange, TEXT_TASK_IDS } from "@/platform-settings/ai-tasks";
import { switchingOn } from "@/tools/recipients";
import { currentState } from "@/tools/server";
import { applyLatestSignIn } from "@/auth/server";
import { parametresHref, parametresTab, providerSheetHref, type ParametresTabId } from "@/platform-settings/parametres";
import { isProviderSecretName } from "@/provider-secrets/catalog";
import { getProviderSecrets, getSecretResolver } from "@/provider-secrets/server";
import { getSignInProviders } from "@/sign-in-providers/server";
import { AI_FORM, CONFIRMED, FORM, SENDER_NOTICE_PARAM, SIGN_IN_SWITCHES, UNCOVERED_PARAM, type PlaybookAgentNotice, type PlatformSettingNotice, type RouteNotice, type SenderNotice, type SitesNotice } from "./notices";

const isTextTask = (value: string): value is TextTask => (TEXT_TASK_IDS as readonly string[]).includes(value);

/** The longest technical detail of a refusal carried back to the page; the Journal keeps it whole. */
const DETAIL_MAX_LENGTH = 300;

/** The tab, and the provider's sheet or the AI task's or Playbook Agent's side panel, a form was sent from. */
function hereOf(form: FormData): { tab: ParametresTabId; fournisseur?: string; [AI_FORM.task]?: string; [AI_FORM.playbook]?: string } {
  const tab = parametresTab(String(form.get(FORM.tab) ?? "")).id;
  const sheet = String(form.get(FORM.sheet) ?? "");
  const task = String(form.get(AI_FORM.task) ?? "");
  const playbook = String(form.get(AI_FORM.playbook) ?? "");
  return {
    tab,
    ...(toolById(sheet) ? { fournisseur: sheet } : {}),
    ...(isTextTask(task) ? { [AI_FORM.task]: task } : {}),
    ...(/^[a-z0-9-]{1,80}$/.test(playbook) ? { [AI_FORM.playbook]: playbook } : {}),
  };
}

/** Back to where `form` was sent from, with `query`. */
function back(form: FormData, query: Record<string, string | undefined>, hash?: string): never {
  const { tab, ...here } = hereOf(form);
  redirect(parametresHref(tab, { ...here, ...query }, hash));
}

const text = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

// ---- Recipients outside the EU (#548, ADR-0064) ----

/** What the page a change comes back to is told of the recipients outside the EU it switched on uncovered: none, or their ids. */
type RecipientsWarning = Record<string, string>;

/**
 * Runs a Paramètres `change` and gives back its result: never blocked, each recipient outside the EU it switched on that
 * the privacy policy in effect does not name is written to the Back Office Audit and warned of on the page it comes back to.
 */
async function warningOfRecipients<T>(administrator: BackOfficeActor, change: () => Promise<T>): Promise<{ result: T; warning: RecipientsWarning }> {
  const { result, uncovered } = await switchingOn(
    {
      state: currentState,
      policy: () => privacyPolicyCoverage(parisDay()),
      record: async (entries) => void (await getBackOffice().record(administrator, async () => null, () => entries)),
    },
    change,
  );
  return { result, warning: uncovered.length > 0 ? { [UNCOVERED_PARAM]: uncovered.map((tool) => tool.id).join(",") } : {} };
}

// ---- Platform Settings (#299 to #303) ----

/** Back at the setting's row, saying how it went; a refused change with its Failure Reason and technical detail (#301); the recipients it switched on uncovered (#548). */
const settingBack = (form: FormData, notice: PlatformSettingNotice, name: string, refusal?: { reason: string; technical: { message: string } }, warning: RecipientsWarning = {}): never =>
  back(form, { notice, setting: name, ...(refusal ? { reason: refusal.reason, detail: refusal.technical.message.slice(0, DETAIL_MAX_LENGTH) } : {}), ...warning }, `setting-${name}`);

/**
 * A super-admin saves a value, parsed as env's is; a value the setting refuses is recorded in the Journal (#299).
 * « Rendre actif » saves the tab's active provider this way. The DPA marked signed is asked to be confirmed first (#302).
 */
export async function saveSetting(form: FormData) {
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const { result: done, warning } = await warningOfRecipients(administrator, () =>
    getPlatformSettingsBackOffice().set(administrator, name, String(form.get("value") ?? ""), { confirmed: form.get(FORM.confirmed) === CONFIRMED }),
  );
  if (!done.ok && done.error === "refused") settingBack(form, "refused", name, done);
  settingBack(form, done.ok ? (done.changed ? "saved" : "unchanged") : (done.error as Exclude<typeof done.error, "refused">), name, undefined, warning);
}

/** « Rétablir »: the Back Office's value is cleared, env's is used, else the code's default (#299); env's DPA marked signed is confirmed first (#302). */
export async function restoreSetting(form: FormData) {
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const { result: done, warning } = await warningOfRecipients(administrator, () =>
    getPlatformSettingsBackOffice().restore(administrator, name, { confirmed: form.get(FORM.confirmed) === CONFIRMED }),
  );
  if (!done.ok && done.error === "refused") settingBack(form, "refused", name, done);
  settingBack(
    form,
    done.ok ? (done.changed ? "restored" : "notRestored") : done.error === "unconfirmed" ? "restoreUnconfirmed" : (done.error as Exclude<typeof done.error, "refused" | "unconfirmed">),
    name,
    undefined,
    warning,
  );
}

// ---- AI tasks' routes and Playbook Agents, in a side panel (#402, ADR-0042) ----

/** The route of the AI task `form` names, as the AI layer routes it now. */
async function routeIn(form: FormData) {
  const task = String(form.get(AI_FORM.task) ?? "");
  if (!isTextTask(task)) back(form, {});
  const route = aiTaskRoutes({ ...(await currentState()), secrets: null }).find((each) => each.task === task);
  if (!route) back(form, {});
  return route;
}

const routeBack = (form: FormData, notice: RouteNotice, warning: RecipientsWarning = {}): never => back(form, { route: notice, ...warning });

/**
 * Saves an AI task's route `changes` as one (#402): all kept, or, the first refused, none, the route staying as it was;
 * the refusal is said as that Platform Setting's.
 */
async function applyRoute(form: FormData, administrator: BackOfficeActor, changes: readonly PlatformSettingValueChange[], saved: RouteNotice): Promise<never> {
  const { result: done, warning } = await warningOfRecipients(administrator, () => getPlatformSettingsBackOffice().apply(administrator, changes));
  if (!done.ok && done.error === "refused") settingBack(form, "refused", done.name, done);
  if (!done.ok) settingBack(form, done.error === "unconfirmed" ? "unconfirmed" : (done.error as Exclude<typeof done.error, "refused" | "unconfirmed">), done.name);
  return routeBack(form, saved, warning);
}

/**
 * An AI task's provider and model, saved as their Platform Settings in one change, each checked as any routing change is
 * (a route with personal data outside the EU, a model failing its test call); a provider whose key is missing is saved
 * all the same, the panel warning of it (ADR-0042). A refusal of either keeps neither.
 */
export async function saveRoute(form: FormData) {
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const route = await routeIn(form);
  const changes = routeChange(route.task, route, { provider: String(form.get("provider") ?? ""), model: String(form.get("model") ?? "") });
  await applyRoute(form, administrator, changes, changes.length > 0 ? "routeSaved" : "routeUnchanged");
}

/** « Rétablir le défaut »: the task's provider and model go back to env's, else the code's default, together or not at all. */
export async function restoreRoute(form: FormData) {
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const route = await routeIn(form);
  await applyRoute(form, administrator, [{ name: route.modelSetting, value: null }, { name: route.providerSetting, value: null }], "routeRestored");
}

/**
 * A Playbook Agent's model and effort (and a search task Playbook's web search provider), saved as a draft Playbook
 * Version with the latest version's rules: a Human-validated latest version gets a new version, a draft is updated in
 * place, recorded in the Back Office Audit (ADR-0021, ADR-0026). The served version is untouched. Playbook editors only.
 */
export async function savePlaybookAgent(form: FormData) {
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get(AI_FORM.playbook) ?? "");
  const history = await getCoachingPlaybooks().history(id);
  const latest = history?.versions[0];
  const agentBack = (notice: PlaybookAgentNotice, version?: number): never => back(form, { agent: notice, version: version ? String(version) : undefined });
  if (!latest) return agentBack("not_found");
  const saved = await getCoachingPlaybooksBackOffice().save(administrator, id, playbookAgentChange(latest, { agentModel: text(form, "agentModel"), effort: text(form, "effort"), searchModel: text(form, "searchModel") }));
  if (!saved.ok) return agentBack(saved.error);
  agentBack(saved.newVersion ? "created" : "updated", saved.version.version);
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
  const { result: replaced, warning } = await warningOfRecipients(administrator, async () => {
    const done = await getProviderSecrets().replace(administrator, name, form.get("value"), { saveAnyway: form.get("saveAnyway") === "on" });
    // This process uses it at once; the others hear the NOTIFY.
    if (done.ok) await getSecretResolver().refresh();
    return done;
  });
  if (!replaced.ok) back(form, { error: replaced.error, key: String(name), status: replaced.error === "test_failed" ? statusIn(replaced.detail) : undefined });
  back(form, { saved: String(name), test: replaced.test, ...warning });
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

// ---- Email intake's Recognised senders, on its sheet (#448): changed by who changes the Job discovery sources ----

const sendersBack = (form: FormData, notice: SenderNotice): never => back(form, { [SENDER_NOTICE_PARAM]: notice });
const senderIn = (form: FormData) => String(form.get("sender") ?? "");

/** Adds a sender to the platform's list, or accepts a proposed one, with its label. */
export async function addRecognisedSender(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const added = await getRecognisedSendersBackOffice().add(administrator, { sender: form.get("sender"), label: form.get("label") });
  sendersBack(form, added.ok ? "added" : added.error);
}

export async function setRecognisedSender(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const updated = await getRecognisedSendersBackOffice().update(administrator, senderIn(form), { enabled: enabledIn(form) });
  sendersBack(form, updated.ok ? "updated" : updated.error === "not_found" ? "notFound" : "invalid");
}

export async function relabelRecognisedSender(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  const updated = await getRecognisedSendersBackOffice().update(administrator, senderIn(form), { label: form.get("label") });
  sendersBack(form, updated.ok ? "updated" : updated.error === "not_found" ? "notFound" : "invalid");
}

export async function removeRecognisedSender(form: FormData) {
  const { administrator } = await requireBackOffice("searchSites", "write");
  sendersBack(form, (await getRecognisedSendersBackOffice().remove(administrator, senderIn(form))) ? "removed" : "notFound");
}

// ---- Sign-in Providers (the former Connexion) ----


export async function saveProvider(form: FormData) {
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const { result: saved, warning } = await warningOfRecipients(administrator, async () => {
    const done = await getSignInProviders().save(administrator, {
      type: text(form, "type"),
      id: text(form, "id"),
      displayName: text(form, "displayName"),
      clientId: text(form, "clientId"),
      discoveryUrl: text(form, "discoveryUrl"),
      tenantId: text(form, "tenantId"),
      appBundleIdentifier: text(form, "appBundleIdentifier"),
      enabled: form.get(SIGN_IN_SWITCHES.enabled) === "on",
      shownToCandidates: form.get(SIGN_IN_SWITCHES.shownToCandidates) === "on",
      allowedForAdministrators: form.get(SIGN_IN_SWITCHES.allowedForAdministrators) === "on",
      trustedForLinking: form.get(SIGN_IN_SWITCHES.trustedForLinking) === "on",
      secrets: { clientSecret: text(form, "clientSecret"), teamId: text(form, "teamId"), keyId: text(form, "keyId"), privateKey: text(form, "privateKey") },
    });
    // This process uses it at once; the others hear the NOTIFY.
    if (done.ok) await applyLatestSignIn();
    return done;
  });
  if (!saved.ok) back(form, { error: saved.error, form: text(form, "formKey") });
  back(form, { saved: saved.id, ...warning });
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
