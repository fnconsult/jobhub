import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformSettingsBackOffice, requireBackOffice } from "@/admin/server";
import { BACK_OFFICE_PAGES, type BackOfficePage } from "@/admin/back-office-nav";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { isEditable, PLATFORM_SETTING_GROUPS, platformSetting, type PlatformSettingGroup, type PlatformSettingType } from "@/platform-settings/catalog";
import { envOnlySettingsShown, type ShownValue } from "@/platform-settings/env-only";
import type { PlatformSettingSource } from "@/platform-settings/resolver";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { routes } from "@/routes";

const SOURCE_TONE: Record<PlatformSettingSource, "success" | "accent" | undefined> = { back_office: "success", env: "accent", default: undefined };

/** The settings with a section of their own, linked from Paramètres (ADR-0033). */
const ELSEWHERE: BackOfficePage[] = ["planQuotas", "guardrails", "coachCost", "providerSecrets"];

/** What the page says after a save or « Rétablir »: a key under admin.platformSettings.notices, and whether it is an error. */
const NOTICES = { saved: false, unchanged: false, restored: false, notRestored: false, invalid: true, empty: true, not_editable: true } as const;
type Notice = keyof typeof NOTICES;
const isNotice = (value: unknown): value is Notice => typeof value === "string" && Object.hasOwn(NOTICES, value);

/** Back to Paramètres, at the setting's row, saying how it went. */
const back = (notice: Notice, name: string): never =>
  redirect(`${routes.adminPlatformSettings}?${new URLSearchParams({ notice, setting: name })}#setting-${name}`);

/** A super-admin saves a value, parsed as env's is; a value the setting refuses is recorded in the Journal (#299). */
async function saveSetting(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const done = await getPlatformSettingsBackOffice().set(administrator, name, String(form.get("value") ?? ""));
  back(done.ok ? (done.changed ? "saved" : "unchanged") : done.error, name);
}

/** « Rétablir »: the Back Office's value is cleared, env's is used, else the code's default (#299). */
async function restoreSetting(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("platformSettings", "write");
  const name = String(form.get("name") ?? "");
  const done = await getPlatformSettingsBackOffice().restore(administrator, name);
  back(done.ok ? (done.changed ? "restored" : "notRestored") : done.error, name);
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
 * Super-admins change the Job Digest's and Job discovery's settings, or « Rétablir » them (#299);
 * Support sees no edit control.
 */
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; setting?: string }> }) {
  const { access, canWrite } = await requireBackOffice("platformSettings");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { notice, setting: noticed } = await searchParams;
  const shownNotice = isNotice(notice) && noticed ? platformSetting(noticed) : undefined;
  const number = new Intl.NumberFormat(locale);
  /** What a setting takes, as its notices and help say it: "un nombre entier de 0 à 100". */
  const rule = (type: PlatformSettingType): string => {
    if (type.kind !== "number") return "";
    const key = `${type.whole ? "whole" : "decimal"}${type.aboveMin ? "AboveMin" : ""}` as const;
    return t(`admin.platformSettings.rules.${key}`, { min: number.format(type.min), max: number.format(type.max) });
  };
  const { settings } = await getPlatformSettingsResolver().refresh();
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
      {shownNotice && isNotice(notice) ? (
        <p className="notice" role={NOTICES[notice] ? "alert" : "status"}>
          {t(`admin.platformSettings.notices.${notice}`, { name: shownNotice.name, rule: rule(shownNotice.type) })}
        </p>
      ) : null}
      {differing > 0 ? (
        <p className="notice" role="status">
          {t("admin.platformSettings.differs", { count: differing })}
        </p>
      ) : null}

      {PLATFORM_SETTING_GROUPS.map((group) => (
        <section key={group} className="stack" aria-labelledby={`settings-${group}`}>
          <h2 id={`settings-${group}`}>{t(`admin.platformSettings.groups.${group}`)}</h2>
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
                                {/* No min or max: the server checks the bounds, so a refused value is in the Journal. */}
                                <input
                                  id={`value-${setting.name}`}
                                  className="input"
                                  name="value"
                                  type="text"
                                  inputMode={setting.type.kind === "number" && setting.type.whole ? "numeric" : "decimal"}
                                  defaultValue={setting.value}
                                  aria-describedby={`rule-${setting.name}`}
                                />
                                <p id={`rule-${setting.name}`}>{t("admin.platformSettings.accepted", { rule: rule(setting.type) })}</p>
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
                <tr key={row.name} data-setting={row.name}>
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
