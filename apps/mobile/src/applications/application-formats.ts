import type { TFunction } from "i18next";
import { FRENCH_TIME_ZONE } from "../agenda/french-time";

/** How an Application's page writes its dates, in the Interface Language, in French time (ADR-0028), as the web's. */
export function applicationFormats(locale: string) {
  const zone = { timeZone: FRENCH_TIME_ZONE };
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", ...zone });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", ...zone });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", ...zone });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", ...zone });
  const changedAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", ...zone });
  return {
    /** « 28 octobre 2026 » */
    date: (instant: string) => date.format(new Date(instant)),
    /** « jeudi 12 novembre 2026 » */
    fullDate: (instant: string) => fullDate.format(new Date(instant)),
    /** « 14:30 » */
    time: (instant: string) => time.format(new Date(instant)),
    /** « jeudi 12 novembre 2026 à 14:30 » */
    dateTime: (instant: string) => dateTime.format(new Date(instant)),
    /** « 3 novembre 2026 à 09:00 » */
    changedAt: (instant: string) => changedAt.format(new Date(instant)),
  };
}
export type ApplicationFormats = ReturnType<typeof applicationFormats>;

/** « 82 / 100 », or « Non calculable »: never 0 / 100 for a Match Score with nothing to compare (#94). */
export const matchScoreInWords = (matchScore: number | null, t: TFunction) => (matchScore === null ? t("matchScore.notComputable") : t("matchScore.score", { score: matchScore }));

/** The site a Job Offer's address is on, « welcometothejungle.com »; the address itself when it is not one. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
