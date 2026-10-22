import { EUR_PER_USD, SEARCH_TASK, TEXT_TASKS } from "@jobhub/ai";
import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { aiUsageMonths, aiUsagePeriod, type AiUsageRow, type FailureReasonCount } from "@/ai-usage";
import { aiUsageReportOf } from "@/ai-usage/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

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
 * never a technical reason. Read-only.
 */
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const { access } = await requireBackOffice("aiUsage");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const requested = (await searchParams).periode;
  const now = new Date();
  const period = aiUsagePeriod(requested, now);
  const report = await aiUsageReportOf(period.key);
  const { totals } = report;

  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const cost = (value: number | null) => (value === null ? t("admin.aiUsage.unknownCost") : eur.format(value));
  const rate = (failures: number, calls: number) => (calls === 0 ? "–" : percent.format(failures / calls));
  const taskName = (task: string) => (TASKS.includes(task) ? t(`admin.aiUsage.tasks.${task as Task}`) : task);
  const bucketName = (bucket: string) => (bucket.length === 7 ? month.format(new Date(`${bucket}-01T00:00:00Z`)) : day.format(new Date(`${bucket}T00:00:00Z`)));
  const readsCoachCost = access.can("coachMessageCost", "read");
  const lastDay = new Date(new Date(`${period.to}T00:00:00Z`).getTime() - 86_400_000);

  /** The columns every breakdown shares. */
  const usageCells = (row: AiUsageRow) => (
    <>
      <td>{number.format(row.calls)}</td>
      <td>
        {number.format(row.failures)} ({rate(row.failures, row.calls)})
      </td>
      <td>{number.format(row.inputTokens)}</td>
      <td>{number.format(row.cachedInputTokens)}</td>
      <td>{number.format(row.outputTokens)}</td>
      <td>{eur.format(row.costEur)}</td>
    </>
  );
  const usageHeads = (
    <>
      <th scope="col">{t("admin.aiUsage.calls")}</th>
      <th scope="col">{t("admin.aiUsage.failures")}</th>
      <th scope="col">{t("admin.aiUsage.inputTokens")}</th>
      <th scope="col">{t("admin.aiUsage.cachedInputTokens")}</th>
      <th scope="col">{t("admin.aiUsage.outputTokens")}</th>
      <th scope="col">{t("admin.aiUsage.cost")}</th>
    </>
  );

  /** The columns every count per Failure Reason shares: its code, wording and Outcome, and how many calls. */
  const reasonCells = (row: FailureReasonCount) => (
    <>
      <td>
        <code>{row.reason}</code>
      </td>
      <td>{t(`failureReasons.${row.reason}`)}</td>
      <td>{t(`admin.aiMessages.outcomes.${row.outcome}`)}</td>
      <td>{number.format(row.calls)}</td>
    </>
  );
  const reasonHeads = (
    <>
      <th scope="col">{t("admin.aiUsage.code")}</th>
      <th scope="col">{t("admin.aiUsage.reason")}</th>
      <th scope="col">{t("admin.aiUsage.outcome")}</th>
      <th scope="col">{t("admin.aiUsage.calls")}</th>
    </>
  );
  const { failureReasons } = report;

  return (
    <BackOfficeLayout access={access} title={t("admin.aiUsage.title")}>
      <p className="lead">{t("admin.aiUsage.intro")}</p>
      <p>{t("admin.aiUsage.estimate", { rate: number.format(EUR_PER_USD) })}</p>
      {readsCoachCost ? (
        <p>
          <Link href={routes.adminCoachCost}>{t("admin.aiUsage.coachCostLink")}</Link>
        </p>
      ) : null}

      <form method="get" action={routes.adminAiUsage()} className="stack">
        <div className="field">
          <label htmlFor="ai-usage-period">{t("admin.aiUsage.period")}</label>
          <select id="ai-usage-period" name="periode" className="input" defaultValue={period.key}>
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
          </select>
        </div>
        <div>
          <button type="submit" className="button">
            {t("admin.aiUsage.show")}
          </button>
        </div>
      </form>
      <p>{t("admin.aiUsage.range", { from: day.format(new Date(`${period.from}T00:00:00Z`)), to: day.format(lastDay) })}</p>

      <h2>{t("admin.aiUsage.totalsTitle")}</h2>
      <dl className="props" aria-label={t("admin.aiUsage.totalsTitle")}>
        <dt>{t("admin.aiUsage.calls")}</dt>
        <dd>{number.format(totals.calls)}</dd>
        <dt>{t("admin.aiUsage.failureRate")}</dt>
        <dd>
          {rate(totals.failures, totals.calls)} ({number.format(totals.failures)})
        </dd>
        <dt>{t("admin.aiUsage.inputTokens")}</dt>
        <dd>{number.format(totals.inputTokens)}</dd>
        <dt>{t("admin.aiUsage.cachedInputTokens")}</dt>
        <dd>{number.format(totals.cachedInputTokens)}</dd>
        <dt>{t("admin.aiUsage.outputTokens")}</dt>
        <dd>{number.format(totals.outputTokens)}</dd>
        <dt>{t("admin.aiUsage.callsCost")}</dt>
        <dd>
          {eur.format(totals.callsCostEur)} ({t("admin.aiUsage.toolsCost")} {eur.format(totals.toolsCostEur)})
        </dd>
        <dt>{t("admin.aiUsage.toolCalls")}</dt>
        <dd>{number.format(totals.toolCalls)}</dd>
        <dt>{t("admin.aiUsage.externalCalls")}</dt>
        <dd>
          {number.format(totals.externalCalls)} ({t("admin.aiUsage.failureRate").toLowerCase()} {rate(totals.externalFailures, totals.externalCalls)})
        </dd>
        <dt>{t("admin.aiUsage.externalCost")}</dt>
        <dd>{eur.format(totals.externalCostEur)}</dd>
        <dt>{t("admin.aiUsage.totalCost")}</dt>
        <dd>
          <strong>{eur.format(totals.costEur)}</strong>
        </dd>
      </dl>

      {report.byModel.length === 0 ? (
        <p>{t("admin.aiUsage.none")}</p>
      ) : (
        <>
          <h2>{t("admin.aiUsage.byModelTitle")}</h2>
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiUsage.byModelCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.aiUsage.provider")}</th>
                  <th scope="col">{t("admin.aiUsage.endpoint")}</th>
                  <th scope="col">{t("admin.aiUsage.model")}</th>
                  {usageHeads}
                </tr>
              </thead>
              <tbody>
                {report.byModel.map((row) => (
                  <tr key={`${row.provider} ${row.endpoint} ${row.model}`}>
                    <th scope="row">{row.provider ?? t("admin.aiMessages.noProvider")}</th>
                    <td>{row.endpoint ?? "—"}</td>
                    <td>{row.model ?? "—"}</td>
                    {usageCells(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>{t("admin.aiUsage.byTaskTitle")}</h2>
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiUsage.byTaskCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.aiUsage.task")}</th>
                  {usageHeads}
                </tr>
              </thead>
              <tbody>
                {report.byTask.map((row) => (
                  <tr key={row.task}>
                    <th scope="row">{taskName(row.task)}</th>
                    {usageCells(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>{period.per === "month" ? t("admin.aiUsage.byMonthTitle") : t("admin.aiUsage.byDayTitle")}</h2>
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiUsage.byTimeCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{period.per === "month" ? t("admin.aiUsage.month") : t("admin.aiUsage.day")}</th>
                  {usageHeads}
                </tr>
              </thead>
              <tbody>
                {report.byTime.map((row) => (
                  <tr key={row.bucket}>
                    <th scope="row">
                      <time dateTime={row.bucket}>{bucketName(row.bucket)}</time>
                    </th>
                    {usageCells(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>{t("admin.aiUsage.reasonsTitle")}</h2>
      <p>{t("admin.aiUsage.reasonsIntro")}</p>
      {failureReasons.total.length === 0 ? (
        <p>{t("admin.aiUsage.noReasons")}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiUsage.reasonsCaption")}</caption>
              <thead>
                <tr>{reasonHeads}</tr>
              </thead>
              <tbody>
                {failureReasons.total.map((row) => (
                  <tr key={`${row.outcome} ${row.reason}`}>{reasonCells(row)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>{t("admin.aiUsage.reasonsByModelTitle")}</h3>
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiUsage.reasonsByModelCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.aiUsage.provider")}</th>
                  <th scope="col">{t("admin.aiUsage.model")}</th>
                  {reasonHeads}
                </tr>
              </thead>
              <tbody>
                {failureReasons.byModel.map((row) => (
                  <tr key={`${row.provider} ${row.model} ${row.outcome} ${row.reason}`}>
                    <th scope="row">{row.provider ?? t("admin.aiMessages.noProvider")}</th>
                    <td>{row.model ?? "—"}</td>
                    {reasonCells(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>{t("admin.aiUsage.reasonsByTaskTitle")}</h3>
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiUsage.reasonsByTaskCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.aiUsage.task")}</th>
                  {reasonHeads}
                </tr>
              </thead>
              <tbody>
                {failureReasons.byTask.map((row) => (
                  <tr key={`${row.task} ${row.outcome} ${row.reason}`}>
                    <th scope="row">{taskName(row.task)}</th>
                    {reasonCells(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>{t("admin.aiUsage.toolsTitle")}</h2>
      {report.tools.length === 0 ? (
        <p>{t("admin.aiUsage.noTools")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.aiUsage.toolsCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.aiUsage.tool")}</th>
                <th scope="col">{t("admin.aiUsage.provider")}</th>
                <th scope="col">{t("admin.aiUsage.uses")}</th>
                <th scope="col">{t("admin.aiUsage.failures")}</th>
                <th scope="col">{t("admin.aiUsage.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {report.tools.map((tool) => (
                <tr key={`${tool.provider} ${tool.name}`}>
                  <th scope="row">{tool.name}</th>
                  <td>{tool.provider}</td>
                  <td>{number.format(tool.calls)}</td>
                  <td>{number.format(tool.failures)}</td>
                  <td>{cost(tool.costEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{t("admin.aiUsage.externalTitle")}</h2>
      {report.externalApis.length === 0 ? (
        <p>{t("admin.aiUsage.noExternal")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.aiUsage.externalCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.aiUsage.provider")}</th>
                <th scope="col">{t("admin.aiUsage.operation")}</th>
                <th scope="col">{t("admin.aiUsage.calls")}</th>
                <th scope="col">{t("admin.aiUsage.failures")}</th>
                <th scope="col">{t("admin.aiUsage.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {report.externalApis.map((api) => (
                <tr key={`${api.provider} ${api.operation}`}>
                  <th scope="row">{api.provider}</th>
                  <td>
                    <code>{api.operation}</code>
                  </td>
                  <td>{number.format(api.calls)}</td>
                  <td>
                    {number.format(api.failures)} ({rate(api.failures, api.calls)})
                  </td>
                  <td>{cost(api.costEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BackOfficeLayout>
  );
}
