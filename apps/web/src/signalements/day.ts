/**
 * The day a Signalement was sent, as its notification and « Mes signalements » name it (#377): « 25 octobre »
 * (« October 25 »), with the year when it is not this year's; in Paris time. Depends on nothing, for the client.
 */
const TIME_ZONE = "Europe/Paris";

const yearOf = (at: Date) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone: TIME_ZONE }).format(at);

export function signalementDay(at: Date, now: Date, language: string): string {
  const withYear = yearOf(at) !== yearOf(now);
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: TIME_ZONE }).format(at);
}
