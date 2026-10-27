import { SEARCH_PROVIDER_IDS } from "@jobhub/ai";
import type { Locale } from "@jobhub/shared/i18n";
import Link from "next/link";
import type { ReactNode } from "react";
import type { JobDiscoveryDashboard } from "@/back-office-dashboard";
import { ChartTips } from "@/components/ChartTips";
import { getServerT } from "@/i18n/server";
import { settingHref } from "@/platform-settings/parametres";
import { routes } from "@/routes";

type T = Awaited<ReturnType<typeof getServerT>>;

/** A Search provider's name as its brand writes it. */
const PROVIDER_NAMES: Record<string, string> = { perplexity: "Perplexity", brave: "Brave", tavily: "Tavily" };
const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider;
/** A Search provider's colour follows the provider, never its rank: the catalog's order, any other last. */
const seriesOf = (provider: string) => {
  const slot = (SEARCH_PROVIDER_IDS as readonly string[]).indexOf(provider);
  return `chart-series-${slot < 0 ? SEARCH_PROVIDER_IDS.length + 1 : slot + 1}`;
};

/** A chart's scale top: `max` rounded up to a readable step, never 0. */
function scaleTop(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
}

/** A chart's table view, folded under it. */
function TableView({ t, caption, children }: { t: T; caption: string; children: ReactNode }) {
  return (
    <details className="chart-table">
      <summary>{t("admin.dashboard.tableView")}</summary>
      <div className="table-scroll">
        <table className="application-table">
          <caption>{caption}</caption>
          {children}
        </table>
      </div>
    </details>
  );
}

