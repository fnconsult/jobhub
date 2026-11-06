// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { consumptionPeriod, consumptionSection } from "@/consumption/section";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { CONSUMPTION_VIEW_KEY, ConsumptionSection } from "./ConsumptionSection";

const NOW = new Date("2026-11-05T10:00:00Z");
const period = consumptionPeriod({ kind: "billed", start: new Date("2026-10-18T08:00:00Z"), end: new Date("2026-11-18T09:00:00Z"), renewedBefore: true }, NOW);
const view = consumptionSection({
  period,
  days: [
    { day: "2026-06-01", tool: "coach", count: 2 },
    { day: "2026-10-18", tool: "coach", count: 8 },
    { day: "2026-10-18", tool: "jobSearch", count: 4 },
    { day: "2026-11-05", tool: "cvReading", count: 3 },
  ],
  now: NOW,
  quotas: { matchScores: 50, atsScores: 10, enrichedContacts: 0, jobSearches: 7 },
  usedThisWeek: { matchScores: 0, atsScores: 0, enrichedContacts: 0, jobSearches: 7 },
  locale: "fr",
});
const links = { dataExport: "/compte/donnees", aiActivity: "/aide/utiliser/glossary-ai-activity" };

const cells = () => [...document.querySelectorAll<HTMLElement>("[data-day]")];
const cell = (day: string) => document.querySelector<HTMLElement>(`[data-day="${day}"]`)!;

