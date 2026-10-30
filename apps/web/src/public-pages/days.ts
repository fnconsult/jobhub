/** A day (`YYYY-MM-DD`) written out in `locale`: « 7 décembre 2026 », "December 7, 2026". */
export function writtenDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
