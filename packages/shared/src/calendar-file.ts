import { coachingCalendarZone, coachingTimeZone, zonedClock } from "./coaching-time";

/**
 * The Calendar file's iCalendar text (ADR-0029, RFC 5545, written by hand, no ics package): one event in a
 * VCALENDAR, for the web's « Ajouter à mon calendrier » download and the app's share sheet alike (#693), so both
 * write the same file. What the event says (its title, place, description) is each caller's; this module writes it.
 *
 * Times use the viewer’s IANA zone (Paris by default), with its VTIMEZONE. Repeated DST clocks use exact UTC
 * instants and retain zone metadata so calendar imports cannot choose the wrong occurrence.
 * No METHOD: the file informs, it schedules nothing. Text is escaped and lines are folded at 75 octets, never inside a
 * UTF-8 character.
 */

/** French time, in which Agenda Items are entered and shown (ADR-0028). */
export const FRENCH_TIME_ZONE = "Europe/Paris";

/** One event of a Calendar file. */
export interface CalendarFileEvent {
  /** Stable per Agenda Item, so a later file names the same event. */
  uid: string;
  /**
   * Coaching Sessions use the viewer’s zone; Interviews keep the Paris default. Named (even Paris), a repeated DST
   * clock is written in UTC; left out, the file is the one before « Espace coach v2 » (ADR-0107).
   */
  timeZone?: string;
  start: Date;
  end: Date;
  /** The revision: a later file with a higher one replaces the event. */
  sequence: number;
  summary: string;
  location?: string | null;
  /** A web address, written as a URI (unescaped). */
  url?: string | null;
  description: string;
}

/** Europe/Paris as the tz database has it since 1996 (the EU rule): CET, and CEST from the last Sunday of March to the last Sunday of October. */
const PARIS_TIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${FRENCH_TIME_ZONE}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const FRENCH_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: FRENCH_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** `instant` in French time, as an iCalendar local DATE-TIME: "20261022T143000". */
function frenchDateTime(instant: Date): string {
  const parts = Object.fromEntries(FRENCH_CLOCK.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}00`;
}

/** `instant` in UTC, as an iCalendar DATE-TIME: "20261020T080000Z". */
const utcDateTime = (instant: Date) => `${instant.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

/** `value` as an iCalendar TEXT value (s3.3.11): backslash first, then semicolons, commas and every line break. */
const text = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

/** Octets a content line may take, its line break left out (s3.1). */
const LINE_OCTETS = 75;

/** Octets `character` takes in UTF-8. */
const octetsOf = (character: string) => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

/**
 * `line` folded (s3.1): cut before it passes LINE_OCTETS octets, each following line starting with
 * a space (which counts in its octets). Cuts fall between characters, never inside one.
 */
function fold(line: string): string {
  const folded: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = octetsOf(character);
    if (octets + size > LINE_OCTETS) {
      folded.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += size;
  }
  folded.push(current);
  return folded.join("\r\n");
}

/** RFC 5545 chooses the first occurrence of a repeated local clock. Use UTC when either occurrence is ambiguous. */
function ambiguousClock(at: Date, zone: string): boolean {
  const instant = Math.floor(+at / 1000) * 1000;
  const wall = zonedClock(new Date(instant), zone);
  const epoch = Date.parse(`${wall}Z`);
  return [-86_400_000, 0, 86_400_000].some((delta) => {
    const adjacent = instant + delta;
    const offset = Date.parse(`${zonedClock(new Date(adjacent), zone)}Z`) - adjacent;
    const alternative = epoch - offset;
    return alternative !== instant && zonedClock(new Date(alternative), zone) === wall;
  });
}

/** The Calendar file of `event`, made at `now` (its DTSTAMP), with CRLF line breaks. */
export function calendarFileText(event: CalendarFileEvent, { now }: { now: Date }): string {
  const zone = coachingTimeZone(event.timeZone) ?? FRENCH_TIME_ZONE;
  // Without a named zone, the file is written as before ADR-0096 (TZID=Europe/Paris, even on a repeated clock).
  const utc = event.timeZone !== undefined && (ambiguousClock(event.start, zone) || ambiguousClock(event.end, zone));
  const clock = (at: Date) => zonedClock(at, zone).replace(/[-:]/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jobbbox//Agenda//FR",
    "CALSCALE:GREGORIAN",
    ...(zone === FRENCH_TIME_ZONE ? PARIS_TIMEZONE : coachingCalendarZone(zone, event.start)),
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcDateTime(now)}`,
    `SEQUENCE:${event.sequence}`,
    ...(utc
      ? [`X-JOBBBOX-TIMEZONE:${zone}`, `DTSTART:${utcDateTime(event.start)}`, `DTEND:${utcDateTime(event.end)}`]
      : [
          `DTSTART;TZID=${zone}:${zone === FRENCH_TIME_ZONE ? frenchDateTime(event.start) : clock(event.start)}`,
          `DTEND;TZID=${zone}:${zone === FRENCH_TIME_ZONE ? frenchDateTime(event.end) : clock(event.end)}`,
        ]),
    `SUMMARY:${text(event.summary)}`,
    ...(event.location ? [`LOCATION:${text(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `DESCRIPTION:${text(event.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map((line) => `${fold(line)}\r\n`).join("");
}
