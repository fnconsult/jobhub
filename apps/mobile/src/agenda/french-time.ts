/** French time, in which Agenda Items are entered and grouped by day (ADR-0028), whatever the device's zone. */
export const FRENCH_TIME_ZONE = "Europe/Paris";

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: FRENCH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The day `instant` falls on in French time, as an ISO date: "2026-10-22". */
export const frenchDay = (instant: Date) => DAY.format(instant);

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
