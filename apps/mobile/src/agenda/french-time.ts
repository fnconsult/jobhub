/** French time, in which Agenda Items are entered and grouped by day (ADR-0028), whatever the device's zone. */
export const FRENCH_TIME_ZONE = "Europe/Paris";

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: FRENCH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The day `instant` falls on in French time, as an ISO date: "2026-10-22" (from its parts, whatever a locale's order). */
export function frenchDay(instant: Date): string {
  const parts = Object.fromEntries(DAY.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A calendar day at noon UTC: always that same day in French time, so `Intl` writes it in Europe/Paris. */
const noonOf = (day: string) => new Date(`${day}T12:00:00Z`);

/** How the Agenda writes its days and times, in the Interface Language (`locale`), in French time. */
export function agendaFormats(locale: string) {
  const zone = { timeZone: FRENCH_TIME_ZONE };
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", ...zone });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", ...zone });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", ...zone });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", ...zone });
  return {
    /** A day of the list: "jeudi 22 octobre". */
    day: (day: string) => weekday.format(noonOf(day)),
    time: (instant: string) => time.format(new Date(instant)),
    date: (instant: string) => date.format(new Date(instant)),
    dateTime: (instant: string) => dateTime.format(new Date(instant)),
  };
}

const WALL_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: FRENCH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** An instant as the form shows it, in French time: « 23/10/2026 » and « 11:00 ». */
export function inFrenchTime(instant: string): { date: string; time: string } {
  const parts = Object.fromEntries(WALL_CLOCK.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return { date: `${parts.day}/${parts.month}/${parts.year}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * The date and time typed, as the web app reads `scheduledAt`: French time without an offset, « 2026-11-12T14:30 ».
 * Empty when both are; as typed otherwise, when they are not a day and an hour: the web app says what is wrong with it.
 */
export function wallClockOf(date: string, time: string): string {
  const day = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(date.trim());
  const hour = /^(\d{1,2})[:hH.](\d{2})$/.exec(time.trim());
  if (day && hour) return `${day[3]}-${day[2]!.padStart(2, "0")}-${day[1]!.padStart(2, "0")}T${hour[1]!.padStart(2, "0")}:${hour[2]}`;
  return `${date.trim()} ${time.trim()}`.trim();
}
