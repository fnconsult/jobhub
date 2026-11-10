import { Table, type Column } from "@/design/Table";
import type { getServerT } from "@/i18n/server";

type T = Awaited<ReturnType<typeof getServerT>>;

// The Dashboard's chart parts (#408), shared by its blocks: a scale's top, a chart's table view, a list of bars.

/** A chart's scale top: `max` rounded up to a readable step, never 0. */
export function scaleTop(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
}

/** A chart's table view, folded under it: the Design System's Table, named by the chart. */
export function TableView<Row>({ t, caption, columns, rows, rowKey }: { t: T; caption: string; columns: Column<Row>[]; rows: readonly Row[]; rowKey: (row: Row) => string }) {
  return (
    <details className="chart-table">
      <summary>{t("admin.dashboard.tableView")}</summary>
      <Table label={caption} columns={columns} rows={rows} rowKey={rowKey} />
    </details>
  );
}

/** One horizontal bar per row, one hue: what each is, its bar against the largest, and its value in words. */
export function BarList({ rows, max }: { rows: { key: string; label: string; value: string; amount: number; tip: string }[]; max: number }) {
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
