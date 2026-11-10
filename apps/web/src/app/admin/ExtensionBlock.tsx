import type { Locale } from "@jobhub/shared/i18n";
import Link from "next/link";
import { ChartTips } from "@/components/ChartTips";
import { ExplainableLabel, type ExplainedContext } from "@/components/ExplainableLabel";
import { FigureCard, Stat, Stats } from "@/design/Card";
import type { ExtensionDashboard, ExtensionDashboardDay } from "@/extension-events/back-office";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { BarList, scaleTop, TableView } from "./dashboard-charts";

/** A Dashboard figure, as an Explainable label tells the Back Office Assistant about it (#407). */
const FIGURE: Pick<ExplainedContext, "kind"> = { kind: "figure" };
/** The card's figures, by their key in code. */
const FIGURES = {
  captures: "extension_captures",
  matchScores: "extension_match_scores",
  applications: "extension_applications",
  activeCandidates: "extension_active_candidates",
  errors: "extension_errors",
} as const;
/** The days whose day of the month the x axis shows: one a week, today the last. */
const TICK_EVERY = 7;

/**
 * The Dashboard's Extension card (#925): what the extension did over the last 30 days, Paris time: its Captures (by
 * Candidates, by Guests), Match Scores, Applications created from it, the Candidates active in it (distinct) and its
 * errors; then the Captures and the errors day by day, the Extension Versions in service and the 5 domains with the most
 * pages that cannot be captured. Each chart has hover tooltips and a table view; the full daily figures are in the
 * Captures chart's.
 */
