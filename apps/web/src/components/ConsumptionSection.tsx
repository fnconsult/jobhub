"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ConsumptionDayView, ConsumptionSectionView, ConsumptionToolLine } from "@/consumption/section";
import { SegmentedControl } from "@/design/Field";
import { Pill } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { ChartTips } from "./ChartTips";
import "@/design/Card.css";
import "./ConsumptionSection.css";

/** The anchor the Activité links to (`/abonnement#consommation`, ADR-0086), and its title's. */
export const CONSUMPTION_ANCHOR = "consommation";
/** Where this browser remembers « Grille » or « Barres »: a per-viewer convenience, the grid when it cannot be read. */
export const CONSUMPTION_VIEW_KEY = "jobbbox.consumption.view";

const VIEWS = ["grid", "bars"] as const;
type View = (typeof VIEWS)[number];

// The view chosen, remembered in this browser (and in memory when its storage is blocked); the grid on the server.
const listeners = new Set<() => void>();
let chosenHere: View | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function rememberedView(): View {
  try {
    const stored = localStorage.getItem(CONSUMPTION_VIEW_KEY);
    return stored === "bars" || stored === "grid" ? stored : (chosenHere ?? "grid");
  } catch {
    return chosenHere ?? "grid";
  }
}

const serverView = (): View => "grid";

function remember(view: View) {
  try {
    localStorage.setItem(CONSUMPTION_VIEW_KEY, view);
  } catch {
    // Private window or blocked storage: the choice lasts as long as the page.
    chosenHere = view;
  }
  listeners.forEach((listener) => listener());
}

/** « Le détail … est dans {{activity}}. » with a link where its placeholder is. */
function withLink(text: string, placeholder: string, link: ReactNode): ReactNode {
  const at = text.indexOf(placeholder);
  return at < 0 ? text : (
    <>
      {text.slice(0, at)}
      {link}
      {text.slice(at + placeholder.length)}
    </>
  );
}

const MARKER = "\u0001";

/**
 * « Votre consommation » (#801, ADR-0091), on Mon abonnement between the summary and the Plans: the billing period's
 * AI actions and their change, the period's progress, then day by day (« Grille », the 12 months GitHub-style, opening
 * on the latest weeks with the current period outlined, or « Barres », the period stacked by Tool, remembered in this
 * browser), « Voir en tableau » with the same figures, the list per Tool and its foot. Hovering or focusing a day
 * shows its date and each Tool's count (ChartTips: one tab stop, the arrow keys move between days). The page builds
 * `view` (consumptionSection); this draws it. Its Card is `#consommation`, focused when the address names it.
 */
