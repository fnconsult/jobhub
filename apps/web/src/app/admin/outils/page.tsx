import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { keyHref } from "@/platform-settings/parametres";
import { isProviderSecretName } from "@/provider-secrets/catalog";
import { routes } from "@/routes";
import type { ToolFigures } from "@/tools";
import { toolsOverviewNow } from "@/tools/server";
import { EnvBadge } from "./EnvBadge";
import { STATUS_TONE } from "./tone";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("tools");
  const t = await getServerT();
  return { title: `${t("admin.tools.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Super-admins and Support see every external tool the app calls (#233), by category: what it is
 * for, where it runs and processes data, whether it is configured, and its last 30 days' calls.
 * Read-only; a key is only said to be there or not, linked to its provider's sheet in Paramètres (#396) for those who read the Provider Secrets.
 * Its state accounts for its Platform Settings (#304): off, a setting missing, the « env » badge.
 */
export default async function ToolsPage() {
  const { access } = await requireBackOffice("tools");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const overview = await toolsOverviewNow();
  const readsSecrets = access.can("providerSecrets", "read");

  const number = new Intl.NumberFormat(locale);
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const figure = (figures: ToolFigures | null, value: (figures: ToolFigures) => string) => (figures ? value(figures) : t("admin.tools.notTraced"));
  const key = (name: string) =>
    readsSecrets && isProviderSecretName(name) ? (
      <Link href={keyHref(name) ?? routes.adminPlatformSettings}>
        <code>{name}</code>
      </Link>
    ) : (
      <code>{name}</code>
    );

  return (
    <BackOfficeLayout access={access} title={t("admin.tools.title")}>
      <p className="lead">{t("admin.tools.intro")}</p>
      {overview.map(({ category, rows }) => (
        <section key={category} className="stack" aria-labelledby={`tools-${category}`}>
          <h2 id={`tools-${category}`}>{t(`admin.tools.categories.${category}`)}</h2>
          <div className="table-scroll">
            <table className="application-table">
              <caption className="visually-hidden">{t(`admin.tools.categories.${category}`)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.tools.tool")}</th>
                  <th scope="col">{t("admin.tools.purpose")}</th>
                  <th scope="col">{t("admin.tools.status")}</th>
                  <th scope="col">{t("admin.tools.keys")}</th>
                  <th scope="col">{t("admin.tools.residency")}</th>
                  <th scope="col">{t("admin.tools.calls")}</th>
                  <th scope="col">{t("admin.tools.failures")}</th>
                  <th scope="col">{t("admin.tools.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ tool, status, missingKeys, missingSettings, settingsFromEnv, figures }) => (
                  <tr key={tool.id}>
                    <th scope="row">
                      <Link href={routes.adminTool(tool.id)}>{tool.name}</Link>
                      <br />
                      {t(`admin.tools.runsInValues.${tool.runsIn}`)}
                    </th>
                    <td>{tool.purpose[locale]}</td>
                    <td>
                      <span className="pill" data-tone={STATUS_TONE[status]}>
                        {t(`admin.tools.statuses.${status}`)}
                      </span>
                      {settingsFromEnv.length > 0 ? <> <EnvBadge text={t("admin.tools.envBadge")} label={t("admin.tools.envBadgeLabel", { settings: settingsFromEnv.join(", ") })} /></> : null}
                      {missingKeys.length > 0 ? <p>{t("admin.tools.missingKeys", { keys: missingKeys.join(", ") })}</p> : null}
                      {missingSettings.length > 0 ? <p>{t("admin.tools.missingSettings", { settings: missingSettings.join(", ") })}</p> : null}
                    </td>
                    <td>
                      {tool.keys.length === 0
                        ? t("admin.tools.noKeys")
                        : tool.keys.map((name, index) => (
                            <span key={name}>
                              {index > 0 ? <br /> : null}
                              {key(name)}
                            </span>
                          ))}
                    </td>
                    <td>{t(`admin.tools.residencies.${tool.residency}`)}</td>
                    <td>{figure(figures, ({ calls }) => number.format(calls))}</td>
                    <td>{figure(figures, ({ failures }) => number.format(failures))}</td>
                    <td>{figure(figures, ({ costEur }) => (costEur === null ? t("admin.tools.unknownCost") : eur.format(costEur)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </BackOfficeLayout>
  );
}
