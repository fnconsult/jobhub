import { routes } from "../routes";
import { readAgendaAddress, type CalendarView } from "./calendar";

/** What opens in the Work Pane beside the Agenda's menu conversation (#606): the week or the month, or the form adding an Interview. */
export type AgendaPane = { kind: "calendar"; view: CalendarView; date: string; href: string } | { kind: "addInterview"; href: string };

/** The address's values: the past Agenda Items on the card, and the form adding an Interview in the Work Pane. */
const PAST = "passes";
const ADD_INTERVIEW = "entretien";

/**
 * What the Agenda's menu conversation shows for its address (#606, ADR-0070): its card lists the upcoming Agenda Items, or
 * the past ones (« periode=passes »); the week or the month (« vue=semaine|mois », on « date » or today) opens in the
 * Work Pane, as does the form adding an Interview (« ajouter=entretien », which wins). `pane.href` is its own address.
 */
export function readAgendaMenuAddress(
  params: { vue?: string | string[]; date?: string | string[]; periode?: string | string[]; ajouter?: string | string[] },
  now: Date,
): { past: boolean; pane: AgendaPane | null } {
  const past = params.periode === PAST;
  if (params.ajouter === ADD_INTERVIEW) return { past, pane: { kind: "addInterview", href: routes.agendaAddInterview } };
  const address = readAgendaAddress(params, now);
  if (address.view === "liste") return { past, pane: null };
  return { past, pane: { kind: "calendar", view: address.view, date: address.date, href: routes.agendaCalendar(address.view, address.date) } };
}
