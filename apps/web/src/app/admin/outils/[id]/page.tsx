import { toolById } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card, Stat, Stats } from "@/design/Card";
import { Pill, Status } from "@/design/Pill";
import { Properties, Property } from "@/design/Properties";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { keyHref, settingHref } from "@/platform-settings/parametres";
import { isProviderSecretName } from "@/provider-secrets/catalog";
import { routes } from "@/routes";
import { LATEST_CALLS, type ToolCall } from "@/tools";
import { toolPage } from "@/tools/server";
import { SOURCE_TONE } from "../../parametres/tone";
import { EnvBadge } from "../EnvBadge";
import { STATUS_TONE } from "../tone";
import "../../section.css";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  await requireBackOffice("tools");
  const t = await getServerT();
  const tool = toolById((await params).id);
  return { title: `${tool ? `${tool.name} · ` : ""}${t("admin.tools.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * One Tool (#233): what it is, whether it is configured, its last 30 days' figures (with its failed and
 * warned AI calls per Failure Reason, #262) and its latest calls, each with when, what, its outcome (and
 * reason's wording), duration and cost. Never a payload, a secret nor a technical reason.
 * And its Platform Settings (#304), read-only with their value and source, each linked to its row
 * on Paramètres for those who can read it: Paramètres stays the only place they are changed.
 */
export default async function ToolPage({ params }: Params) {
  const { access } = await requireBackOffice("tools");
  const tool = toolById((await params).id);
  if (!tool) notFound();
  const { row, calls } = await toolPage(tool);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const readsSecrets = access.can("providerSecrets", "read");
  const readsSettings = access.can("platformSettings", "read");

  const number = new Intl.NumberFormat(locale);
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const milliseconds = new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond" });
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });
  const cost = (value: number | null) => (value === null ? t("admin.tools.unknownCost") : eur.format(value));
  const outcome = (call: ToolCall) => {
    const status = call.httpStatus === null ? null : t("admin.tools.httpStatus", { status: call.httpStatus });
    // An AI call's Failure Reason, by its wording: never its technical reason.
    const reason = call.reason ? ` · ${t(`failureReasons.${call.reason}`)}` : "";
    if (call.outcome === "warning") return `${t("admin.tools.warning")}${reason}`;
    if (call.ok) return status ? `${t("admin.tools.ok")} (${status})` : t("admin.tools.ok");
    return `${t("admin.tools.failed")}${reason || ` (${status ?? t("admin.tools.noAnswer")})`}`;
  };

  return (
    <BackOfficeLayout access={access} title={tool.name}>
      <div className="section-page">
        <p>
          <Link href={routes.adminTools}>{t("admin.tools.back")}</Link>
        </p>
        <p className="section-lead">{tool.purpose[locale]}</p>

        <Card title={t("admin.tools.details")}>
          <Properties label={t("admin.tools.details")}>
            <Property term={t("admin.tools.category")}>{t(`admin.tools.categories.${tool.category}`)}</Property>
            <Property term={t("admin.tools.status")}>
              <span className="section-actions">
                <Status tone={STATUS_TONE[row.status] ?? "neutral"}>{t(`admin.tools.statuses.${row.status}`)}</Status>
                {row.settingsFromEnv.length > 0 ? (
                  <EnvBadge text={t("admin.tools.envBadge")} label={t("admin.tools.envBadgeLabel", { settings: row.settingsFromEnv.join(", ") })} />
                ) : null}
              </span>
              {row.missingKeys.length > 0 ? <span className="section-meta">{t("admin.tools.missingKeys", { keys: row.missingKeys.join(", ") })}</span> : null}
              {row.missingSettings.length > 0 ? <span className="section-meta">{t("admin.tools.missingSettings", { settings: row.missingSettings.join(", ") })}</span> : null}
              {row.status === "awaiting_access" ? <span className="section-meta">{t("admin.tools.accessRefused", { provider: row.tool.name })}</span> : null}
            </Property>
            <Property term={t("admin.tools.keys")}>
              {tool.keys.length === 0
                ? t("admin.tools.noKeys")
                : tool.keys.map((name, index) => (
                    <span key={name}>
                      {index > 0 ? ", " : null}
                      {readsSecrets && isProviderSecretName(name) ? (
                        <Link href={keyHref(name) ?? routes.adminPlatformSettings}>
                          <code>{name}</code>
                        </Link>
                      ) : (
                        <code>{name}</code>
                      )}
                    </span>
                  ))}
            </Property>
            <Property term={t("admin.tools.residency")}>
              {t(`admin.tools.residencies.${tool.residency}`)}
              {tool.residencyNote ? <> · {tool.residencyNote[locale]}</> : null}
            </Property>
            <Property term={t("admin.tools.runsIn")}>{t(`admin.tools.runsInValues.${tool.runsIn}`)}</Property>
            <Property term={t("admin.tools.module")}>
              <code>{tool.module}</code>
            </Property>
          </Properties>
        </Card>

        {row.settings.length > 0 ? (
          <section className="section-block" aria-labelledby="tool-settings">
            <h2 id="tool-settings">{t("admin.tools.settingsTitle")}</h2>
            <p>{t("admin.tools.settingsIntro")}</p>
            <Table
              label={t("admin.tools.settingsCaption", { name: tool.name })}
              columns={[
                {
                  key: "setting",
                  header: t("admin.platformSettings.setting"),
                  rowHeader: true,
                  cell: (setting) =>
                    readsSettings ? (
                      <Link href={settingHref(setting.name)}>
                        <code>{setting.name}</code>
                      </Link>
                    ) : (
                      <code>{setting.name}</code>
                    ),
                },
                {
                  key: "value",
                  header: t("admin.platformSettings.value"),
                  cell: (setting) => (
                    <span className="section-actions">
                      {setting.value ? <code>{setting.value}</code> : t("admin.platformSettings.empty")}
                      {setting.differsFromDefault ? <Pill tone="danger">{t("admin.platformSettings.differsFlag")}</Pill> : null}
                    </span>
                  ),
                },
                { key: "source", header: t("admin.platformSettings.source"), cell: (setting) => <Pill tone={SOURCE_TONE[setting.source] ?? "neutral"}>{t(`admin.platformSettings.sources.${setting.source}`)}</Pill> },
              ]}
              rows={row.settings}
              rowKey={(setting) => setting.name}
              rowAttributes={(setting) => ({ "data-setting": setting.name })}
            />
          </section>
        ) : null}

        {row.figures ? (
          <section className="section-block" aria-labelledby="tool-figures">
            <h2 id="tool-figures">{t("admin.tools.figuresTitle")}</h2>
            <Stats label={t("admin.tools.figuresTitle")}>
              <Stat label={t("admin.tools.calls")} value={number.format(row.figures.calls)} />
              <Stat label={t("admin.tools.failures")} value={number.format(row.figures.failures)} />
              <Stat label={t("admin.tools.cost")} value={cost(row.figures.costEur)} />
            </Stats>

            {tool.usage?.table === "ai_usage" ? (
              <>
                <h3>{t("admin.tools.reasonsTitle")}</h3>
                {row.figures.reasons.length === 0 ? (
                  <p>{t("admin.tools.noReasons")}</p>
                ) : (
                  <Table
                    label={t("admin.tools.reasonsCaption", { name: tool.name })}
                    columns={[
                      { key: "code", header: t("admin.tools.code"), cell: (count) => <code>{count.reason}</code> },
                      { key: "reason", header: t("admin.tools.reason"), cell: (count) => t(`failureReasons.${count.reason}`) },
                      { key: "outcome", header: t("admin.tools.outcome"), cell: (count) => (count.outcome === "warning" ? t("admin.tools.warning") : t("admin.tools.failed")) },
                      { key: "calls", header: t("admin.tools.calls"), numeric: true, cell: (count) => number.format(count.calls) },
                    ]}
                    rows={row.figures.reasons}
                    rowKey={(count) => `${count.outcome} ${count.reason}`}
                  />
                )}
              </>
            ) : null}
          </section>
        ) : null}

        <section className="section-block" aria-labelledby="tool-calls">
          <h2 id="tool-calls">{t("admin.tools.latestCalls")}</h2>
          {!tool.usage ? (
            <p>{t("admin.tools.notTracedHelp")}</p>
          ) : calls.length === 0 ? (
            <p>{t("admin.tools.noCalls")}</p>
          ) : (
            <>
              <p>{t("admin.tools.latestCallsIntro", { count: LATEST_CALLS })}</p>
              <Table
                label={t("admin.tools.callsCaption", { name: tool.name })}
                columns={[
                  { key: "at", header: t("admin.tools.at"), cell: (call) => <time dateTime={call.at.toISOString()}>{at.format(call.at)}</time> },
                  { key: "operation", header: t("admin.tools.operation"), cell: (call) => <code>{call.operation}</code> },
                  { key: "outcome", header: t("admin.tools.outcome"), cell: (call) => outcome(call) },
                  { key: "duration", header: t("admin.tools.duration"), numeric: true, cell: (call) => milliseconds.format(call.durationMs) },
                  { key: "cost", header: t("admin.tools.callCost"), numeric: true, cell: (call) => cost(call.costEur) },
                ]}
                rows={calls.map((call, index) => ({ ...call, index }))}
                rowKey={(call) => `${call.at.toISOString()}-${call.index}`}
              />
            </>
          )}
        </section>
      </div>
    </BackOfficeLayout>
  );
}
