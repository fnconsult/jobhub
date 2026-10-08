/**
 * Working days in France (jours ouvrés): Monday to Friday, French public
 * holidays excepted, counted on French-time (Europe/Paris) calendar dates.
 * Internal to Follow-ups.
 */

const TIME_ZONE = "Europe/Paris";

/** The French-time calendar date of an instant, as "YYYY-MM-DD". */
export function frenchDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Easter Sunday of `year` (anonymous Gregorian algorithm), at UTC midnight. */
function easter(year: number): Date {
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
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, dayOfMonth));
}

const holidays = new Map<number, Set<string>>();

/** The 11 French public holidays of `year` (metropolitan France). */
function frenchHolidays(year: number): Set<string> {
  let found = holidays.get(year);
  if (!found) {
    const sunday = easter(year).getTime();
    const afterEaster = (days: number) => iso(new Date(sunday + days * 86_400_000));
    const fixed = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map((monthDay) => `${year}-${monthDay}`);
    // Easter Monday, Ascension Thursday, Whit Monday.
    found = new Set([...fixed, afterEaster(1), afterEaster(39), afterEaster(50)]);
    holidays.set(year, found);
  }
  return found;
}

function isWorkingDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !frenchHolidays(date.getUTCFullYear()).has(iso(date));
}

/** The French-time date `count` working days after the day of `from`, as "YYYY-MM-DD". */
export function addWorkingDays(from: Date, count: number): string {
  const date = new Date(`${frenchDate(from)}T00:00:00Z`);
  for (let added = 0; added < count; ) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkingDay(date)) added++;
  }
  return iso(date);
}
