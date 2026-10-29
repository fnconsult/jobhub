import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { DataAttributes } from "./attributes";
import { TableFrame } from "./TableFrame";
import "./Table.css";

export type Column<Row> = {
  /** Its React key; its place in the columns when it has none (columns stay in one order). */
  key?: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** A number: right-aligned, in tabular figures, its header too. */
  numeric?: boolean;
  /** The cell that names its row (a setting's name, a provider's): a row header, which screen readers announce with each cell. */
  rowHeader?: boolean;
};

export type RowGroup<Row> = { label: ReactNode; rows: Row[] };

/** What a row carries for the page: its anchor (`id`), its hooks (`data-setting`), and whether it is the one open (`aria-current`). */
export type RowAttributes = DataAttributes & { id?: string; "aria-current"?: "true" };

/** Whether an event started on a control inside the row, which has its own action. */
const INTERACTIVE = "a, button, input, select, textarea, summary, [role='button'], [role='link'], [tabindex]";
function onControl(event: { target: EventTarget; currentTarget: HTMLElement }): boolean {
  const control = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
  return control !== null && control !== event.currentTarget;
}

/**
 * A table of rows (#462): a header row, rows in groups each under its own header row (« Actif », « Disponibles »),
 * numbers right-aligned in tabular figures. With `onRowActivate` (from a client component), each row opens something
 * (a Drawer): a click, or Enter or Space once Tab has given it the focus, opens it; a control inside the row keeps its
 * own action. `label` names the table for screen readers. On a screen too narrow for it, it scrolls sideways in its own
 * frame (TableFrame). Without `onRowActivate` a server page draws it, its cells (forms, links) included (#465).
 * `data-*` attributes go on the table, for a page's hooks.
 */
export function Table<Row>({
  label,
  columns,
  rows,
  groups,
  rowKey,
  rowAttributes,
  onRowActivate,
  ...data
}: DataAttributes & { label: string; columns: readonly Column<Row>[]; rowKey: (row: Row) => string; rowAttributes?: (row: Row) => RowAttributes; onRowActivate?: (row: Row) => void } & (
    { rows: readonly Row[]; groups?: never } | { groups: readonly RowGroup<Row>[]; rows?: never }
  )) {
  const bodies: readonly { label: ReactNode; rows: readonly Row[] }[] = groups ?? [{ label: null, rows: rows ?? [] }];

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
      <tr key={rowKey(row)} {...rowAttributes?.(row)} {...activate}>
        {columns.map((column) =>
          column.rowHeader ? (
            <th key={column.key} scope="row" data-numeric={column.numeric || undefined}>
              {column.cell(row)}
            </th>
          ) : (
            <td key={column.key} data-numeric={column.numeric || undefined}>
              {column.cell(row)}
            </td>
          ),
        )}
      </tr>
    );
  }

  return (
    <TableFrame label={label}>
      <table {...data} className="ds-table" aria-label={label}>
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
    </TableFrame>
  );
}
