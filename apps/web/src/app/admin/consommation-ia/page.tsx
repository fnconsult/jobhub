import { pricesFromEnv, SEARCH_TASK, TEXT_TASKS } from "@jobhub/ai";
import type { Metadata } from "next";
import Link from "next/link";
import type { IntroPage } from "@/admin/page-intro";
import { requireBackOffice } from "@/admin/server";
import { aiUsageMonths, aiUsagePeriod, type AiUsageRow, type FailureReasonCount } from "@/ai-usage";
import { aiUsageReportOf } from "@/ai-usage/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Stat, Stats } from "@/design/Card";
import { Field, Select } from "@/design/Field";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { Table, type Column } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { settingHref } from "@/platform-settings/parametres";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { routes } from "@/routes";
import { currentWebSearchAlert } from "@/web-search-alert/server";
import "../section.css";

/** The web search spend alert's hook (#403). */
const WEB_SEARCH_ALERT = "web-search";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "aiUsage";

const DAY_PERIODS = ["7d", "30d", "90d", "12m"] as const;
const TASKS = [...Object.keys(TEXT_TASKS), SEARCH_TASK];
type Task = keyof typeof TEXT_TASKS | typeof SEARCH_TASK;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("aiUsage");
  const t = await getServerT();
  return { title: `${t("admin.aiUsage.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Super-admins and Support follow what AI costs (#218): every AI call, the tools its model used
 * and the external API calls, over a period, in totals and per provider, endpoint and model, task and day
 * (or month), and its failed and warned calls per Failure Reason (#262): codes and their wording only,
 * never a technical reason. Read-only. A billed tool whose price is not known shows « prix inconnu » with its uses,
 * counted 0; a banner says when this month's web search spend reached its alert threshold (#403).
 */
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const { access } = await requireBackOffice("aiUsage");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const requested = (await searchParams).periode;
  const now = new Date();
  const period = aiUsagePeriod(requested, now);
  const [report, alert] = await Promise.all([aiUsageReportOf(period.key), currentWebSearchAlert()]);
  const { totals } = report;
  // The EUR/USD rate in use (#403): the Back Office's, else env's, else the code's.
  const eurPerUsd = pricesFromEnv(getPlatformSettingsResolver().current().env).eurPerUsd;

  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const cost = (value: number | null) => (value === null ? t("admin.aiUsage.unknownCost") : eur.format(value));
  /** A tool's cost: its priced uses, and « prix inconnu » with how many were not, counted 0 (#403). */
  const toolCost = (tool: { costEur: number | null; unpricedCalls: number }) => {
    const unpriced = tool.unpricedCalls > 0 ? t("admin.aiUsage.unknownPrice", { count: tool.unpricedCalls }) : null;
    if (tool.costEur === null) return unpriced ?? t("admin.aiUsage.unknownCost");
    return unpriced ? `${eur.format(tool.costEur)} + ${unpriced}` : eur.format(tool.costEur);
  };
  const rate = (failures: number, calls: number) => (calls === 0 ? "–" : percent.format(failures / calls));
  const taskName = (task: string) => (TASKS.includes(task) ? t(`admin.aiUsage.tasks.${task as Task}`) : task);
  const bucketName = (bucket: string) => (bucket.length === 7 ? month.format(new Date(`${bucket}-01T00:00:00Z`)) : day.format(new Date(`${bucket}T00:00:00Z`)));
  const readsCoachCost = access.can("coachMessageCost", "read");
  const lastDay = new Date(new Date(`${period.to}T00:00:00Z`).getTime() - 86_400_000);

  /** The columns every breakdown shares. */
  const usageColumns: Column<AiUsageRow>[] = [
    { header: t("admin.aiUsage.calls"), numeric: true, cell: (row) => number.format(row.calls) },
    { header: t("admin.aiUsage.failures"), numeric: true, cell: (row) => `${number.format(row.failures)} (${rate(row.failures, row.calls)})` },
    { header: t("admin.aiUsage.inputTokens"), numeric: true, cell: (row) => number.format(row.inputTokens) },
    { header: t("admin.aiUsage.cachedInputTokens"), numeric: true, cell: (row) => number.format(row.cachedInputTokens) },
    { header: t("admin.aiUsage.outputTokens"), numeric: true, cell: (row) => number.format(row.outputTokens) },
    { header: t("admin.aiUsage.cost"), numeric: true, cell: (row) => eur.format(row.costEur) },
  ];

  /** The columns every count per Failure Reason shares: its code, wording and Outcome, and how many calls. */
  const reasonColumns: Column<FailureReasonCount>[] = [
    { header: t("admin.aiUsage.code"), cell: (row) => <code>{row.reason}</code> },
    { header: t("admin.aiUsage.reason"), cell: (row) => t(`failureReasons.${row.reason}`) },
    { header: t("admin.aiUsage.outcome"), cell: (row) => t(`admin.aiMessages.outcomes.${row.outcome}`) },
    { header: t("admin.aiUsage.calls"), numeric: true, cell: (row) => number.format(row.calls) },
  ];
  const { failureReasons } = report;

  return (
    <BackOfficeLayout access={access} title={t("admin.aiUsage.title")}>
      <div className="section-page">
        {alert.crossed ? (
          <Note
            tone="warn"
            role="status"
            data-alert={WEB_SEARCH_ALERT}
            title={t("admin.aiUsage.alertBanner", { threshold: eur.format(alert.thresholdEur), spend: eur.format(alert.spendEur), month: month.format(new Date(`${alert.month}-01T00:00:00Z`)) })}
          >
            <p>
              {alert.emailedAt
                ? t("admin.aiUsage.alertEmailed", { at: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(alert.emailedAt) })
                : t("admin.aiUsage.alertNotEmailedYet")}
            </p>
            <p>
              <Link prefetch={false} href={settingHref("WEB_SEARCH_MONTHLY_ALERT_EUR")}>
                {t("admin.aiUsage.alertSettings")}
              </Link>
            </p>
          </Note>
        ) : null}
        <PageIntro t={t} page={INTRO} subject={t("admin.aiUsage.title")}>
          {readsCoachCost ? (
            <p>
              <Link href={routes.adminCoachCost}>{t("admin.aiUsage.coachCostLink")}</Link>
            </p>
          ) : null}
        </PageIntro>

        <form method="get" action={routes.adminAiUsage()} className="section-actions section-filter">
          <Field label={t("admin.aiUsage.period")}>
            <Select name="periode" defaultValue={period.key}>
              <optgroup label={t("admin.aiUsage.recentDays")}>
                {DAY_PERIODS.map((key) => (
                  <option key={key} value={key}>
                    {t(`admin.aiUsage.periods.${key}`)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("admin.aiUsage.months")}>
                {aiUsageMonths(now).map((key) => (
                  <option key={key} value={key}>
                    {month.format(new Date(`${key}-01T00:00:00Z`))}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <button type="submit" className={buttonClass()}>
            {t("admin.aiUsage.show")}
          </button>
        </form>
        <p className="section-meta">
          {t("admin.aiUsage.range", { from: day.format(new Date(`${period.from}T00:00:00Z`)), to: day.format(lastDay) })} · {t("admin.aiUsage.estimate", { rate: number.format(eurPerUsd) })}
        </p>

        <section className="section-block" aria-labelledby="totals-title">
          <h2 id="totals-title">{t("admin.aiUsage.totalsTitle")}</h2>
          <Stats label={t("admin.aiUsage.totalsTitle")}>
            <Stat label={t("admin.aiUsage.totalCost")} value={eur.format(totals.costEur)} />
            <Stat label={t("admin.aiUsage.calls")} value={number.format(totals.calls)} meta={`${t("admin.aiUsage.failureRate")} ${rate(totals.failures, totals.calls)} (${number.format(totals.failures)})`} />
            <Stat
              label={t("admin.aiUsage.callsCost")}
              value={eur.format(totals.callsCostEur)}
              meta={`${t("admin.aiUsage.toolsCost")} ${eur.format(totals.toolsCostEur)} · ${t("admin.aiUsage.toolCalls")} ${number.format(totals.toolCalls)}`}
            />
            <Stat
              label={t("admin.aiUsage.externalCost")}
              value={eur.format(totals.externalCostEur)}
              meta={`${t("admin.aiUsage.externalCalls")} ${number.format(totals.externalCalls)} (${t("admin.aiUsage.failureRate").toLowerCase()} ${rate(totals.externalFailures, totals.externalCalls)})`}
            />
          </Stats>
          <Properties label={t("admin.aiUsage.tokensTitle")}>
            <Property term={t("admin.aiUsage.inputTokens")}>{number.format(totals.inputTokens)}</Property>
            <Property term={t("admin.aiUsage.cachedInputTokens")}>{number.format(totals.cachedInputTokens)}</Property>
            <Property term={t("admin.aiUsage.outputTokens")}>{number.format(totals.outputTokens)}</Property>
          </Properties>
        </section>

        {report.byModel.length === 0 ? (
          <p>{t("admin.aiUsage.none")}</p>
        ) : (
          <>
            <section className="section-block" aria-labelledby="by-model-title">
              <h2 id="by-model-title">{t("admin.aiUsage.byModelTitle")}</h2>
              <Table
                label={t("admin.aiUsage.byModelCaption")}
                columns={[
                  { header: t("admin.aiUsage.provider"), rowHeader: true, cell: (row) => row.provider ?? t("admin.aiMessages.noProvider") },
                  { header: t("admin.aiUsage.endpoint"), cell: (row) => row.endpoint ?? "—" },
                  { header: t("admin.aiUsage.model"), cell: (row) => row.model ?? "—" },
                  ...usageColumns,
                ]}
                rows={report.byModel}
                rowKey={(row) => `${row.provider} ${row.endpoint} ${row.model}`}
              />
            </section>

            <section className="section-block" aria-labelledby="by-task-title">
              <h2 id="by-task-title">{t("admin.aiUsage.byTaskTitle")}</h2>
              <Table
                label={t("admin.aiUsage.byTaskCaption")}
                columns={[{ header: t("admin.aiUsage.task"), rowHeader: true, cell: (row) => taskName(row.task) }, ...usageColumns]}
                rows={report.byTask}
                rowKey={(row) => row.task}
              />
            </section>

            <section className="section-block" aria-labelledby="by-time-title">
              <h2 id="by-time-title">{period.per === "month" ? t("admin.aiUsage.byMonthTitle") : t("admin.aiUsage.byDayTitle")}</h2>
              <Table
                label={t("admin.aiUsage.byTimeCaption")}
                columns={[
                  {
                    header: period.per === "month" ? t("admin.aiUsage.month") : t("admin.aiUsage.day"),
                    rowHeader: true,
                    cell: (row) => <time dateTime={row.bucket}>{bucketName(row.bucket)}</time>,
                  },
                  ...usageColumns,
                ]}
                rows={report.byTime}
                rowKey={(row) => row.bucket}
              />
            </section>
          </>
        )}

        <section className="section-block" aria-labelledby="reasons-title">
          <h2 id="reasons-title">{t("admin.aiUsage.reasonsTitle")}</h2>
          <p>{t("admin.aiUsage.reasonsIntro")}</p>
          {failureReasons.total.length === 0 ? (
            <p>{t("admin.aiUsage.noReasons")}</p>
          ) : (
            <>
              <Table label={t("admin.aiUsage.reasonsCaption")} columns={reasonColumns} rows={failureReasons.total} rowKey={(row) => `${row.outcome} ${row.reason}`} />

              <h3>{t("admin.aiUsage.reasonsByModelTitle")}</h3>
              <Table
                label={t("admin.aiUsage.reasonsByModelCaption")}
                columns={[
                  { header: t("admin.aiUsage.provider"), rowHeader: true, cell: (row) => row.provider ?? t("admin.aiMessages.noProvider") },
                  { header: t("admin.aiUsage.model"), cell: (row) => row.model ?? "—" },
                  ...(reasonColumns as Column<(typeof failureReasons.byModel)[number]>[]),
                ]}
                rows={failureReasons.byModel}
                rowKey={(row) => `${row.provider} ${row.model} ${row.outcome} ${row.reason}`}
              />

              <h3>{t("admin.aiUsage.reasonsByTaskTitle")}</h3>
              <Table
                label={t("admin.aiUsage.reasonsByTaskCaption")}
                columns={[
                  { header: t("admin.aiUsage.task"), rowHeader: true, cell: (row) => taskName(row.task) },
                  ...(reasonColumns as Column<(typeof failureReasons.byTask)[number]>[]),
                ]}
                rows={failureReasons.byTask}
                rowKey={(row) => `${row.task} ${row.outcome} ${row.reason}`}
              />
            </>
          )}
        </section>

        <section className="section-block" aria-labelledby="tools-title">
          <h2 id="tools-title">{t("admin.aiUsage.toolsTitle")}</h2>
          {report.tools.length === 0 ? (
            <p>{t("admin.aiUsage.noTools")}</p>
          ) : (
            <Table
              label={t("admin.aiUsage.toolsCaption")}
              columns={[
                { header: t("admin.aiUsage.tool"), rowHeader: true, cell: (tool) => tool.name },
                { header: t("admin.aiUsage.provider"), cell: (tool) => tool.provider },
                { header: t("admin.aiUsage.uses"), numeric: true, cell: (tool) => number.format(tool.calls) },
                { header: t("admin.aiUsage.failures"), numeric: true, cell: (tool) => number.format(tool.failures) },
                { header: t("admin.aiUsage.cost"), numeric: true, cell: (tool) => toolCost(tool) },
              ]}
              rows={report.tools}
              rowKey={(tool) => `${tool.provider} ${tool.name}`}
            />
          )}
        </section>

        <section className="section-block" aria-labelledby="external-title">
          <h2 id="external-title">{t("admin.aiUsage.externalTitle")}</h2>
          {report.externalApis.length === 0 ? (
            <p>{t("admin.aiUsage.noExternal")}</p>
          ) : (
            <Table
              label={t("admin.aiUsage.externalCaption")}
              columns={[
                { header: t("admin.aiUsage.provider"), rowHeader: true, cell: (api) => api.provider },
                { header: t("admin.aiUsage.operation"), cell: (api) => <code>{api.operation}</code> },
                { header: t("admin.aiUsage.calls"), numeric: true, cell: (api) => number.format(api.calls) },
                { header: t("admin.aiUsage.failures"), numeric: true, cell: (api) => `${number.format(api.failures)} (${rate(api.failures, api.calls)})` },
                { header: t("admin.aiUsage.cost"), numeric: true, cell: (api) => cost(api.costEur) },
              ]}
              rows={report.externalApis}
              rowKey={(api) => `${api.provider} ${api.operation}`}
            />
          )}
        </section>
      </div>
    </BackOfficeLayout>
  );
}
