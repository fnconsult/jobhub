import { modelSettingProviders, type AgentModelChoice, type ProviderId } from "@jobhub/ai";
import { DEFAULT_JOB_DISCOVERY_SETTINGS, isFailureReason } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { IntroPage } from "@/admin/page-intro";
import { requireBackOffice } from "@/admin/server";
import { dashboardBlocks } from "@/back-office-dashboard/blocks";
import { getAi } from "@/ai/server";
import { aiUsageReportOf } from "@/ai-usage/server";
import { applyLatestSignIn } from "@/auth/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { aiTaskRoutes, keyMissing, playbookAgentRows, searchTaskRows, type PlaybookWithVersions } from "@/platform-settings/ai-tasks";
import { platformSetting, type PlatformSettingType } from "@/platform-settings/catalog";
import { envOnlySettingsShown, retiredSettingsSet } from "@/platform-settings/env-only";
import { addTypeFor, EMAIL_INTAKE_TOOL, PARAMETRES_TABS, parametresHref, parametresTab, possibleProviders, type ProvidersState } from "@/platform-settings/parametres";
import { emailIntakeHeldBack } from "@/email-intake/playbook-state";
import { getRecognisedSenderList } from "@/email-intake/server";
import { getTaskPlaybooks } from "@/task-playbooks/server";
import { isProviderSecretName, type ProviderSecretName } from "@/provider-secrets/catalog";
import { secretCipherFromEnv } from "@/provider-secrets/cipher";
import type { ProviderSecretStatus } from "@/provider-secrets/index";
import { getProviderSecrets } from "@/provider-secrets/server";
import { routes } from "@/routes";
import { getSearchSites } from "@/search-sites/server";
import type { SignInProviderStatus } from "@/sign-in-providers/index";
import { getSignInProviders } from "@/sign-in-providers/server";
import { currentState } from "@/tools/server";
import { restoreSetting, saveSetting } from "./actions";
import { AddPanel, addableTypes } from "./AddPanel";
import { AiTasksSection, PlaybookAgentPanel, RoutePanel, SearchTasksSection, type ModelChoices } from "./AiTasksSection";
import { Here, type Ctx } from "./context";
import { EnvironmentSection } from "./EnvironmentSection";
import {
  AI_FORM,
  CONFIRMED,
  FORM,
  isPlatformSettingNotice,
  isPlaybookAgentNotice,
  isRouteNotice,
  isSenderNotice,
  isSitesNotice,
  PLATFORM_SETTING_NOTICES,
  PLAYBOOK_AGENT_NOTICES,
  SECRET_ERRORS,
  SENDER_NOTICE_PARAM,
  SENDER_NOTICES,
  SITES_NOTICES,
  type SecretError,
} from "./notices";
import { ProviderSheet } from "./ProviderSheet";
import { ProvidersSection } from "./ProvidersSection";
import { SIGN_IN_ERRORS, SignInSection } from "./SignInSection";
import { DiscoverySitesSection, JobSitesSection } from "./SitesSections";
import { SourcesSection } from "./SourcesSection";

type Search = Record<string, string | string[] | undefined>;
const isSignInError = (value: unknown): value is (typeof SIGN_IN_ERRORS)[number] => SIGN_IN_ERRORS.includes(value as (typeof SIGN_IN_ERRORS)[number]);
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/** How the tabs' links say which one is shown (`.tab` styles, ADR-0018), and to assistive technologies. */
const TAB_STATE = { shown: "active", hidden: "inactive" } as const;
const CURRENT = "page";
const WEB_SEARCH_TAB = parametresTab("recherche-web");

/** Its intro (#465): one line, the rest behind « En savoir plus ». */
const INTRO: IntroPage = "platformSettings";

/** Every source on, as Job discovery reads them when the Back Office cannot be. */
const ALL_SOURCES = DEFAULT_JOB_DISCOVERY_SETTINGS.sources;

