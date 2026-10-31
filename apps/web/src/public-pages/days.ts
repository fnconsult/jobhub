/** A day (`YYYY-MM-DD`) written out in `locale`: « 7 décembre 2026 », "December 7, 2026". */
export function writtenDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** A Legal Text Version's day as a box names it: « 01/12/2026 » in French, as the Legal Texts write it; written out otherwise. */
export function versionDay(version: string, locale: string): string {
  if (locale !== "fr") return writtenDay(version, locale);
  const [year, month, day] = version.split("-");
  return `${day}/${month}/${year}`;
}