describe("« Votre consommation » on Mon abonnement (#801, ADR-0091)", () => {
  beforeEach(() => localStorage.clear());

  it("is the anchor the Activité links to, named by its title", () => {
    renderInFrench(<ConsumptionSection view={view} links={links} />);
    const section = screen.getByRole("region", { name: "Votre consommation" });
    expect(section.id).toBe("consommation");
    expect(within(section).getByRole("heading", { name: "Votre consommation" }).id).toBe("consommation-title");
    expect(within(section).getByText("Période de facturation du 18 octobre au 17 novembre")).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Activité IA" }).getAttribute("href")).toBe(links.aiActivity);
    expect(within(section).getByRole("link", { name: "l'export de vos données" }).getAttribute("href")).toBe(links.dataExport);
  });

  it("ends on its foot, which names neither jetons nor euros (#801, #332)", () => {
    renderInFrench(<ConsumptionSection view={view} links={links} />);
    expect(document.querySelector(".consumption-foot")!.textContent).toBe(
      "Compté en nombre d'utilisations. Conservé 12 mois, effacé avec votre compte, inclus dans l'export de vos données. Le détail des modèles utilisés pour chaque contenu est dans Activité IA.",
    );
    expect(screen.getByRole("region", { name: "Votre consommation" }).textContent).not.toMatch(/jetons?|tokens?|euros?|€/i);
  });

  it("ends on the same foot in English", () => {
    render(
      <I18nProvider locale="en">
        <ConsumptionSection view={view} links={links} />
      </I18nProvider>,
    );
    expect(document.querySelector(".consumption-foot")!.textContent).toBe(
      "Counted in uses. Kept 12 months, deleted with your account, included in your data export. The models used for each item are shown in AI activity.",
    );
    expect(screen.getByRole("link", { name: "AI activity" }).getAttribute("href")).toBe(links.aiActivity);
    expect(screen.getByRole("region", { name: "Your consumption" }).textContent).not.toMatch(/jetons?|tokens?|euros?|€/i);
  });

  it("opens on the grid: 12 months of days, a column per week, Monday first, the current period outlined", () => {
    renderInFrench(<ConsumptionSection view={view} links={links} />);
    expect(screen.getByRole("radio", { name: "Grille" }).getAttribute("aria-checked")).toBe("true");
    expect(cells()).toHaveLength(366);
    expect(cells()[0]!.dataset.day).toBe("2025-11-05");
    expect(cells().at(-1)!.dataset.day).toBe("2026-11-05");
    // Each column is one week, from Monday: the first starts on Monday 3 November 2025, two days before the 12 months.
    const firstWeek = document.querySelector(".consumption-week")!;
    expect([...firstWeek.querySelectorAll(".consumption-cell")].map((each) => (each as HTMLElement).dataset.day ?? null)).toEqual([
      null,
      null,
      "2025-11-05",
      "2025-11-06",
      "2025-11-07",
      "2025-11-08",
      "2025-11-09",
    ]);
    expect(cell("2026-10-18").dataset.inPeriod).toBe("true");
    expect(cell("2026-10-17").dataset.inPeriod).toBeUndefined();
    expect(cell("2026-10-18").dataset.level).toBe("4");
  });

  it("shows a cell's date and each Tool's count when it is hovered or focused", async () => {
    renderInFrench(<ConsumptionSection view={view} links={links} />);
    fireEvent.pointerOver(cell("2026-10-18"));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Dimanche 18 octobre 2026 · période en cours");
    expect(tip.textContent).toContain("Coach IA : 8");
    expect(tip.textContent).toContain("Recherches d'offres : 4");
    expect(tip.textContent).toContain("Autres : 0");
    expect(tip.textContent).toContain("12 actions IA");

    // One tab stop, on the latest day; the arrow keys move between days.
    const today = cell("2026-11-05");
    expect(today.tabIndex).toBe(0);
    act(() => today.focus());
    expect(screen.getByRole("tooltip").textContent).toContain("Autres : 3");
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(cell("2026-11-04"));
  });

  it("holds the same numbers in its table view", async () => {
    renderInFrench(<ConsumptionSection view={view} links={links} />);
    await userEvent.click(screen.getByRole("button", { name: "Voir en tableau" }));
    const table = screen.getByRole("table", { name: "Actions IA par jour sur douze mois, par outil" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => [...row.querySelectorAll("th, td")].map((each) => each.textContent))).toEqual([
      ["Lundi 1 juin 2026", "2", "0", "0", "0", "0", "0", "2"],
      ["Dimanche 18 octobre 2026", "8", "4", "0", "0", "0", "0", "12"],
      ["Jeudi 5 novembre 2026", "0", "0", "0", "0", "0", "3", "3"],
    ]);
    expect(screen.getByRole("button", { name: "Masquer le tableau" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("switches to the period's bars, stacked by Tool with a legend, and remembers the choice in this browser", async () => {
    const { unmount } = renderInFrench(<ConsumptionSection view={view} links={links} />);
    await userEvent.click(screen.getByRole("radio", { name: "Barres" }));
    expect(screen.getByRole("heading", { name: "Jour par jour, cette période" })).toBeTruthy();
    expect(document.querySelectorAll("[data-bar]")).toHaveLength(31);
    expect(within(screen.getByRole("list", { name: "Légende" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(view.series.map((series) => series.label));
    expect(localStorage.getItem(CONSUMPTION_VIEW_KEY)).toBe("bars");
    await userEvent.click(screen.getByRole("button", { name: "Voir en tableau" }));
    expect(within(screen.getByRole("table", { name: "Actions IA par jour de la période, par outil" })).getAllByRole("row")).toHaveLength(3);
    unmount();

    renderInFrench(<ConsumptionSection view={view} links={links} />);
    expect(screen.getByRole("radio", { name: "Barres" }).getAttribute("aria-checked")).toBe("true");
  });

  it("lists each Tool with its count, share and this week's Plan Quota, the used-up one in warn", () => {
    renderInFrench(<ConsumptionSection view={view} links={links} />);
    const list = screen.getByRole("list", { name: "Par outil, cette période" });
    const jobSearch = within(list).getByText("Recherches d'offres").closest("li")!;
    expect(jobSearch.textContent).toContain("4 recherches");
    expect(within(jobSearch).getByText("7 sur 7 cette semaine").closest("[data-tone]")!.getAttribute("data-tone")).toBe("warn");
    expect(within(list).getByText("Autres").closest("li")!.textContent).toContain("Lecture de CV");
  });

  it("still renders when this browser's storage cannot be read", () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      renderInFrench(<ConsumptionSection view={view} links={links} />);
      expect(screen.getByRole("radio", { name: "Grille" }).getAttribute("aria-checked")).toBe("true");
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });
});
