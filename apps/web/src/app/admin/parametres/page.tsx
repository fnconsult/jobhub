import { modelSettingProviders, type ProviderId } from "@jobhub/ai";
import { isFailureReason } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformSettingsBackOffice, requireBackOffice } from "@/admin/server";
import { BACK_OFFICE_PAGES, type BackOfficePage } from "@/admin/back-office-nav";
import { getAi } from "@/ai/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { isEditable, PLATFORM_SETTING_GROUPS, platformSetting, type PlatformSetting, type PlatformSettingGroup, type PlatformSettingType } from "@/platform-settings/catalog";
import { envOnlySettingsShown, type ShownValue } from "@/platform-settings/env-only";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { SOURCE_TONE } from "./tone";
import { routes } from "@/routes";

/** The settings with a section of their own, linked from Paramètres (ADR-0033). */
const ELSEWHERE: BackOfficePage[] = ["planQuotas", "guardrails", "coachCost", "providerSecrets"];

/** What the page says after a save or « Rétablir »: a key under admin.platformSettings.notices, and whether it is an error. */
const NOTICES = { saved: false, unchanged: false, restored: false, notRestored: false, invalid: true, empty: true, not_editable: true, refused: true, unconfirmed: true, restoreUnconfirmed: true } as const;
type Notice = keyof typeof NOTICES;
const isNotice = (value: unknown): value is Notice => typeof value === "string" && Object.hasOwn(NOTICES, value);

/** The longest technical detail of a refusal carried back to the page; the Journal keeps it whole. */
const DETAIL_MAX_LENGTH = 300;

/** Back to Paramètres, at the setting's row, saying how it went; a refused change with its Failure Reason and technical detail (#301). */
const back = (notice: Notice, name: string, refusal?: { reason: string; technical: { message: string } }): never =>
  redirect(
    `${routes.adminPlatformSettings}?${new URLSearchParams({ notice, setting: name, ...(refusal ? { reason: refusal.reason, detail: refusal.technical.message.slice(0, DETAIL_MAX_LENGTH) } : {}) })}#setting-${name}`,
  );

/** An AI routing setting naming a model: picked from its provider's known models, or typed, and tested on save (#301). */
const isModelSetting = (setting: PlatformSetting) => setting.group === "ai_routing" && setting.name.endsWith("_MODEL");

/** The models each configured provider is known to serve, for the model settings' suggestions; none when the AI layer cannot be built. */
function knownModels(): Map<ProviderId, string[]> {
  try {
    const ai = getAi();
    return new Map([...ai.agentModels(), ...ai.searchModels()].map((choice) => [choice.provider, choice.models.map((each) => each.model)]));
  } catch {
    return new Map();
  }
}

/** The form field carrying the super-admin's confirmation (the DPA marked signed, #302). */
const CONFIRMED = "yes";
const confirmed = (form: FormData) => form.get("confirmed") === CONFIRMED;
/** What a boolean setting takes, as env holds it. */
const BOOLEAN_VALUES = ["false", "true"] as const;
/** The values a choice or boolean setting takes, in the order its list shows them. */
const choicesOf = (type: PlatformSettingType): readonly string[] => (type.kind === "choice" ? type.values : type.kind === "boolean" ? BOOLEAN_VALUES : []);

/**
 * A super-admin saves a value, parsed as env's is; a value the setting refuses is recorded in the Journal (#299).
 * The DPA marked signed is asked to be confirmed first (#302).
 */
async function saveSetting(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const done = await getPlatformSettingsBackOffice().set(administrator, name, String(form.get("value") ?? ""), { confirmed: confirmed(form) });
  if (!done.ok && done.error === "refused") back("refused", name, done);
  back(done.ok ? (done.changed ? "saved" : "unchanged") : (done.error as Exclude<typeof done.error, "refused">), name);
}

