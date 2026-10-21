/**
 * The Agenda's addresses and calendar periods (ADR-0028): which view and day an
 * address asks for, and the days a week (Monday to Sunday) or a month (a grid
 * of weeks) covers. Days are calendar days in French time, written
 * "2026-10-20"; only `frenchDay` meets an instant, and no date package is used.
 */
import { INTERVIEW_TIME_ZONE } from "../applications";

/** How the Agenda shows its items: the list (the default), a week or a month. */
export type AgendaView = "liste" | CalendarView;

/** A view of the Agenda that covers a period of days. */
export type CalendarView = "semaine" | "mois";

/** The days a week or month view covers, and where « Précédent » and « Suivant » lead. */
export interface CalendarPeriod {
  /** The period's first day: a Monday for a week, the 1st for a month. */
  first: string;
  /** The period's last day: a Sunday for a week, the month's last day for a month. */
  last: string;
  /**
   * The days to show, as rows of seven, Monday first. A week is one row. A month
   * starts on the Monday on or before its 1st and ends on the Sunday on or after
   * its last day, so its first and last rows hold days of the months around it.
   */
  weeks: string[][];
  /** A day of the period before (a week earlier; the previous month's 1st). */
  previous: string;
  /** A day of the period after (a week later; the next month's 1st). */
  next: string;
}

const DAY_MS = 86_400_000;

/** The calendar day as a UTC midnight: day arithmetic on it never meets a clock change. */
const toUtc = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (time: number): string => new Date(time).toISOString().slice(0, 10);
const addDays = (day: string, count: number): string => fromUtc(toUtc(day) + count * DAY_MS);
/** The day after `day`. */
export const dayAfter = (day: string): string => addDays(day, 1);
/** The Monday on or before `day`. */
const mondayOf = (day: string): string => addDays(day, -((new Date(toUtc(day)).getUTCDay() + 6) % 7));
/** The seven days from `monday` on. */
const weekFrom = (monday: string): string[] => Array.from({ length: 7 }, (_, index) => addDays(monday, index));

/** The week or month `date` falls in. */
export function calendarPeriod(view: CalendarView, date: string): CalendarPeriod {
  if (view === "semaine") {
    const first = mondayOf(date);
    return { first, last: addDays(first, 6), weeks: [weekFrom(first)], previous: addDays(first, -7), next: addDays(first, 7) };
  }
  const first = `${date.slice(0, 7)}-01`;
  const next = monthAfter(first);
  const last = addDays(next, -1);
  const weeks: string[][] = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) weeks.push(weekFrom(monday));
  return { first, last, weeks, previous: monthBefore(first), next };
}

/** The 1st of the month `offset` months from the one `first` (a 1st) opens. */
function monthsFrom(first: string, offset: number): string {
  const [year, month] = first.split("-").map(Number) as [number, number];
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0 to 99 as 1900 to 1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1 + offset, 1);
  return fromUtc(date.getTime());
}

/** The 1st of the month after the one `first` (a 1st) opens. */
const monthAfter = (first: string): string => monthsFrom(first, 1);

/** The 1st of the month before the one `first` (a 1st) opens. */
const monthBefore = (first: string): string => monthsFrom(first, -1);

/** What an Agenda address asks for. */
export interface AgendaAddress {
  view: AgendaView;
  /** The day the period is around (a week or month view), today when the address names none. */
  date: string;
  /** Whether the address names a view: when it does not, the browser may bring back the last one picked. */
  chosen: boolean;
}

const VIEWS: readonly AgendaView[] = ["liste", "semaine", "mois"];
const FRENCH_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: INTERVIEW_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The day `instant` falls on in French time, "2026-10-22". */
export function frenchDay(instant: Date): string {
  return FRENCH_DAY.format(instant);
}

/**
 * The days an address may name. Far-off days (year 1, year 9999) would only
 * build absurd periods and links past what dates can be written as "YYYY-MM-DD".
 */
const FIRST_DAY = "1970-01-01";
const LAST_DAY = "2100-12-31";

/** A real calendar day written "2026-10-22" (not "2026-02-30"), from 1970 to 2100. */
const isDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= FIRST_DAY && value <= LAST_DAY && !Number.isNaN(toUtc(value)) && fromUtc(toUtc(value)) === value;

/** The view and day an Agenda address (`?vue=semaine&date=2026-10-20`) asks for: the list on today (`now`'s day in French time) for anything else. */
export function readAgendaAddress(params: { vue?: string | string[]; date?: string | string[] }, now: Date): AgendaAddress {
  const view = VIEWS.find((known) => known === params.vue);
  return { view: view ?? "liste", date: isDay(params.date) ? params.date : frenchDay(now), chosen: view !== undefined };
}
