import { describe, expect, it } from "vitest";
import { readAgendaMenuAddress } from "./menu";

/** A Thursday, 22 October 2026, in French time. */
const NOW = new Date("2026-10-22T10:00:00+02:00");

describe("the Agenda's menu conversation reads its address: the list on its card, a view or a form in the Work Pane (#606)", () => {
  it("shows the upcoming list and nothing in the Work Pane at /agenda", () => {
    expect(readAgendaMenuAddress({}, NOW)).toEqual({ past: false, pane: null });
  });

  it("shows the past Agenda Items on the card with « periode=passes »", () => {
    expect(readAgendaMenuAddress({ periode: "passes" }, NOW)).toEqual({ past: true, pane: null });
    expect(readAgendaMenuAddress({ vue: "liste", periode: "passes" }, NOW)).toEqual({ past: true, pane: null });
  });

  it("opens the week or the month in the Work Pane, on the day named or today, its own address", () => {
    expect(readAgendaMenuAddress({ vue: "semaine", date: "2026-11-03" }, NOW)).toEqual({
      past: false,
      pane: { kind: "calendar", view: "semaine", date: "2026-11-03", href: "/agenda?vue=semaine&date=2026-11-03" },
    });
    expect(readAgendaMenuAddress({ vue: "mois" }, NOW)).toEqual({ past: false, pane: { kind: "calendar", view: "mois", date: "2026-10-22", href: "/agenda?vue=mois&date=2026-10-22" } });
  });

  it("opens the form adding an Interview in the Work Pane with « ajouter=entretien », whatever view is named", () => {
    expect(readAgendaMenuAddress({ ajouter: "entretien" }, NOW)).toEqual({ past: false, pane: { kind: "addInterview", href: "/agenda?ajouter=entretien" } });
    expect(readAgendaMenuAddress({ ajouter: "entretien", vue: "semaine" }, NOW).pane).toEqual({ kind: "addInterview", href: "/agenda?ajouter=entretien" });
  });

  it("ignores what it does not know", () => {
    expect(readAgendaMenuAddress({ vue: "annee", ajouter: "seance", periode: "futures" }, NOW)).toEqual({ past: false, pane: null });
  });
});
