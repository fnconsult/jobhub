// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Amount } from "./Amount";
import { Table, type Column } from "./Table";
import { renderInFrench } from "./testing";

type Provider = { id: string; name: string; cost: number };

const columns: Column<Provider>[] = [
  { key: "name", header: "Fournisseur", cell: (row) => row.name },
  { key: "cost", header: "Coût du mois", numeric: true, cell: (row) => <Amount value={row.cost} /> },
];

const groups = [
  { label: "Actif", rows: [{ id: "perplexity", name: "Perplexity", cost: 1774.66 }] },
  {
    label: "Disponibles",
    rows: [
      { id: "brave", name: "Brave Search", cost: 0 },
      { id: "tavily", name: "Tavily", cost: 0.04 },
    ],
  },
];

/** Spaces as a reader hears them: Intl writes narrow and non-breaking ones. */
const plain = (text: string | null) => (text ?? "").replace(/[  ]/g, " ");

describe("Amount (#462)", () => {
  it("writes euros the French way, the cents apart so they can be raised", () => {
    const { container } = renderInFrench(<Amount value={1774.66} />);
    expect(plain(container.textContent)).toBe("1 774,66 €");
    expect(plain(container.querySelector("[data-cents]")?.textContent ?? null)).toBe(",66 €");
  });

  it("keeps as many decimals as asked, for a cost of a fraction of a cent", () => {
    const { container } = renderInFrench(<Amount value={0.0396} fractionDigits={4} />);
    expect(plain(container.textContent)).toBe("0,0396 €");
  });
});

describe("Table (#462)", () => {
  it("has a column header row, and a header for each group of rows", () => {
    renderInFrench(<Table label="Fournisseurs" columns={columns} groups={groups} rowKey={(row) => row.id} />);
    const table = screen.getByRole("table", { name: "Fournisseurs" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Fournisseur", "Coût du mois"]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Actif", "Disponibles"]);
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 2 + 3);
  });

  it("leaves rows alone without an action: they take no Tab stop", async () => {
    const user = userEvent.setup();
    renderInFrench(
      <>
        <Table label="Fournisseurs" columns={columns} groups={groups} rowKey={(row) => row.id} />
        <button type="button">Après</button>
      </>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Après" }));
  });

  it("opens a clickable row with a click, or with Enter or Space once it has the focus", async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    renderInFrench(<Table label="Fournisseurs" columns={columns} groups={groups} rowKey={(row) => row.id} onRowActivate={(row) => opened(row.id)} />);
    await user.tab();
    expect(document.activeElement?.textContent).toContain("Perplexity");
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard(" ");
    await user.click(screen.getByText("Tavily"));
    expect(opened.mock.calls).toEqual([["perplexity"], ["brave"], ["tavily"]]);
  });

  it("does not open the row when a control inside it is used", async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const sheet = vi.fn();
    const withButton: Column<Provider>[] = [...columns, { key: "sheet", header: "Fiche", cell: (row) => <button type="button" onClick={() => sheet(row.id)}>Fiche</button> }];
    renderInFrench(<Table label="Fournisseurs" columns={withButton} groups={groups.slice(0, 1)} rowKey={(row) => row.id} onRowActivate={(row) => opened(row.id)} />);
    await user.click(screen.getByRole("button", { name: "Fiche" }));
    screen.getByRole("button", { name: "Fiche" }).focus();
    await user.keyboard("{Enter}");
    expect(sheet.mock.calls).toEqual([["perplexity"], ["perplexity"]]);
    expect(opened).not.toHaveBeenCalled();
  });
});
