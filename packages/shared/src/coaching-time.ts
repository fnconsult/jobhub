/** Coaching Sessions follow each person's IANA time zone (ADR-0096). Interviews stay in Paris. */
export const COACHING_DEFAULT_ZONE = "Europe/Paris";

export function coachingTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 100) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return value; }
  catch { return null; }
}

/** A wall clock with seconds, independent of the process's locale and time zone. */
export function zonedClock(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Everyone sees their own clock, with the Paris clock alongside it when the zone differs. */
export function coachingTime(instant: Date, locale: string, timeZone = COACHING_DEFAULT_ZONE): string {
  const zone = coachingTimeZone(timeZone) ?? COACHING_DEFAULT_ZONE;
  const format = (zone: string) => new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "full", timeStyle: "short" }).format(instant);
  const local = `${format(zone)} (${zone})`;
  return zone === COACHING_DEFAULT_ZONE ? local : `${local} · ${format(COACHING_DEFAULT_ZONE)} (${COACHING_DEFAULT_ZONE})`;
}

/** The date used to group a coach's Today/Tomorrow cards; ISO order sorts chronologically. */
export const coachingDay = (instant: Date, timeZone = COACHING_DEFAULT_ZONE) => zonedClock(instant, timeZone).slice(0, 10);

/** RFC 5545 VTIMEZONE observances around the event, derived from ICU's IANA tzdata, including DST. */
export function coachingCalendarZone(timeZone: string, event: Date): string[] {
  const zone = coachingTimeZone(timeZone);
  if (!zone) throw new Error("Invalid coaching time zone");
  const offset = (at: number) => (Date.parse(`${zonedClock(new Date(at), zone)}Z`) - at) / 60_000;
  const compact = (value: string) => value.replace(/[-:]/g, "");
  const signed = (minutes: number) => `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
  const year = event.getUTCFullYear();
  const first = Date.UTC(year - 1, 0, 1);
  const last = Date.UTC(year + 2, 0, 1);
  let previous = offset(first);
  const initial = previous;
  const observances: string[] = [];
  for (let at = first + 86_400_000; at <= last; at += 86_400_000) {
    const next = offset(at);
    if (next === previous) continue;
    let low = at - 86_400_000;
    let high = at;
    while (high - low > 60_000) {
      const middle = Math.floor((low + high) / 120_000) * 60_000;
      if (offset(middle) === previous) low = middle; else high = middle;
    }
    const kind = next > previous ? "DAYLIGHT" : "STANDARD";
    // DTSTART names the local wall clock immediately before the transition.
    observances.push(`BEGIN:${kind}`, `DTSTART:${compact(new Date(high + previous * 60_000).toISOString().slice(0, 19))}`, `TZOFFSETFROM:${signed(previous)}`, `TZOFFSETTO:${signed(next)}`, `END:${kind}`);
    previous = next;
  }
  if (!observances.length) observances.push("BEGIN:STANDARD", `DTSTART:${year - 1}0101T000000`, `TZOFFSETFROM:${signed(initial)}`, `TZOFFSETTO:${signed(initial)}`, "END:STANDARD");
  return ["BEGIN:VTIMEZONE", `TZID:${zone}`, ...observances, "END:VTIMEZONE"];
}

/** Midnight for a local date, adjusting offsets around DST rather than assuming 24-hour days. */
export function coachingDayStart(day: string, timeZone = COACHING_DEFAULT_ZONE): Date {
  const target = Date.parse(`${day}T00:00:00Z`);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const difference = target - Date.parse(`${zonedClock(new Date(instant), timeZone)}Z`);
    if (difference === 0) break;
    instant += difference;
  }
  return new Date(instant);
}

/**
 * Whether a Coaching Session has ended (#1019): its end, its start plus its duration (an hour when unknown), is past.
 * An Unscheduled one never has. Ended, its Candidate neither moves nor cancels it.
 */
export function coachingSessionOver(session: { scheduledAt: Date | string | null; durationMinutes: number | null }, now: Date): boolean {
  if (session.scheduledAt === null) return false;
  return new Date(session.scheduledAt).getTime() + (session.durationMinutes ?? 60) * 60_000 <= now.getTime();
}
