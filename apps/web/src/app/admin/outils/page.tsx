import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { Status } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { keyHref } from "@/platform-settings/parametres";
import { isProviderSecretName } from "@/provider-secrets/catalog";
import { routes } from "@/routes";
import type { ToolFigures } from "@/tools";
import { toolsOverviewNow } from "@/tools/server";
import { EnvBadge } from "./EnvBadge";
import { STATUS_TONE } from "./tone";
import "../section.css";

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
      <div className="section-page">
        <PageIntro t={t} page="tools" subject={t("admin.tools.title")} />
        {overview.map(({ category, rows }) => (
          <section key={category} className="section-block" aria-labelledby={`tools-${category}`}>
            <h2 id={`tools-${category}`}>{t(`admin.tools.categories.${category}`)}</h2>
            <Table
              label={t(`admin.tools.categories.${category}`)}
              columns={[
                {
                  key: "tool",
                  header: t("admin.tools.tool"),
                  rowHeader: true,
                  cell: ({ tool }) => (
                    <>
                      <Link href={routes.adminTool(tool.id)}>{tool.name}</Link>
                      <span className="section-meta">{t(`admin.tools.runsInValues.${tool.runsIn}`)}</span>
                    </>
                  ),
                },
                { key: "purpose", header: t("admin.tools.purpose"), cell: ({ tool }) => tool.purpose[locale] },
                {
                  key: "status",
                  header: t("admin.tools.status"),
                  cell: ({ tool, status, missingKeys, missingSettings, settingsFromEnv }) => (
                    <>
                      <span className="section-actions">
                        <Status tone={STATUS_TONE[status] ?? "neutral"}>{t(`admin.tools.statuses.${status}`)}</Status>
                        {settingsFromEnv.length > 0 ? <EnvBadge text={t("admin.tools.envBadge")} label={t("admin.tools.envBadgeLabel", { settings: settingsFromEnv.join(", ") })} /> : null}
                      </span>
                      {missingKeys.length > 0 ? <span className="section-meta">{t("admin.tools.missingKeys", { keys: missingKeys.join(", ") })}</span> : null}
                      {missingSettings.length > 0 ? <span className="section-meta">{t("admin.tools.missingSettings", { settings: missingSettings.join(", ") })}</span> : null}
                      {status === "awaiting_access" ? <span className="section-meta">{t("admin.tools.accessRefused", { provider: tool.name })}</span> : null}
                    </>
                  ),
                },
                {
                  key: "keys",
                  header: t("admin.tools.keys"),
                  cell: ({ tool }) =>
                    tool.keys.length === 0
                      ? t("admin.tools.noKeys")
                      : tool.keys.map((name, index) => (
                          <span key={name}>
                            {index > 0 ? <br /> : null}
                            {key(name)}
                          </span>
                        )),
                },
                { key: "residency", header: t("admin.tools.residency"), cell: ({ tool }) => t(`admin.tools.residencies.${tool.residency}`) },
                { key: "calls", header: t("admin.tools.calls"), numeric: true, cell: ({ figures }) => figure(figures, ({ calls }) => number.format(calls)) },
                { key: "failures", header: t("admin.tools.failures"), numeric: true, cell: ({ figures }) => figure(figures, ({ failures }) => number.format(failures)) },
                {
                  key: "cost",
                  header: t("admin.tools.cost"),
                  numeric: true,
                  cell: ({ figures }) => figure(figures, ({ costEur }) => (costEur === null ? t("admin.tools.unknownCost") : eur.format(costEur))),
                },
              ]}
              rows={rows}
              rowKey={({ tool }) => tool.id}
            />
          </section>
        ))}
      </div>
    </BackOfficeLayout>
  );
}