/** « Rétablir »: the Back Office's value is cleared, env's is used, else the code's default (#299); env's DPA marked signed is confirmed first (#302). */
async function restoreSetting(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const done = await getPlatformSettingsBackOffice().restore(administrator, name, { confirmed: confirmed(form) });
  if (!done.ok && done.error === "refused") back("refused", name, done);
  back(done.ok ? (done.changed ? "restored" : "notRestored") : done.error === "unconfirmed" ? "restoreUnconfirmed" : (done.error as Exclude<typeof done.error, "refused" | "unconfirmed">), name);
}

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("platformSettings");
  const t = await getServerT();
  return { title: `${t("admin.platformSettings.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Super-admins and Support see every Platform Setting (#298, ADR-0033), grouped: its value in
 * use, where it comes from (the Back Office, env, the code's default) and the code's default,
 * a value from env that differs from the default flagged; then, read-only, the settings only
 * env holds, secrets never shown; and links to the settings that have their own section.
 * Super-admins change the AI routing (#301), the email sender (#300), the Job Digest's and Job discovery's
 * settings (#299), Enriched Contacts' provider and DPA (#302, the DPA marked signed only once they confirm it),
 * the extension's store page (#303, an https URL; « Rétablir » for none, "coming soon"), or « Rétablir » them;
 * an AI routing change the AI layer would refuse, or whose model fails its test call, is refused with its reason;
 * Support sees no edit control. MAIL_TRANSPORT stays env's, read-only.
 */
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; setting?: string; reason?: string; detail?: string }> }) {
  const { access, canWrite } = await requireBackOffice("platformSettings");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { notice, setting: noticed, reason, detail } = await searchParams;
  const shownNotice = isNotice(notice) && noticed ? platformSetting(noticed) : undefined;
  /** The setting whose value waits for the super-admin's confirmation: only the DPA marked signed asks for one (#302). */
  const confirming = canWrite && shownNotice?.confirm !== undefined && (notice === "unconfirmed" || notice === "restoreUnconfirmed") ? shownNotice : undefined;
  const number = new Intl.NumberFormat(locale);
  /** What a setting takes, as its notices and help say it: "un nombre entier de 0 à 100", "un expéditeur d'e-mail…". */
  const rule = (type: PlatformSettingType): string => {
    if (type.kind === "choice") return t("admin.platformSettings.rules.choice", { values: type.values.join(", ") });
    if (type.kind === "text") return t("admin.platformSettings.rules.text");
    if (type.kind === "url") return t("admin.platformSettings.rules.url");
    if (type.kind === "sender") return t("admin.platformSettings.rules.sender");
    if (type.kind !== "number") return "";
    const key = `${type.whole ? "whole" : "decimal"}${type.aboveMin ? "AboveMin" : ""}` as const;
    return t(`admin.platformSettings.rules.${key}`, { min: number.format(type.min), max: number.format(type.max) });
  };
  const { settings, env: settingsEnv } = await getPlatformSettingsResolver().refresh();
  const refusedReason = notice === "refused" && isFailureReason(reason) ? t(`failureReasons.${reason}`) : "";
  // The provider whose model each model setting names, and the models it is known to serve.
  let modelProviders: Record<string, ProviderId> = {};
  try {
    modelProviders = modelSettingProviders(settingsEnv);
  } catch {
    // A routing value the code refuses: no suggestions, a model can still be typed.
  }
  const models = canWrite ? knownModels() : new Map<ProviderId, string[]>();
  /** What a setting takes, as its help says it; a model setting: its provider's known models or another, tested on save. */
  const accepted = (setting: PlatformSetting): string =>
    isModelSetting(setting) ? t("admin.platformSettings.rules.model", { provider: modelProviders[setting.name] ?? "" }) : rule(setting.type);
  const envOnly = envOnlySettingsShown(process.env);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const differing = settings.filter((setting) => setting.differsFromDefault).length;
  /** Whether the super-admin changes some of `group`'s settings here: its table then has a column for it. */
  const editing = (group: PlatformSettingGroup) => canWrite && settings.some((setting) => setting.group === group && isEditable(setting));
  const elsewhere = ELSEWHERE.filter((page) => access.can(BACK_OFFICE_PAGES[page].resource, "read"));

  const value = (raw: string) => (raw ? <code>{raw}</code> : t("admin.platformSettings.empty"));
  const shown = (value: ShownValue) => {
    switch (value.kind) {
      case "value":
        return <code>{value.value}</code>;
      case "key_versions":
        return t("admin.platformSettings.envOnly.keyVersions", { versions: value.versions.join(", ") });
      default:
        return t(`admin.platformSettings.envOnly.${value.kind}`);
    }
  };

  return (
    <BackOfficeLayout access={access} title={t("admin.platformSettings.title")}>
      <p className="lead">{t("admin.platformSettings.intro")}</p>
      <p>{canWrite ? t("admin.platformSettings.editIntro") : t("admin.readOnly")}</p>
      {confirming ? (
        <section className="notice stack" role="alert" aria-labelledby="confirm-setting">
          <h2 id="confirm-setting">{t("admin.platformSettings.confirmDpa.title")}</h2>
          <p>{t("admin.platformSettings.confirmDpa.question")}</p>
          <form className="stack" action={notice === "restoreUnconfirmed" ? restoreSetting : saveSetting}>
            <input type="hidden" name="name" value={confirming.name} />
            <input type="hidden" name="value" value={confirming.confirm} />
            <input type="hidden" name="confirmed" value={CONFIRMED} />
            <button className="button button-primary" type="submit">
              {t("admin.platformSettings.confirmDpa.yes")}
            </button>
          </form>
          <Link href={`${routes.adminPlatformSettings}#setting-${confirming.name}`}>{t("admin.platformSettings.confirmDpa.cancel")}</Link>
        </section>
      ) : shownNotice && isNotice(notice) ? (
        <div className="notice stack" role={NOTICES[notice] ? "alert" : "status"}>
          <p>{t(`admin.platformSettings.notices.${notice}`, { name: shownNotice.name, rule: rule(shownNotice.type), reason: refusedReason })}</p>
          {notice === "refused" && detail ? (
            <p>
              {t("admin.platformSettings.refusedDetail")} <code>{detail}</code>
            </p>
          ) : null}
        </div>
      ) : null}
      {differing > 0 ? (
        <p className="notice" role="status">
          {t("admin.platformSettings.differs", { count: differing })}
        </p>
      ) : null}

      {PLATFORM_SETTING_GROUPS.map((group) => (
        <section key={group} className="stack" aria-labelledby={`settings-${group}`}>
          <h2 id={`settings-${group}`}>{t(`admin.platformSettings.groups.${group}`)}</h2>
          {group === "enriched_contacts" ? <p>{t("admin.platformSettings.enrichedContactsHelp")}</p> : null}
          <div className="table-scroll">
            <table className="application-table">
              <caption className="visually-hidden">{t(`admin.platformSettings.groups.${group}`)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.platformSettings.setting")}</th>
                  <th scope="col">{t("admin.platformSettings.value")}</th>
                  <th scope="col">{t("admin.platformSettings.source")}</th>
                  <th scope="col">{t("admin.platformSettings.default")}</th>
                  {editing(group) ? <th scope="col">{t("admin.platformSettings.change")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {settings
                  .filter((setting) => setting.group === group)
                  .map((setting) => (
                    <tr key={setting.name} id={`setting-${setting.name}`} data-setting={setting.name}>
                      <th scope="row">
                        <code>{setting.name}</code>
                      </th>
                      <td>
                        {value(setting.value)}
                        {setting.differsFromDefault ? (
                          <>
                            {" "}
                            <strong className="pill" data-tone="danger">
                              {t("admin.platformSettings.differsFlag")}
                            </strong>
                          </>
                        ) : null}
                        {setting.valid ? null : <p>{t("admin.platformSettings.invalidFlag")}</p>}
                      </td>
                      <td>
                        <span className="pill" data-tone={SOURCE_TONE[setting.source]}>
                          {t(`admin.platformSettings.sources.${setting.source}`)}
                        </span>
                        {setting.updatedBy && setting.updatedAt ? (
                          <p>
                            {t("admin.platformSettings.setBy", { email: setting.updatedBy, at: at.format(setting.updatedAt) })}
                          </p>
                        ) : null}
                      </td>
                      <td>{value(setting.default)}</td>
                      {editing(group) ? (
                        <td>
                          {isEditable(setting) ? (
                            <div className="stack">
                              <form className="stack" action={saveSetting}>
                                <input type="hidden" name="name" value={setting.name} />
                                <label className="visually-hidden" htmlFor={`value-${setting.name}`}>
                                  {t("admin.platformSettings.newValue", { name: setting.name })}
                                </label>
                                {setting.type.kind === "choice" || setting.type.kind === "boolean" ? (
                                  // The values the setting takes; "none" first for a provider (#302).
                                  <select id={`value-${setting.name}`} className="input" name="value" defaultValue={setting.value} aria-describedby={`rule-${setting.name}`}>
                                    {setting.value && !choicesOf(setting.type).includes(setting.value) ? null : <option value="" disabled hidden />}
                                    {choicesOf(setting.type).map((choice) => (
                                      <option key={choice} value={choice}>
                                        {choice}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  /* No min or max: the server checks the bounds, so a refused value is in the Journal. A model is
                                     picked from its provider's known models or typed (« autre »): it is tested on save. */
                                  <input
                                    id={`value-${setting.name}`}
                                    className="input"
                                    name="value"
                                    type="text"
                                    inputMode={setting.type.kind === "sender" ? "email" : setting.type.kind === "number" ? (setting.type.whole ? "numeric" : "decimal") : setting.type.kind === "url" ? "url" : undefined}
                                    list={isModelSetting(setting) ? `models-${setting.name}` : undefined}
                                    defaultValue={setting.value}
                                    aria-describedby={`rule-${setting.name}`}
                                  />
                                )}
                                {isModelSetting(setting) ? (
                                  <datalist id={`models-${setting.name}`}>
                                    {(models.get(modelProviders[setting.name]!) ?? []).map((model) => (
                                      <option key={model} value={model} />
                                    ))}
                                  </datalist>
                                ) : null}
                                <p id={`rule-${setting.name}`}>{t("admin.platformSettings.accepted", { rule: accepted(setting) })}</p>
                                <button className="button button-primary" type="submit">
                                  {t("admin.platformSettings.save")}
                                </button>
                              </form>
                              {setting.source === "back_office" ? (
                                <form className="stack" action={restoreSetting}>
                                  <input type="hidden" name="name" value={setting.name} />
                                  <p id={`restore-${setting.name}`}>{t("admin.platformSettings.restoreHelp")}</p>
                                  <button className="button" type="submit" aria-describedby={`restore-${setting.name}`}>
                                    {t("admin.platformSettings.restore")}
                                  </button>
                                </form>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="stack" aria-labelledby="settings-env-only">
        <h2 id="settings-env-only">{t("admin.platformSettings.envOnly.title")}</h2>
        <p>{t("admin.platformSettings.envOnly.intro")}</p>
        {envOnly.some((row) => row.warning === "mail_to_console") ? (
          <p className="notice" role="alert">
            {t("admin.platformSettings.envOnly.mailToConsole")}
          </p>
        ) : null}
        <div className="table-scroll">
          <table className="application-table">
            <caption className="visually-hidden">{t("admin.platformSettings.envOnly.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.platformSettings.setting")}</th>
                <th scope="col">{t("admin.platformSettings.value")}</th>
              </tr>
            </thead>
            <tbody>
              {envOnly.map((row) => (
                <tr key={row.name} id={`setting-${row.name}`} data-setting={row.name}>
                  <th scope="row">
                    <code>{row.name}</code>
                  </th>
                  <td>{shown(row.shown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {elsewhere.length > 0 ? (
        <section className="stack" aria-labelledby="settings-elsewhere">
          <h2 id="settings-elsewhere">{t("admin.platformSettings.elsewhere.title")}</h2>
          <p>{t("admin.platformSettings.elsewhere.intro")}</p>
          <ul>
            {elsewhere.map((page) => (
              <li key={page}>
                <Link href={BACK_OFFICE_PAGES[page].href}>{t(`admin.sections.${page}`)}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </BackOfficeLayout>
  );
}
