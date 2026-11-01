/**
 * The withdrawal period of a contract concluded online (C. conso. L221-18): 14 days from the day after it was
 * concluded, to the end of the 14th day, in French time; a period whose last day is a Saturday, a Sunday or a public
 * holiday runs on to the end of the next working day (L221-19, after Regulation 1182/71). Holidays are those of
 * metropolitan France: being a day late in Alsace-Moselle only gives the Candidate more.
 */
import { frenchDayStart } from "../applications";
import { dayAfter, frenchDay } from "../agenda/calendar";

/** The length of the withdrawal period, in days. */
export const WITHDRAWAL_DAYS = 14;

/** The first instant the Candidate can no longer withdraw from a contract concluded at `concludedAt`. */
export function withdrawalDeadline(concludedAt: Date): Date {
  let last = frenchDay(concludedAt);
  for (let day = 0; day < WITHDRAWAL_DAYS; day += 1) last = dayAfter(last);
  while (!isWorkingDay(last)) last = dayAfter(last);
  return frenchDayStart(dayAfter(last));
}

/** Whether, at `now`, the Candidate may still withdraw from a contract concluded at `concludedAt`. */
export function withdrawalOpen(concludedAt: Date, now: Date): boolean {
  return now >= concludedAt && now < withdrawalDeadline(concludedAt);
}

/** "2026-10-17" is a Saturday: not a working day; nor are Sundays and public holidays. */
function isWorkingDay(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !publicHolidays(Number(day.slice(0, 4))).has(day);
}

/** The public holidays of metropolitan France in `year` (Code du travail L3133-1). */
function publicHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const fromEaster = (days: number) => new Date(easter.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const fixed = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map((date) => `${year}-${date}`);
  // Easter Monday, Ascension Day and Whit Monday.
  return new Set([...fixed, fromEaster(1), fromEaster(39), fromEaster(50)]);
}

/** Easter Sunday of `year` (Gregorian calendar), at 00:00 UTC: the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
