import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { BACK_OFFICE_PAGES, type BackOfficePage } from "@/admin/back-office-nav";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { PLATFORM_SETTING_GROUPS } from "@/platform-settings/catalog";
import { envOnlySettingsShown, type ShownValue } from "@/platform-settings/env-only";
import type { PlatformSettingSource } from "@/platform-settings/resolver";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

const SOURCE_TONE: Record<PlatformSettingSource, "success" | "accent" | undefined> = { back_office: "success", env: "accent", default: undefined };

/** The settings with a section of their own, linked from Paramètres (ADR-0033). */
const ELSEWHERE: BackOfficePage[] = ["planQuotas", "guardrails", "coachCost", "providerSecrets"];

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
 */
export default async function PlatformSettingsPage() {
  const { access } = await requireBackOffice("platformSettings");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { settings } = await getPlatformSettingsResolver().refresh();
  const envOnly = envOnlySettingsShown(process.env);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const differing = settings.filter((setting) => setting.differsFromDefault).length;
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
                </tr>
              </thead>
              <tbody>
                {settings
                  .filter((setting) => setting.group === group)
                  .map((setting) => (
                    <tr key={setting.name} data-setting={setting.name}>
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