/** The models each configured provider offers a Playbook Agent and a task Playbook's searches; none when the AI layer cannot be built. */
function modelChoices(): ModelChoices {
  try {
    const ai = getAi();
    return { agent: ai.agentModels(), search: ai.searchModels() };
  } catch {
    return { agent: [], search: [] };
  }
}

/** The models each configured provider is known to serve, for the model settings' suggestions. */
const knownModels = (choices: ModelChoices): Map<ProviderId, string[]> =>
  new Map([...choices.agent, ...choices.search].map((choice: AgentModelChoice) => [choice.provider, choice.models.map((each) => each.model)]));

/**
 * Every Coaching Playbook and task Playbook with its latest Human-validated version, which production serves (#402); null
 * when they cannot be read.
 */
async function playbooksWithVersions(): Promise<PlaybookWithVersions[] | null> {
  try {
    const playbooks = getCoachingPlaybooks();
    const listed = (await playbooks.list()).filter((each) => each.kind === "playbook" || each.kind === "task");
    return await Promise.all(
      listed.map(async (playbook) => ({ playbook, validated: (await playbooks.history(playbook.id))?.versions.find((version) => version.validation !== null) ?? null })),
    );
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("platformSettings");
  const t = await getServerT();
  return { title: `${t("admin.platformSettings.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** What the page says after a change, each kind by its own parameters: only names and codes checked against the known ones. */
function Notices({ ctx, search, signInProviders, requireSso }: { ctx: Ctx; search: Search; signInProviders: readonly SignInProviderStatus[]; requireSso: boolean }) {
  const { t } = ctx;
  const notices: { role: "status" | "alert"; text: string; detail?: ReactNode }[] = [];
  // A Platform Setting (#299 to #303): saved, restored or refused, with its Failure Reason and detail.
  const notice = one(search.notice);
  const setting = platformSetting(one(search.setting) ?? "");
  if (setting && isPlatformSettingNotice(notice) && notice !== "unconfirmed" && notice !== "restoreUnconfirmed") {
    const reason = one(search.reason);
    const detail = one(search.detail);
    notices.push({
      role: PLATFORM_SETTING_NOTICES[notice] ? "alert" : "status",
      text: t(`admin.platformSettings.notices.${notice}`, { name: setting.name, rule: ctx.rule(setting.type), reason: notice === "refused" && isFailureReason(reason) ? t(`failureReasons.${reason}`) : "" }),
      detail:
        notice === "refused" && detail ? (
          <p>
            {t("admin.platformSettings.refusedDetail")} <code>{detail}</code>
          </p>
        ) : undefined,
    });
  }
  // An AI task's route, a Playbook Agent's draft version (#402).
  const route = one(search.route);
  if (isRouteNotice(route)) notices.push({ role: "status", text: t(`admin.platformSettings.aiTasks.notices.${route}`) });
  const agent = one(search.agent);
  if (isPlaybookAgentNotice(agent)) {
    notices.push({ role: PLAYBOOK_AGENT_NOTICES[agent] ? "alert" : "status", text: t(`admin.platformSettings.aiTasks.agentNotices.${agent}`, { version: /^\d{1,6}$/.test(one(search.version) ?? "") ? one(search.version)! : "" }) });
  }
  // A Job discovery source, site or Job Site.
  const sites = one(search.sites);
  if (isSitesNotice(sites)) notices.push({ role: SITES_NOTICES[sites] ? "alert" : "status", text: t(`admin.searchSites.notices.${sites}`) });
  // A Recognised sender, on the Email intake sheet (#448).
  const senders = one(search[SENDER_NOTICE_PARAM]);
  if (isSenderNotice(senders)) notices.push({ role: SENDER_NOTICES[senders] ? "alert" : "status", text: t(`admin.emailIntake.notices.${senders}`) });
  if (ctx.tab.id === "sign_in") {
    // A Sign-in Provider: by its id only, checked against the known ones.
    const named = (id: string | undefined) => signInProviders.find((provider) => provider.id === id)?.displayName;
    const saved = named(one(search.saved));
    if (saved) notices.push({ role: "status", text: t("admin.signInProviders.saved", { name: saved }) });
    if (one(search.removed)) notices.push({ role: "status", text: t("admin.signInProviders.removed") });
    if (one(search.sso) === "saved") notices.push({ role: "status", text: t(requireSso ? "admin.signInProviders.ssoOn" : "admin.signInProviders.ssoOff") });
    const tested = named(one(search.tested));
    if (tested) notices.push({ role: "status", text: t("admin.signInProviders.testPassed", { name: tested }) });
    const testFailed = named(one(search.testFailed));
    const error = one(search.error);
    if (testFailed) notices.push({ role: "alert", text: t("admin.signInProviders.testFailed", { name: testFailed }) });
    else if (isSignInError(error)) notices.push({ role: "alert", text: t(`admin.signInProviders.errors.${error}`) });
  } else {
    // A Provider Secret: by its name and code only, never a value nor a provider's answer.
    const named = (value: string | undefined): ProviderSecretName | undefined => (isProviderSecretName(value) ? value : undefined);
    const status = /^\d{3}$/.test(one(search.status) ?? "") ? one(search.status) : undefined;
    const error = SECRET_ERRORS.includes(one(search.error) as SecretError) ? (one(search.error) as SecretError) : undefined;
    const saved = named(one(search.saved));
    if (saved) notices.push({ role: "status", text: t(one(search.test) === "failed" ? "admin.providerSecrets.savedUntested" : "admin.providerSecrets.saved", { name: saved }) });
    const cleared = named(one(search.cleared));
    if (cleared) notices.push({ role: "status", text: t("admin.providerSecrets.cleared", { name: cleared }) });
    const tested = named(one(search.tested));
    const passed = one(search.result) === "passed";
    if (tested) notices.push({ role: passed ? "status" : "alert", text: t(passed ? "admin.providerSecrets.testPassed" : "admin.providerSecrets.testFailed", { name: tested }) });
    if (error) notices.push({ role: "alert", text: t(`admin.providerSecrets.errors.${error}`, { name: named(one(search.key)) ?? "" }) });
    if (status && (error === "test_failed" || (tested && !passed))) notices.push({ role: "alert", text: t("admin.providerSecrets.status", { status }) });
  }
  return (
    <>
      {notices.map((each) => (
        <div key={each.text} className="notice stack" role={each.role}>
          <p>{each.text}</p>
          {each.detail}
        </div>
      ))}
    </>
  );
}

/**
 * Paramètres (ADR-0033, ADR-0042, #396): in tabs by kind of Tool (Recherche web, IA, Sources, Enrichissement de
 * contacts, E-mail, Paiement, Connexion), then Extension and, last, Environnement; the tab is in the address
 * (`?tab=`), so a reload keeps it. A provider tab shows its active provider and its settings, then every possible
 * provider, whose sheet opens in a side panel (`&fournisseur=`). It absorbs Clés (on each provider's sheet), Connexion
 * (its tab) and Sites de recherche (Sources, Recherche web and Extension). One « + Ajouter » adds what the tab holds.
 * Super-admins change everything; Support reads every tab and changes nothing.
 */
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { administrator, access, canWrite } = await requireBackOffice("platformSettings");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const search = await searchParams;
  const tab = parametresTab(one(search.tab));
  const number = new Intl.NumberFormat(locale);
  /** What a setting takes, as its notices and help say it: "un nombre entier de 0 à 100", "un expéditeur d'e-mail…". */
  const rule = (type: PlatformSettingType): string => {
    if (type.kind === "choice") return t("admin.platformSettings.rules.choice", { values: type.values.join(", ") });
    if (type.kind === "text") return t("admin.platformSettings.rules.text");
    if (type.kind === "url") return t("admin.platformSettings.rules.url");
    if (type.kind === "sender") return t("admin.platformSettings.rules.sender");
    if (type.kind === "country") return t("admin.platformSettings.rules.country");
    if (type.kind === "domain") return t("admin.platformSettings.rules.domain");
    if (type.kind !== "number") return "";
    const key = `${type.whole ? "whole" : "decimal"}${type.aboveMin ? "AboveMin" : ""}` as const;
    return t(`admin.platformSettings.rules.${key}`, { min: number.format(type.min), max: number.format(type.max) });
  };
  const readsSites = access.can("searchSites", "read");
  const readsSignIn = access.can("ssoProviders", "read");
  const readSecrets = access.can("providerSecrets", "read");
  const canSignIn = access.can("ssoProviders", "write");
  const hasDatabase = Boolean(process.env.DATABASE_URL);
  const asked = one(search.ajouter);

  // Back from a test sign-in the provider or Better Auth refused (#263): the test this super-admin started is
  // over, recorded as failed with Better Auth's code (`error`). Once: shown again, there is no test to fail.
  const testFailed = one(search.testFailed);
  if (tab.id === "sign_in" && testFailed && canSignIn) {
    const failed = await getSignInProviders().failTestSignIn(administrator, testFailed, one(search.error) ?? "unknown");
    if (failed) await applyLatestSignIn();
  }

  const tools = await currentState();
  const choices = modelChoices();
  const { settings, env: settingsEnv } = tools.settings;
  const secrets: ProviderSecretStatus[] | null = readSecrets && hasDatabase ? await getProviderSecrets().list() : null;
  const state: ProvidersState = { ...tools, secrets };
  let modelProviders: Record<string, ProviderId> = {};
  try {
    modelProviders = modelSettingProviders(settingsEnv);
  } catch {
    // A routing value the code refuses: no suggestions, a model can still be typed.
  }
  const ctx: Ctx = {
    t,
    locale,
    tab,
    sheet: one(search.fournisseur),
    access,
    can: {
      settings: canWrite,
      secrets: access.can("providerSecrets", "write"),
      readSecrets,
      sites: access.can("searchSites", "write"),
      signIn: canSignIn,
      playbooks: access.can("coachingPlaybooks", "write"),
    },
    canSaveSecrets: secretCipherFromEnv(process.env) !== null,
    at: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }),
    rule,
    modelProviders,
    models: canWrite ? knownModels(choices) : new Map(),
  };

  const rows = possibleProviders(tab, state);
  const envOnly = envOnlySettingsShown(process.env);
  const searchSites = getSearchSites();
  const [sources, discoverySites, jobSites] = await Promise.all([
    readsSites && (tab.id === "sources" || asked !== undefined) ? searchSites.jobDiscoverySources() : null,
    readsSites && tab.id === "web_search" ? searchSites.jobDiscoverySites() : null,
    readsSites && tab.id === "extension" ? searchSites.jobSites() : null,
  ]);
  const [signInProviders, signInSettings] = readsSignIn && hasDatabase && (tab.id === "sign_in" || asked !== undefined) ? await Promise.all([getSignInProviders().list(), getSignInProviders().settings()]) : [[], null];

  // « + Ajouter »: the types this Administrator may add, the one shown preselected from the tab.
  const allowed = addableTypes(ctx);
  const adding = asked !== undefined ? addTypeFor(tab, asked, allowed) : undefined;
  const sheet = adding ? undefined : rows.find((row) => row.tool.id === ctx.sheet);
  // Its uses of the last 30 days whose price was not known (« prix inconnu », #403), on an AI Tool's sheet.
  const sheetUsage = sheet?.tool.usage;
  const unpricedCalls =
    sheetUsage?.table === "ai_usage" && hasDatabase
      ? (await aiUsageReportOf("30d")).tools.filter((tool) => tool.provider === sheetUsage.provider).reduce((sum, tool) => sum + tool.unpricedCalls, 0)
      : 0;
  // The Email intake sheet's Recognised senders and « Expéditeurs proposés » (#448), for who reads the sources.
  const recognisedSenders = getRecognisedSenderList();
  const emailIntakeLists =
    sheet?.tool.id === EMAIL_INTAKE_TOOL && readsSites && hasDatabase ? { senders: await recognisedSenders.list(), proposed: await recognisedSenders.proposed() } : undefined;
  // Email intake held back while no version of its Task Playbook is served (ADR-0052), on the Sources tab.
  const emailIntakeHeld = tab.id === "sources" && sources && hasDatabase ? await emailIntakeHeldBack(getTaskPlaybooks()) : null;
  // France Travail's APIs, each as its latest connection test found it (#400), on its sheet.
  const apiAccess = sheet?.tool.id === "france-travail" && readSecrets && hasDatabase ? await getProviderSecrets().apiAccess("france-travail") : [];

  // The AI tasks and Playbook Agents (#402): on Recherche web the search ones, on IA every one, each in a side panel.
  const aiTab = tab.id === "web_search" || tab.id === "ai";
  const readsPlaybooks = access.can("coachingPlaybooks", "read");
  const playbooks = aiTab && readsPlaybooks && hasDatabase ? await playbooksWithVersions() : null;
  const taskRoutes = tab.id === "ai" ? aiTaskRoutes(state) : [];
  const agentRows = playbooks ? playbookAgentRows(playbooks, state) : null;
  const searchRows = tab.id === "web_search" ? searchTaskRows(playbooks ?? [], state) : [];
  const openRoute = !sheet && !adding && tab.id === "ai" && ctx.can.settings ? taskRoutes.find((each) => each.task === one(search[AI_FORM.task])) : undefined;
  const openAgent = !sheet && !adding && aiTab && ctx.can.playbooks ? agentRows?.find((each) => each.id === one(search[AI_FORM.playbook])) : undefined;
  const openAgentLatest = openAgent ? playbooks?.find((each) => each.playbook.id === openAgent.id)?.playbook.latest : undefined;

  // The DPA marked signed waits for the super-admin's confirmation (#302).
  const noticed = platformSetting(one(search.setting) ?? "");
  const confirmNotice = one(search.notice);
  const confirming = canWrite && noticed?.confirm !== undefined && (confirmNotice === "unconfirmed" || confirmNotice === "restoreUnconfirmed") ? noticed : undefined;
  // The settings of this tab from env that differ from the code's default: how an old `.env` shows up (ADR-0033).
  const differing = settings.filter((setting) => setting.differsFromDefault && tab.settings.includes(setting.name)).length;
  const notices = <Notices ctx={ctx} search={search} signInProviders={signInProviders} requireSso={signInSettings?.requireSsoForAdministrators ?? false} />;

  return (
    <BackOfficeLayout access={access} title={t("admin.platformSettings.title")} inDesignSystem>
      <div className="parametres-head">
        <PageIntro t={t} page={INTRO} subject={t("admin.platformSettings.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {allowed.length > 0 ? (
          <Link prefetch={false} className="button button-primary" href={parametresHref(tab.id, { ajouter: addTypeFor(tab, undefined, allowed) })}>
            {t("admin.platformSettings.add.button")}
          </Link>
        ) : null}
      </div>

      <nav aria-label={t("admin.platformSettings.tabsLabel")}>
        <ul className="tablist parametres-tabs">
          {PARAMETRES_TABS.map((each) => (
            <li key={each.id}>
              <Link prefetch={false} className="tab" href={parametresHref(each.id)} data-state={each.id === tab.id ? TAB_STATE.shown : TAB_STATE.hidden} aria-current={each.id === tab.id ? CURRENT : undefined}>
                {t(`admin.platformSettings.tabs.${each.id}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {confirming ? (
        <section className="notice stack" role="alert" aria-labelledby="confirm-setting">
          <h2 id="confirm-setting">{t("admin.platformSettings.confirmDpa.title")}</h2>
          <p>{t("admin.platformSettings.confirmDpa.question")}</p>
          <form className="stack" action={confirmNotice === "restoreUnconfirmed" ? restoreSetting : saveSetting}>
            <Here ctx={ctx} />
            <input type="hidden" name="name" value={confirming.name} />
            <input type="hidden" name="value" value={confirming.confirm} />
            <input type="hidden" name={FORM.confirmed} value={CONFIRMED} />
            <button className="button button-primary" type="submit">
              {t("admin.platformSettings.confirmDpa.yes")}
            </button>
          </form>
          <Link prefetch={false} href={parametresHref(tab.id, {}, `setting-${confirming.name}`)}>{t("admin.platformSettings.confirmDpa.cancel")}</Link>
        </section>
      ) : sheet || openRoute || openAgent ? null : (
        notices
      )}
      {differing > 0 ? (
        <p className="notice" role="status">
          {t("admin.platformSettings.differs", { count: differing })}
        </p>
      ) : null}

      <div className="tabpanel" data-tab={tab.id}>
        {/* Its consumption and budget figures are on the Dashboard, for those who read them (#408). */}
        {tab.id === "web_search" && dashboardBlocks(access).includes("jobDiscovery") ? (
          <p>
            <Link prefetch={false} href={routes.admin}>
              {t("admin.platformSettings.dashboardLink")}
            </Link>
          </p>
        ) : null}
        {tab.id === "environment" ? (
          <EnvironmentSection ctx={ctx} rows={envOnly} retired={retiredSettingsSet(process.env)} />
        ) : (
          <ProvidersSection ctx={ctx} rows={rows} settings={settings} envOnly={envOnly} />
        )}
        {tab.id === "sources" && sources ? (
          <SourcesSection ctx={ctx} sources={sources} rows={rows} webSearch={possibleProviders(WEB_SEARCH_TAB, state).find((row) => row.active)} heldBack={{ email_intake: emailIntakeHeld }} />
        ) : null}
        {tab.id === "web_search" ? <SearchTasksSection ctx={ctx} rows={searchRows} canEditPlaybooks={ctx.can.playbooks && playbooks !== null} /> : null}
        {tab.id === "ai" ? <AiTasksSection ctx={ctx} routes={taskRoutes} agents={readsPlaybooks ? agentRows : []} canEditPlaybooks={ctx.can.playbooks && playbooks !== null} /> : null}
        {tab.id === "web_search" && discoverySites ? <DiscoverySitesSection ctx={ctx} sites={discoverySites} adding={adding === "job_discovery_site"} /> : null}
        {tab.id === "extension" && jobSites ? <JobSitesSection ctx={ctx} sites={jobSites} adding={adding === "job_site"} /> : null}
        {tab.id === "sign_in" && signInSettings ? (
          <SignInSection ctx={ctx} providers={signInProviders} requireSsoForAdministrators={signInSettings.requireSsoForAdministrators} openForm={one(search.form)} adding={adding === "sign_in_provider"} />
        ) : null}
      </div>

      {sheet ? <ProviderSheet ctx={ctx} row={sheet} secrets={secrets} apiAccess={apiAccess} settings={settings} unpricedCalls={unpricedCalls} notices={notices} emailIntake={emailIntakeLists} /> : null}
      {openRoute ? <RoutePanel ctx={ctx} route={openRoute} choices={choices} keyMissingOf={(provider) => keyMissing(state, provider)} notices={notices} /> : null}
      {openAgent && openAgentLatest ? <PlaybookAgentPanel ctx={ctx} row={openAgent} latest={openAgentLatest} choices={choices} notices={notices} /> : null}
      {adding ? <AddPanel ctx={ctx} type={adding} allowed={allowed} sources={sources ?? ALL_SOURCES} signInTypes={signInProviders.map((provider) => provider.type)} /> : null}
    </BackOfficeLayout>
  );
}