export async function ExtensionBlock({ figures, locale }: { figures: ExtensionDashboard; locale: Locale }) {
  const t = await getServerT(locale);
  const { days, totals, versions, captureImpossibleDomains } = figures;
  const number = new Intl.NumberFormat(locale);
  const dayName = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dayLabel = (day: string) => dayName.format(new Date(`${day}T00:00:00Z`));
  const tipOf = (lines: string[]) => ({ "data-tip": lines.join("\n"), role: "img", "aria-label": lines.join(" · ") });
  const captures = (day: ExtensionDashboardDay) => day.captures.candidate + day.captures.guest;
  const hasCaptures = days.some((day) => captures(day) > 0);
  const hasErrors = totals.errors > 0;
  const capturesTop = scaleTop(Math.max(0, ...days.map(captures)));
  const errorsTop = scaleTop(Math.max(0, ...days.map((day) => day.errors)));
  const candidates = t("admin.dashboard.extension.candidates");
  const guests = t("admin.dashboard.extension.guests");
  const versionName = (version: string | null) => version ?? t("admin.dashboard.extension.unknownVersion");

  const kpis = [
    {
      id: FIGURES.captures,
      label: t("admin.dashboard.extension.captures"),
      value: number.format(totals.captures.candidate + totals.captures.guest),
      sub: t("admin.dashboard.extension.capturesSub", { candidate: number.format(totals.captures.candidate), guest: number.format(totals.captures.guest) }),
    },
    { id: FIGURES.matchScores, label: t("admin.dashboard.extension.matchScores"), value: number.format(totals.matchScores), sub: t("admin.dashboard.extension.matchScoresSub") },
    { id: FIGURES.applications, label: t("admin.dashboard.extension.applications"), value: number.format(totals.applications), sub: t("admin.dashboard.extension.applicationsSub") },
    { id: FIGURES.activeCandidates, label: t("admin.dashboard.extension.activeCandidates"), value: number.format(totals.activeCandidates), sub: t("admin.dashboard.extension.activeCandidatesSub") },
    { id: FIGURES.errors, label: t("admin.dashboard.extension.errors"), value: number.format(totals.errors), sub: t("admin.dashboard.extension.errorsSub") },
  ];

  const axis = (top: number) => (
    <div className="chart-axis" aria-hidden="true">
      {[top, top / 2, 0].map((value) => (
        <span key={value} style={{ bottom: `${(value / top) * 100}%` }}>
          {number.format(value)}
        </span>
      ))}
    </div>
  );
  const xTicks = (
    <div className="chart-x" aria-hidden="true">
      {days.map((day, index) => (
        <span key={day.day}>{(days.length - 1 - index) % TICK_EVERY === 0 ? Number(day.day.slice(8)) : ""}</span>
      ))}
    </div>
  );
  const columns = { gridTemplateColumns: `repeat(${days.length}, 1fr)` };

  return (
    <section className="dashboard-block stack" aria-labelledby="dashboard-extension">
      <h2 id="dashboard-extension">
        {t("admin.dashboard.extension.title")} <span className="dashboard-period">· {t("admin.dashboard.extension.period")}</span>
      </h2>

      <Stats>
        {kpis.map((kpi) => (
          <Stat
            key={kpi.id}
            label={<ExplainableLabel item={{ ...FIGURE, id: kpi.id, value: kpi.value, state: kpi.sub }}>{kpi.label}</ExplainableLabel>}
            name={kpi.label}
            value={kpi.value}
            meta={kpi.sub}
          />
        ))}
      </Stats>

      {/* The daily charts take the whole width: the Captures' table view holds every daily figure. */}
      <FigureCard className="chart" caption={t("admin.dashboard.extension.capturesTitle")}>
        {hasCaptures ? (
          <>
            <ul className="chart-legend">
              <li>
                <span className="chart-swatch chart-series-1" aria-hidden="true" />
                {candidates}
              </li>
              <li>
                <span className="chart-swatch chart-series-2" aria-hidden="true" />
                {guests}
              </li>
            </ul>
            <ChartTips label={t("admin.dashboard.extension.capturesTitle")}>
              <div className="chart-plot">
                {axis(capturesTop)}
                <div className="chart-columns" style={columns}>
                  {days.map((day, index) => (
                    <div
                      key={day.day}
                      className="chart-column"
                      tabIndex={index === days.length - 1 ? 0 : -1}
                      {...tipOf([dayLabel(day.day), `${candidates} ${number.format(day.captures.candidate)}`, `${guests} ${number.format(day.captures.guest)}`])}
                    >
                      {day.captures.candidate > 0 ? <span className="chart-segment chart-series-1" style={{ height: `${(day.captures.candidate / capturesTop) * 100}%` }} /> : null}
                      {day.captures.guest > 0 ? <span className="chart-segment chart-series-2" style={{ height: `${(day.captures.guest / capturesTop) * 100}%` }} /> : null}
                    </div>
                  ))}
                </div>
              </div>
              {xTicks}
            </ChartTips>
          </>
        ) : (
          <p>{t("admin.dashboard.extension.noActivity")}</p>
        )}
        <TableView
          t={t}
          caption={t("admin.dashboard.extension.capturesTitle")}
          columns={[
            { header: t("admin.dashboard.extension.day"), rowHeader: true, cell: (day) => <time dateTime={day.day}>{dayLabel(day.day)}</time> },
            { header: candidates, numeric: true, cell: (day) => number.format(day.captures.candidate) },
            { header: guests, numeric: true, cell: (day) => number.format(day.captures.guest) },
            { header: t("admin.dashboard.extension.matchScores"), numeric: true, cell: (day) => number.format(day.matchScores) },
            { header: t("admin.dashboard.extension.applications"), numeric: true, cell: (day) => number.format(day.applications) },
            { header: t("admin.dashboard.extension.activeCandidates"), numeric: true, cell: (day) => number.format(day.activeCandidates) },
            { header: t("admin.dashboard.extension.versions"), cell: (day) => day.versions.join(", ") },
            { header: t("admin.dashboard.extension.errors"), numeric: true, cell: (day) => number.format(day.errors) },
          ]}
          rows={days}
          rowKey={(day) => day.day}
        />
      </FigureCard>

      <FigureCard className="chart" caption={t("admin.dashboard.extension.errorsTitle")}>
        {hasErrors ? (
          <ChartTips label={t("admin.dashboard.extension.errorsTitle")}>
            <div className="chart-plot">
              {axis(errorsTop)}
              <div className="chart-columns" style={columns}>
                {days.map((day, index) => (
                  <div key={day.day} className="chart-column" tabIndex={index === days.length - 1 ? 0 : -1} {...tipOf([dayLabel(day.day), `${t("admin.dashboard.extension.errors")} ${number.format(day.errors)}`])}>
                    {day.errors > 0 ? <span className="chart-segment chart-series-1" style={{ height: `${(day.errors / errorsTop) * 100}%` }} /> : null}
                  </div>
                ))}
              </div>
            </div>
            {xTicks}
          </ChartTips>
        ) : (
          <p>{t("admin.dashboard.extension.noActivity")}</p>
        )}
        <TableView
          t={t}
          caption={t("admin.dashboard.extension.errorsTitle")}
          columns={[
            { header: t("admin.dashboard.extension.day"), rowHeader: true, cell: (day) => <time dateTime={day.day}>{dayLabel(day.day)}</time> },
            { header: t("admin.dashboard.extension.errors"), numeric: true, cell: (day) => number.format(day.errors) },
          ]}
          rows={days}
          rowKey={(day) => day.day}
        />
      </FigureCard>

      <div className="dashboard-pair">
        <FigureCard className="chart" caption={t("admin.dashboard.extension.versionsTitle")}>
          {versions.length === 0 ? (
            <p>{t("admin.dashboard.extension.noVersions")}</p>
          ) : (
            <ChartTips label={t("admin.dashboard.extension.versionsTitle")}>
              <BarList
                max={Math.max(...versions.map((row) => row.events))}
                rows={versions.map((row) => {
                  const label = versionName(row.version);
                  const value = t("admin.dashboard.extension.versionEvents", { count: row.events });
                  return { key: row.version ?? "", label, value, amount: row.events, tip: `${label}\n${value}` };
                })}
              />
            </ChartTips>
          )}
          <TableView
            t={t}
            caption={t("admin.dashboard.extension.versionsTitle")}
            columns={[
              { header: t("admin.dashboard.extension.versions"), rowHeader: true, cell: (row) => versionName(row.version) },
              { header: t("admin.dashboard.extension.events"), numeric: true, cell: (row) => number.format(row.events) },
            ]}
            rows={versions}
            rowKey={(row) => row.version ?? ""}
          />
        </FigureCard>

        <FigureCard className="chart" caption={t("admin.dashboard.extension.domainsTitle")}>
          {captureImpossibleDomains.length === 0 ? (
            <p>{t("admin.dashboard.extension.noDomains")}</p>
          ) : (
            <ChartTips label={t("admin.dashboard.extension.domainsTitle")}>
              <BarList
                max={Math.max(...captureImpossibleDomains.map((row) => row.errors))}
                rows={captureImpossibleDomains.map((row) => {
                  const value = t("admin.dashboard.extension.domainErrors", { count: row.errors });
                  return { key: row.domain, label: row.domain, value, amount: row.errors, tip: `${row.domain}\n${value}` };
                })}
              />
            </ChartTips>
          )}
          <TableView
            t={t}
            caption={t("admin.dashboard.extension.domainsTitle")}
            columns={[
              { header: t("admin.dashboard.extension.domain"), rowHeader: true, cell: (row) => row.domain },
              { header: t("admin.dashboard.extension.errors"), numeric: true, cell: (row) => number.format(row.errors) },
            ]}
            rows={captureImpossibleDomains}
            rowKey={(row) => row.domain}
          />
        </FigureCard>
      </div>

      <ul className="dashboard-links">
        <li>
          <Link prefetch={false} href={routes.adminExtensionEvents()}>
            {t("admin.dashboard.extension.link")}
          </Link>
        </li>
      </ul>
    </section>
  );
}
