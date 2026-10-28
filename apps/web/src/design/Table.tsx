"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import "./Table.css";

export type Column<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** A number: right-aligned, in tabular figures, its header too. */
  numeric?: boolean;
};

export type RowGroup<Row> = { label: ReactNode; rows: Row[] };

/** Whether an event started on a control inside the row, which has its own action. */
const INTERACTIVE = "a, button, input, select, textarea, summary, [role='button'], [role='link'], [tabindex]";
function onControl(event: { target: EventTarget; currentTarget: HTMLElement }): boolean {
  const control = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
  return control !== null && control !== event.currentTarget;
}

/** Whether `frame` is narrower than what it holds, so it scrolls sideways; measured again as either changes size. */
function useScrollsSideways(frame: RefObject<HTMLElement | null>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setScrolls(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [frame]);
  return scrolls;
}

/**
 * A table of rows (#462): a header row, rows in groups each under its own header row (« Actif », « Disponibles »),
 * numbers right-aligned in tabular figures. With `onRowActivate`, each row opens something (a Drawer): a click, or
 * Enter or Space once Tab has given it the focus, opens it; a control inside the row keeps its own action. `label`
 * names the table for screen readers. On a screen too narrow for it, it scrolls sideways in its own frame, which then
 * is a region named by `label` that Tab reaches, so the keyboard can scroll it too (#463).
 */
export function Table<Row>({
  label,
  columns,
  rows,
  groups,
  rowKey,
  onRowActivate,
}: {
  label: string;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  onRowActivate?: (row: Row) => void;
} & ({ rows: Row[]; groups?: never } | { groups: RowGroup<Row>[]; rows?: never })) {
  const bodies: RowGroup<Row>[] | [{ label: null; rows: Row[] }] = groups ?? [{ label: null, rows: rows ?? [] }];
  const frame = useRef<HTMLDivElement>(null);
  const scrolls = useScrollsSideways(frame);

  function renderRow(row: Row) {
    const activate = onRowActivate
      ? {
          tabIndex: 0,
          "data-clickable": true,
          onClick: (event: MouseEvent<HTMLTableRowElement>) => {
            if (!onControl(event)) onRowActivate(row);
          },
          onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
            if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
              event.preventDefault();
              onRowActivate(row);
            }
          },
        }
      : {};
    return (
      <tr key={rowKey(row)} {...activate}>
        {columns.map((column) => (
          <td key={column.key} data-numeric={column.numeric || undefined}>
            {column.cell(row)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div ref={frame} className="ds-table-wrap" role={scrolls ? "region" : undefined} aria-label={scrolls ? label : undefined} tabIndex={scrolls ? 0 : undefined}>
      <table className="ds-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-numeric={column.numeric || undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        {bodies.map((group, index) => (
          <tbody key={index}>
            {group.label !== null ? (
              <tr className="ds-table__group">
                <th scope="rowgroup" colSpan={columns.length}>
                  {group.label}
                </th>
              </tr>
            ) : null}
            {group.rows.map(renderRow)}
          </tbody>
        ))}
      </table>
    </div>
  );
}
