"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
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

/**
 * A table of rows (#462): a header row, rows in groups each under its own header row (« Actif », « Disponibles »),
 * numbers right-aligned in tabular figures. With `onRowActivate`, each row opens something (a Drawer): a click, or
 * Enter or Space once Tab has given it the focus, opens it; a control inside the row keeps its own action. `label`
 * names the table for screen readers.
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
    <div className="ds-table-wrap">
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