/** One horizontal bar per row, one hue: what each is, its bar against the largest, and its value in words. */
function BarList({ rows, max }: { rows: { key: string; label: string; value: string; amount: number; tip: string }[]; max: number }) {
  return (
    <div className="chart-bars">
      {rows.map((row, index) => (
        <div key={row.key} className="chart-bar-row" data-tip={row.tip} role="img" aria-label={row.tip.replace(/\n/g, " · ")} tabIndex={index === 0 ? 0 : -1}>
          <span className="chart-bar-label">{row.label}</span>
          <span className="chart-bar-track" aria-hidden="true">
            <span className="chart-bar chart-series-1" style={{ width: `${max > 0 ? (row.amount / max) * 100 : 0}%` }} />
          </span>
          <span className="chart-bar-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The Dashboard's Job discovery block (#408): this month's web search spend against its alert threshold, what a run
 * costs against its budget and per new Job Offer, the runs that fell back, the failed AI calls; then the daily spend
 * per Search provider, the month to date against the threshold, why runs stop and where a run's cost goes. Each chart
 * has hover tooltips and a table view; one axis each.
 */
export async function JobDiscoveryBlock({ figures, locale }: { figures: JobDiscoveryDashboard; locale: Locale }) {
  const t = await getServerT(locale);
  const { webSearch, runs, calls } = figures;
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fine = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const dayName = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
  const share = (part: number, whole: number) => (whole > 0 ? percent.format(part / whole) : t("admin.dashboard.jobDiscovery.noValue"));
  const tipOf = (lines: string[]) => ({ "data-tip": lines.join("\n"), role: "img", "aria-label": lines.join(" · ") });

  // The whole month on the x axis: the days to come are empty.
  const monthDays = Array.from({ length: figures.daysInMonth }, (_, index) => webSearch.days[index] ?? null);
  const dayTicks = new Set([1, 5, 10, 15, 20, 25, 30]);
  const dailyTop = scaleTop(Math.max(0, ...webSearch.days.map((day) => day.totalEur)));
  const cumulativeTop = scaleTop(Math.max(webSearch.thresholdEur, webSearch.monthEndEstimateEur, webSearch.spendEur) * 1.1);
  const y = (eurValue: number) => 100 - (eurValue / cumulativeTop) * 100;
  const points = webSearch.days.map((day, index) => `${index + 0.5},${y(day.cumulativeEur)}`).join(" ");
  const last = webSearch.days.at(-1);
  const thresholdShare = webSearch.thresholdEur > 0 ? webSearch.spendEur / webSearch.thresholdEur : null;
  const stopTotal = runs.stopReasons.reduce((sum, row) => sum + row.runs, 0);
  const itemsTotal = runs.averageCostByItem.reduce((sum, row) => sum + row.eur, 0);
  const axis = (top: number, format: (value: number) => string) => (
    <div className="chart-axis" aria-hidden="true">
      {[top, top / 2, 0].map((value) => (
        <span key={value} style={{ bottom: `${(value / top) * 100}%` }}>
          {format(value)}
        </span>
      ))}
    </div>
  );
  const xTicks = (
    <div className="chart-x" aria-hidden="true">
      {monthDays.map((_, index) => (
        <span key={index}>{dayTicks.has(index + 1) ? index + 1 : ""}</span>
      ))}
    </div>
  );

  return (
    <section className="dashboard-block stack" aria-labelledby="dashboard-job-discovery">
      <h2 id="dashboard-job-discovery">
        {t("admin.dashboard.jobDiscovery.title")} <span className="dashboard-period">· {t("admin.dashboard.jobDiscovery.period", { month: monthName.format(dateOf(`${figures.month}-01`)), day: figures.daysSoFar })}</span>
      </h2>

      <dl className="kpis">
        <div className="kpi">
          <dt>{t("admin.dashboard.jobDiscovery.webSpend")}</dt>
          <dd className="kpi-value">{eur.format(webSearch.spendEur)}</dd>
          <dd className="kpi-sub">{thresholdShare === null ? t("admin.dashboard.jobDiscovery.noThreshold") : t("admin.dashboard.jobDiscovery.ofThreshold", { percent: percent.format(thresholdShare), threshold: eur.format(webSearch.thresholdEur) })}</dd>
          {thresholdShare === null ? null : (
            <dd className="kpi-bar" aria-hidden="true">
              <span className={thresholdShare >= 1 ? "kpi-bar-crossed" : undefined} style={{ width: `${Math.min(100, thresholdShare * 100)}%` }} />
            </dd>
          )}
        </div>
        <div className="kpi">
          <dt>{t("admin.dashboard.jobDiscovery.averageRun")}</dt>
          <dd className="kpi-value">{runs.averageCostEur === null ? t("admin.dashboard.jobDiscovery.noValue") : fine.format(runs.averageCostEur)}</dd>
          <dd className="kpi-sub">{t("admin.dashboard.jobDiscovery.ofBudget", { budget: fine.format(runs.budgetEur), percent: runs.averageCostEur === null ? t("admin.dashboard.jobDiscovery.noValue") : share(runs.averageCostEur, runs.budgetEur) })}</dd>
        </div>
        <div className="kpi">
          <dt>{t("admin.dashboard.jobDiscovery.costPerNewOffer")}</dt>
          <dd className="kpi-value">{runs.costPerNewJobOfferEur === null ? t("admin.dashboard.jobDiscovery.noValue") : fine.format(runs.costPerNewJobOfferEur)}</dd>
          <dd className="kpi-sub">{t("admin.dashboard.jobDiscovery.newOffers", { count: runs.newJobOffers })}</dd>
        </div>
        <div className="kpi">
          <dt>{t("admin.dashboard.jobDiscovery.runs")}</dt>
          <dd className="kpi-value">{number.format(runs.count)}</dd>
          <dd className="kpi-sub">{t("admin.dashboard.jobDiscovery.runsSub")}</dd>
        </div>
        <div className="kpi">
          <dt>{t("admin.dashboard.jobDiscovery.fellBack")}</dt>
          <dd className="kpi-value">{share(runs.fellBack, runs.count)}</dd>
          <dd className="kpi-sub">{t("admin.dashboard.jobDiscovery.fellBackSub", { count: runs.fellBack })}</dd>
        </div>
        <div className="kpi">
          <dt>{t("admin.dashboard.jobDiscovery.failedCalls")}</dt>
          <dd className="kpi-value">{share(calls.failures, calls.calls)}</dd>
          <dd className="kpi-sub">{t("admin.dashboard.jobDiscovery.failedCallsSub", { failures: number.format(calls.failures), calls: number.format(calls.calls) })}</dd>
          {calls.unpricedTools > 0 ? (
            <dd className="kpi-sub kpi-warning">
              <Link prefetch={false} href={routes.adminAiUsage(figures.month)}>
                {t("admin.dashboard.jobDiscovery.unpricedTools", { count: calls.unpricedTools })}
              </Link>
            </dd>
          ) : null}
        </div>
      </dl>

      <figure className="chart">
        <figcaption>{t("admin.dashboard.jobDiscovery.dailyTitle")}</figcaption>
        {webSearch.providers.length === 0 ? (
          <p>{t("admin.dashboard.jobDiscovery.noSpend")}</p>
        ) : (
          <>
            <ul className="chart-legend">
              {webSearch.providers.map((provider) => (
                <li key={provider}>
                  <span className={`chart-swatch ${seriesOf(provider)}`} aria-hidden="true" />
                  {providerName(provider)}
                </li>
              ))}
            </ul>
            <ChartTips label={t("admin.dashboard.jobDiscovery.dailyTitle")}>
              <div className="chart-plot">
                {axis(dailyTop, (value) => eur.format(value))}
                <div className="chart-columns" style={{ gridTemplateColumns: `repeat(${figures.daysInMonth}, 1fr)` }}>
                  {monthDays.map((day, index) =>
                    day ? (
                      <div
                        key={day.day}
                        className="chart-column"
                        tabIndex={index === 0 ? 0 : -1}
                        {...tipOf([dayName.format(dateOf(day.day)), ...webSearch.providers.map((provider) => `${providerName(provider)} ${fine.format(day.byProvider[provider] ?? 0)}`)])}
                      >
                        {webSearch.providers.map((provider) =>
                          (day.byProvider[provider] ?? 0) > 0 ? (
                            <span key={provider} className={`chart-segment ${seriesOf(provider)}`} style={{ height: `${((day.byProvider[provider] ?? 0) / dailyTop) * 100}%` }} />
                          ) : null,
                        )}
                      </div>
                    ) : (
                      <div key={index} className="chart-column" aria-hidden="true" />
                    ),
                  )}
                </div>
              </div>
              {xTicks}
            </ChartTips>
          </>
        )}
        <TableView t={t} caption={t("admin.dashboard.jobDiscovery.dailyTitle")}>
          <thead>
            <tr>
              <th scope="col">{t("admin.dashboard.jobDiscovery.day")}</th>
              {webSearch.providers.map((provider) => (
                <th key={provider} scope="col">
                  {providerName(provider)}
                </th>
              ))}
              <th scope="col">{t("admin.dashboard.jobDiscovery.total")}</th>
            </tr>
          </thead>
          <tbody>
            {webSearch.days.map((day) => (
              <tr key={day.day}>
                <th scope="row">
                  <time dateTime={day.day}>{dayName.format(dateOf(day.day))}</time>
                </th>
                {webSearch.providers.map((provider) => (
                  <td key={provider}>{fine.format(day.byProvider[provider] ?? 0)}</td>
                ))}
                <td>{fine.format(day.totalEur)}</td>
              </tr>
            ))}
          </tbody>
        </TableView>
      </figure>

      <div className="dashboard-pair">
        <figure className="chart">
          <figcaption>{t("admin.dashboard.jobDiscovery.cumulativeTitle")}</figcaption>
          <p className="chart-note">
            {t("admin.dashboard.jobDiscovery.cumulativeNow", { spend: eur.format(webSearch.spendEur), day: last ? dayName.format(dateOf(last.day)) : "", estimate: eur.format(webSearch.monthEndEstimateEur) })}
          </p>
          <ChartTips label={t("admin.dashboard.jobDiscovery.cumulativeTitle")}>
            <div className="chart-plot">
              {axis(cumulativeTop, (value) => eur.format(value))}
              <svg className="chart-lines" viewBox={`0 0 ${figures.daysInMonth} 100`} preserveAspectRatio="none" aria-hidden="true">
                {webSearch.thresholdEur > 0 ? <line className="chart-threshold" x1={0} x2={figures.daysInMonth} y1={y(webSearch.thresholdEur)} y2={y(webSearch.thresholdEur)} /> : null}
                {last ? <line className="chart-estimate" x1={webSearch.days.length - 0.5} y1={y(last.cumulativeEur)} x2={figures.daysInMonth - 0.5} y2={y(webSearch.monthEndEstimateEur)} /> : null}
                <polyline className="chart-line chart-series-1" points={points} />
              </svg>
              {webSearch.thresholdEur > 0 ? (
                <span className="chart-threshold-label" aria-hidden="true" style={{ bottom: `${100 - y(webSearch.thresholdEur)}%` }}>
                  {t("admin.dashboard.jobDiscovery.thresholdLine", { threshold: eur.format(webSearch.thresholdEur) })}
                </span>
              ) : null}
              <div className="chart-columns" style={{ gridTemplateColumns: `repeat(${figures.daysInMonth}, 1fr)` }}>
                {monthDays.map((day, index) =>
                  day ? (
                    <div key={day.day} className="chart-column chart-hit" tabIndex={index === 0 ? 0 : -1} {...tipOf([dayName.format(dateOf(day.day)), `${t("admin.dashboard.jobDiscovery.cumulative")} ${eur.format(day.cumulativeEur)}`])} />
                  ) : (
                    <div key={index} className="chart-column" aria-hidden="true" />
                  ),
                )}
              </div>
            </div>
            {xTicks}
          </ChartTips>
          <ul className="chart-legend">
            <li>
              <span className="chart-swatch chart-series-1" aria-hidden="true" />
              {t("admin.dashboard.jobDiscovery.cumulative")}
            </li>
            <li>
              <span className="chart-swatch chart-swatch-dashed" aria-hidden="true" />
              {t("admin.dashboard.jobDiscovery.estimateLine")}
            </li>
            {webSearch.thresholdEur > 0 ? (
              <li>
                <span className="chart-swatch chart-swatch-threshold" aria-hidden="true" />
                {t("admin.dashboard.jobDiscovery.thresholdLine", { threshold: eur.format(webSearch.thresholdEur) })}
              </li>
            ) : null}
          </ul>
          <TableView t={t} caption={t("admin.dashboard.jobDiscovery.cumulativeTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("admin.dashboard.jobDiscovery.day")}</th>
                <th scope="col">{t("admin.dashboard.jobDiscovery.cumulative")}</th>
              </tr>
            </thead>
            <tbody>
              {webSearch.days.map((day) => (
                <tr key={day.day}>
                  <th scope="row">
                    <time dateTime={day.day}>{dayName.format(dateOf(day.day))}</time>
                  </th>
                  <td>{fine.format(day.cumulativeEur)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">{t("admin.dashboard.jobDiscovery.estimateLine")}</th>
                <td>{fine.format(webSearch.monthEndEstimateEur)}</td>
              </tr>
            </tbody>
          </TableView>
        </figure>

        <figure className="chart">
          <figcaption>{t("admin.dashboard.jobDiscovery.stopsTitle")}</figcaption>
          <p className="chart-note">{t("admin.dashboard.jobDiscovery.runsThisMonth", { count: runs.count })}</p>
          {stopTotal === 0 ? (
            <p>{t("admin.dashboard.jobDiscovery.noRuns")}</p>
          ) : (
            <ChartTips label={t("admin.dashboard.jobDiscovery.stopsTitle")}>
              <BarList
                max={Math.max(...runs.stopReasons.map((row) => row.runs))}
                rows={runs.stopReasons.map((row) => {
                  const label = t(`admin.dashboard.jobDiscovery.stopReasons.${row.reason}`);
                  const value = share(row.runs, stopTotal);
                  return { key: row.reason, label, value, amount: row.runs, tip: `${label}\n${t("admin.dashboard.jobDiscovery.runsShare", { count: row.runs, percent: value })}` };
                })}
              />
            </ChartTips>
          )}
          <TableView t={t} caption={t("admin.dashboard.jobDiscovery.stopsTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("admin.dashboard.jobDiscovery.reason")}</th>
                <th scope="col">{t("admin.dashboard.jobDiscovery.runs")}</th>
                <th scope="col">{t("admin.dashboard.jobDiscovery.share")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.stopReasons.map((row) => (
                <tr key={row.reason}>
                  <th scope="row">{t(`admin.dashboard.jobDiscovery.stopReasons.${row.reason}`)}</th>
                  <td>{number.format(row.runs)}</td>
                  <td>{share(row.runs, stopTotal)}</td>
                </tr>
              ))}
            </tbody>
          </TableView>
        </figure>
      </div>

      <figure className="chart">
        <figcaption>{t("admin.dashboard.jobDiscovery.itemsTitle")}</figcaption>
        {runs.itemizedRuns === 0 ? (
          <p>{t("admin.dashboard.jobDiscovery.noItems")}</p>
        ) : (
          <>
            <p className="chart-note">{t("admin.dashboard.jobDiscovery.itemsSub", { count: runs.itemizedRuns })}</p>
            <ChartTips label={t("admin.dashboard.jobDiscovery.itemsTitle")}>
              <BarList
                max={Math.max(...runs.averageCostByItem.map((row) => row.eur))}
                rows={runs.averageCostByItem.map((row) => {
                  const label = t(`admin.dashboard.jobDiscovery.items.${row.item}`);
                  return { key: row.item, label, value: fine.format(row.eur), amount: row.eur, tip: `${label}\n${t("admin.dashboard.jobDiscovery.perRun", { cost: fine.format(row.eur), percent: share(row.eur, itemsTotal) })}` };
                })}
              />
            </ChartTips>
          </>
        )}
        <TableView t={t} caption={t("admin.dashboard.jobDiscovery.itemsTitle")}>
          <thead>
            <tr>
              <th scope="col">{t("admin.dashboard.jobDiscovery.item")}</th>
              <th scope="col">{t("admin.dashboard.jobDiscovery.averageCost")}</th>
              <th scope="col">{t("admin.dashboard.jobDiscovery.share")}</th>
            </tr>
          </thead>
          <tbody>
            {runs.averageCostByItem.map((row) => (
              <tr key={row.item}>
                <th scope="row">{t(`admin.dashboard.jobDiscovery.items.${row.item}`)}</th>
                <td>{fine.format(row.eur)}</td>
                <td>{share(row.eur, itemsTotal)}</td>
              </tr>
            ))}
          </tbody>
        </TableView>
      </figure>

      <ul className="dashboard-links">
        <li>
          <Link prefetch={false} href={routes.adminAiUsage(figures.month)}>
            {t("admin.dashboard.jobDiscovery.aiUsageLink")}
          </Link>
        </li>
        <li>
          <Link prefetch={false} href={settingHref("WEB_SEARCH_MONTHLY_ALERT_EUR")}>
            {t("admin.dashboard.jobDiscovery.webSearchSettingsLink")}
          </Link>
        </li>
        <li>
          <Link prefetch={false} href={settingHref("JOB_DISCOVERY_BUDGET_EUR")}>
            {t("admin.dashboard.jobDiscovery.budgetSettingsLink")}
          </Link>
        </li>
      </ul>
    </section>
  );
}