export function ConsumptionSection({ view, links }: { view: ConsumptionSectionView; links: { dataExport: string; aiActivity: string } }) {
  const { t } = useTranslation();
  const shown = useSyncExternalStore(subscribe, rememberedView, serverView);
  const [table, setTable] = useState(false);
  const section = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The grid opens on its latest weeks, scrolled to the right on a narrow screen.
  useEffect(() => {
    if (shown === "grid" && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [shown]);

  // `/abonnement#consommation` (the Activité's link): the Card takes the focus.
  useEffect(() => {
    const focusAnchor = () => {
      if (window.location.hash === `#${CONSUMPTION_ANCHOR}`) section.current?.focus();
    };
    focusAnchor();
    window.addEventListener("hashchange", focusAnchor);
    return () => window.removeEventListener("hashchange", focusAnchor);
  }, []);

  const choose = remember;

  const tipOf = (day: ConsumptionDayView) => {
    const title = day.inPeriod ? `${day.label} · ${t("billing.consumption.inPeriod")}` : day.label;
    const lines = view.series.map((series, index) => t("billing.consumption.tipLine", { series: series.label, count: day.counts[index] }));
    return [title, ...lines, t("billing.consumption.dayTotal", { count: day.total, number: day.total })].join("\n");
  };
  const markOf = (day: ConsumptionDayView, focusable: boolean) => {
    const tip = tipOf(day);
    return { "data-tip": tip, "aria-label": tip.replace(/\n/g, " · "), role: "img", tabIndex: focusable ? 0 : -1 };
  };

  const tableRows = (shown === "grid" ? view.grid.weeks.flat().filter((day): day is ConsumptionDayView => day !== null) : view.bars.days).filter((day) => day.total > 0);
  const columns: Column<ConsumptionDayView>[] = [
    { key: "day", header: t("billing.consumption.tableDay"), rowHeader: true, cell: (day) => day.label },
    ...view.series.map((series, index) => ({ key: series.key, header: series.label, numeric: true, cell: (day: ConsumptionDayView) => day.counts[index] })),
    { key: "total", header: t("billing.consumption.tableTotal"), numeric: true, cell: (day) => day.total },
  ];
  const tableLabel = t(shown === "grid" ? "billing.consumption.tableYear" : "billing.consumption.tablePeriod");
  const lastDay = view.grid.weeks.flat().filter((day) => day !== null).at(-1)?.day;
  const lastBar = view.bars.days.filter((day) => !day.future).at(-1)?.day;

  return (
    <section ref={section} className="ds-card consumption" id={CONSUMPTION_ANCHOR} aria-labelledby={`${CONSUMPTION_ANCHOR}-title`} tabIndex={-1}>
      <div className="consumption-head">
        <h3 className="ds-card__title" id={`${CONSUMPTION_ANCHOR}-title`}>
          {t("billing.consumption.title")}
        </h3>
        <p className="consumption-period">{view.periodLabel}</p>
      </div>

      <div className="consumption-hero">
        <div>
          <p className="consumption-total">
            <span className="consumption-total-number">{view.totalNumber}</span> <span className="consumption-total-unit">{view.totalUnit}</span>
          </p>
          {view.change ? <p className="consumption-change">{view.change}</p> : null}
        </div>
        <div className="consumption-progress">
          <p>{view.progress.text}</p>
          <span className="consumption-progress-track" role="progressbar" aria-label={view.progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progress.percent}>
            <span style={{ width: `${view.progress.percent}%` }} />
          </span>
          <p className="consumption-progress-ends">
            <span>{view.progress.start}</span>
            <span>{view.progress.end}</span>
          </p>
        </div>
      </div>

      <div className="consumption-daily-head">
        <h4>{t(shown === "grid" ? "billing.consumption.dailyYear" : "billing.consumption.dailyPeriod")}</h4>
        <SegmentedControl label={t("billing.consumption.view")} value={shown} onValueChange={choose} options={VIEWS.map((value) => ({ value, label: t(`billing.consumption.${value}`) }))} />
      </div>

      {shown === "grid" ? (
        <>
          <ChartTips label={t("billing.consumption.gridLabel")}>
            <div ref={scroller} className="consumption-grid-scroll">
              <div className="consumption-grid">
                <div className="consumption-weekdays" aria-hidden="true">
                  <span className="consumption-month" />
                  {view.grid.weekdays.map((name, index) => (
                    <span key={index}>{name}</span>
                  ))}
                </div>
                {view.grid.weeks.map((week, index) => (
                  <div key={index} className="consumption-week">
                    <span className="consumption-month" aria-hidden="true">
                      <span>{view.grid.months.find((month) => month.week === index)?.label}</span>
                    </span>
                    {week.map((day, row) =>
                      day ? (
                        <span key={day.day} className="consumption-cell" data-day={day.day} data-level={day.level} data-in-period={day.inPeriod || undefined} {...markOf(day, day.day === lastDay)} />
                      ) : (
                        <span key={row} className="consumption-cell" data-empty aria-hidden="true" />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </ChartTips>
          <div className="consumption-key" aria-hidden="true">
            <span>
              {t("billing.consumption.less")}
              {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className="consumption-cell" data-level={level} />
              ))}
              {t("billing.consumption.more")}
            </span>
            <span>
              <span className="consumption-cell" data-level={0} data-in-period />
              {t("billing.consumption.currentPeriod")}
            </span>
          </div>
        </>
      ) : (
        <>
          <ChartTips label={t("billing.consumption.barsLabel")}>
            <div className="consumption-bars">
              <span className="consumption-bars-max" aria-hidden="true">
                {view.bars.max}
              </span>
              <div className="consumption-bars-plot" style={{ gridTemplateColumns: `repeat(${view.bars.days.length}, minmax(0, 1fr))` }}>
                {view.bars.days.map((day) =>
                  day.future ? (
                    <span key={day.day} className="consumption-bar" data-bar data-future aria-hidden="true" />
                  ) : (
                    <span key={day.day} className="consumption-bar" data-bar data-day={day.day} {...markOf(day, day.day === lastBar)}>
                      {day.counts.map((count, index) =>
                        count > 0 ? <span key={index} className={`consumption-segment consumption-series-${index + 1}`} style={{ height: `${view.bars.max ? (count / view.bars.max) * 100 : 0}%` }} /> : null,
                      )}
                    </span>
                  ),
                )}
              </div>
              <div className="consumption-bars-axis" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${view.bars.days.length}, minmax(0, 1fr))` }}>
                {view.bars.days.map((day, index) => (
                  <span key={day.day}>{index % 7 === 0 ? day.short : ""}</span>
                ))}
              </div>
            </div>
          </ChartTips>
          <ul className="consumption-legend" aria-label={t("billing.consumption.legend")}>
            {view.series.map((series, index) => (
              <li key={series.key}>
                <span className={`consumption-swatch consumption-series-${index + 1}`} aria-hidden="true" />
                {series.label}
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="consumption-table-toggle" aria-expanded={table} onClick={() => setTable(!table)}>
        {t(table ? "billing.consumption.hideTable" : "billing.consumption.showTable")}
      </button>
      {table ? tableRows.length > 0 ? <Table label={tableLabel} columns={columns} rows={tableRows} rowKey={(day) => day.day} /> : <p>{t("billing.consumption.tableEmpty")}</p> : null}

      <h4>{t(view.free ? "billing.consumption.byToolMonth" : "billing.consumption.byTool")}</h4>
      <ul className="consumption-tools" aria-label={t(view.free ? "billing.consumption.byToolMonth" : "billing.consumption.byTool")}>
        {view.tools.map((line, index) => (
          <ToolLine key={line.key} line={line} series={index + 1} />
        ))}
      </ul>

      <div className="consumption-foot">
        <p>
          {t("billing.consumption.footUnits")} {withLink(t("billing.consumption.footKept", { export: MARKER }), MARKER, <a href={links.dataExport}>{t("billing.consumption.footExport")}</a>)}{" "}
          {withLink(t("billing.consumption.footModels", { activity: MARKER }), MARKER, <a href={links.aiActivity}>{t("billing.consumption.footActivity")}</a>)}
        </p>
      </div>
    </section>
  );
}

/** One Tool's line: its swatch, name and count, its share bar, its share in words and its Plan Quota; « Autres » lists its Tools under it. */
function ToolLine({ line, series }: { line: ConsumptionToolLine; series: number }) {
  return (
    <li className="consumption-tool">
      <span className={`consumption-swatch consumption-series-${series}`} aria-hidden="true" />
      <span className="consumption-tool-name">{line.label}</span>
      <span className="consumption-tool-count">{line.countText}</span>
      <span className="consumption-share" aria-hidden="true">
        <span className={`consumption-series-${series}`} style={{ width: `${line.share}%` }} />
      </span>
      <span className="consumption-tool-sub">
        <span>{line.shareText}</span>
        <QuotaOf line={line} />
      </span>
      {line.parts.length > 0 ? (
        <ul className="consumption-parts">
          {line.parts.map((part) => (
            <li key={part.key}>
              <span>
                {part.label} · {part.countText}
              </span>
              <QuotaOf line={part} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function QuotaOf({ line }: { line: ConsumptionToolLine }) {
  if (line.quota) return <Pill tone={line.quota.usedUp ? "warn" : "neutral"}>{line.quota.text}</Pill>;
  return line.note ? <span>{line.note}</span> : null;
}
