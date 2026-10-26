import { toolById } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { keyHref, settingHref } from "@/platform-settings/parametres";
import { isProviderSecretName } from "@/provider-secrets/catalog";
import { routes } from "@/routes";
import { LATEST_CALLS, type ToolCall } from "@/tools";
import { toolPage } from "@/tools/server";
import { SOURCE_TONE } from "../../parametres/tone";
import { EnvBadge } from "../EnvBadge";
import { STATUS_TONE } from "../tone";

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
      <p>
        <Link href={routes.adminTools}>{t("admin.tools.back")}</Link>
      </p>
      <p className="lead">{tool.purpose[locale]}</p>

      <h2>{t("admin.tools.details")}</h2>
      <dl className="props" aria-label={t("admin.tools.details")}>
        <dt>{t("admin.tools.category")}</dt>
        <dd>{t(`admin.tools.categories.${tool.category}`)}</dd>
        <dt>{t("admin.tools.status")}</dt>
        <dd>
          <span className="pill" data-tone={STATUS_TONE[row.status]}>
            {t(`admin.tools.statuses.${row.status}`)}
          </span>
          {row.settingsFromEnv.length > 0 ? (
            <>
              {" "}
              <EnvBadge text={t("admin.tools.envBadge")} label={t("admin.tools.envBadgeLabel", { settings: row.settingsFromEnv.join(", ") })} />
            </>
          ) : null}
          {row.missingKeys.length > 0 ? <> {t("admin.tools.missingKeys", { keys: row.missingKeys.join(", ") })}</> : null}
          {row.missingSettings.length > 0 ? <> {t("admin.tools.missingSettings", { settings: row.missingSettings.join(", ") })}</> : null}
        </dd>
        <dt>{t("admin.tools.keys")}</dt>
        <dd>
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
        </dd>
        <dt>{t("admin.tools.residency")}</dt>
        <dd>
          {t(`admin.tools.residencies.${tool.residency}`)}
          {tool.residencyNote ? <> · {tool.residencyNote[locale]}</> : null}
        </dd>
        <dt>{t("admin.tools.runsIn")}</dt>
        <dd>{t(`admin.tools.runsInValues.${tool.runsIn}`)}</dd>
        <dt>{t("admin.tools.module")}</dt>
        <dd>
          <code>{tool.module}</code>
        </dd>
      </dl>

      {row.settings.length > 0 ? (
        <section className="stack" aria-labelledby="tool-settings">
          <h2 id="tool-settings">{t("admin.tools.settingsTitle")}</h2>
          <p>{t("admin.tools.settingsIntro")}</p>
          <div className="table-scroll">
            <table className="application-table">
              <caption className="visually-hidden">{t("admin.tools.settingsCaption", { name: tool.name })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.platformSettings.setting")}</th>
                  <th scope="col">{t("admin.platformSettings.value")}</th>
                  <th scope="col">{t("admin.platformSettings.source")}</th>
                </tr>
              </thead>
              <tbody>
                {row.settings.map((setting) => (
                  <tr key={setting.name} data-setting={setting.name}>
                    <th scope="row">
                      {readsSettings ? (
                        <Link href={settingHref(setting.name)}>
                          <code>{setting.name}</code>
                        </Link>
                      ) : (
                        <code>{setting.name}</code>
                      )}
                    </th>
                    <td>
                      {setting.value ? <code>{setting.value}</code> : t("admin.platformSettings.empty")}
                      {setting.differsFromDefault ? (
                        <>
                          {" "}
                          <strong className="pill" data-tone="danger">
                            {t("admin.platformSettings.differsFlag")}
                          </strong>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className="pill" data-tone={SOURCE_TONE[setting.source]}>
                        {t(`admin.platformSettings.sources.${setting.source}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {row.figures ? (
        <>
          <h2>{t("admin.tools.figuresTitle")}</h2>
          <dl className="props" aria-label={t("admin.tools.figuresTitle")}>
            <dt>{t("admin.tools.calls")}</dt>
            <dd>{number.format(row.figures.calls)}</dd>
            <dt>{t("admin.tools.failures")}</dt>
            <dd>{number.format(row.figures.failures)}</dd>
            <dt>{t("admin.tools.cost")}</dt>
            <dd>{cost(row.figures.costEur)}</dd>
          </dl>

          {tool.usage?.table === "ai_usage" ? (
            <>
              <h3>{t("admin.tools.reasonsTitle")}</h3>
              {row.figures.reasons.length === 0 ? (
                <p>{t("admin.tools.noReasons")}</p>
              ) : (
                <div className="table-scroll">
                  <table className="application-table">
                    <caption>{t("admin.tools.reasonsCaption", { name: tool.name })}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("admin.tools.code")}</th>
                        <th scope="col">{t("admin.tools.reason")}</th>
                        <th scope="col">{t("admin.tools.outcome")}</th>
                        <th scope="col">{t("admin.tools.calls")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.figures.reasons.map((count) => (
                        <tr key={`${count.outcome} ${count.reason}`}>
                          <td>
                            <code>{count.reason}</code>
                          </td>
                          <td>{t(`failureReasons.${count.reason}`)}</td>
                          <td>{count.outcome === "warning" ? t("admin.tools.warning") : t("admin.tools.failed")}</td>
                          <td>{number.format(count.calls)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </>
      ) : null}

      <h2>{t("admin.tools.latestCalls")}</h2>
      {!tool.usage ? (
        <p>{t("admin.tools.notTracedHelp")}</p>
      ) : calls.length === 0 ? (
        <p>{t("admin.tools.noCalls")}</p>
      ) : (
        <>
          <p>{t("admin.tools.latestCallsIntro", { count: LATEST_CALLS })}</p>
          <div className="table-scroll">
            <table className="application-table">
              <caption className="visually-hidden">{t("admin.tools.callsCaption", { name: tool.name })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.tools.at")}</th>
                  <th scope="col">{t("admin.tools.operation")}</th>
                  <th scope="col">{t("admin.tools.outcome")}</th>
                  <th scope="col">{t("admin.tools.duration")}</th>
                  <th scope="col">{t("admin.tools.callCost")}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call, index) => (
                  <tr key={`${call.at.toISOString()}-${index}`}>
                    <td>
                      <time dateTime={call.at.toISOString()}>{at.format(call.at)}</time>
                    </td>
                    <td>
                      <code>{call.operation}</code>
                    </td>
                    <td>{outcome(call)}</td>
                    <td>{milliseconds.format(call.durationMs)}</td>
                    <td>{cost(call.costEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </BackOfficeLayout>
  );
}
