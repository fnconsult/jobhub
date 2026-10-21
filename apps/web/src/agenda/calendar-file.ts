/**
 * The Calendar file (ADR-0029): one Agenda Item as an iCalendar (.ics) file, written by hand
 * (RFC 5545, no ics package), for « Ajouter à mon calendrier ». See docs/research/issue-252.md.
 *
 * Times are French time: DTSTART and DTEND name TZID=Europe/Paris, with its VTIMEZONE block,
 * never converted to UTC. The UID is stable per Agenda Item, so a later download names the
 * same event. Text is escaped and lines are folded at 75 octets, never inside a UTF-8 character.
 */
import type { Locale } from "@jobhub/shared/i18n";
import { INTERVIEW_TIME_ZONE, interviewEndsAt, interviewWallClock } from "../applications";
import type { AgendaItem } from "./index";

/** The domain that makes an Agenda Item's UID globally unique. */
const UID_DOMAIN = "jobbbox.fr";

/** Europe/Paris as the tz database has it since 1996 (the EU rule): CET, and CEST from the last Sunday of March to the last Sunday of October. */
const PARIS_TIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${INTERVIEW_TIME_ZONE}`,
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

export interface CalendarFileOptions {
  /** When the file is made: its DTSTAMP. */
  now: Date;
  /** The Agenda's absolute address, linked from the DESCRIPTION. */
  agendaUrl: string;
  /** The Candidate's Interface Language, for the SUMMARY and DESCRIPTION. */
  locale: Locale;
}

/** `instant` in French time, as an iCalendar local DATE-TIME: "20261022T143000". */
const frenchDateTime = (instant: Date) => `${interviewWallClock(instant).replace(/[-:]/g, "")}00`;

/** `instant` in UTC, as an iCalendar DATE-TIME: "20261020T080000Z". */
const utcDateTime = (instant: Date) => `${instant.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

/** The Calendar file of `item`. */
export function calendarFile(item: AgendaItem, options: CalendarFileOptions): string | null {
  const uid = `${item.kind === "interview" ? "interview" : "coaching-session"}-${item.id}@${UID_DOMAIN}`;
  const endsAt = interviewEndsAt({ scheduledAt: item.scheduledAt, durationMinutes: item.durationMinutes ?? null });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jobbbox//Agenda//FR",
    "CALSCALE:GREGORIAN",
    ...PARIS_TIMEZONE,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utcDateTime(options.now)}`,
    `DTSTART;TZID=${INTERVIEW_TIME_ZONE}:${frenchDateTime(item.scheduledAt)}`,
    `DTEND;TZID=${INTERVIEW_TIME_ZONE}:${frenchDateTime(endsAt)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map((line) => `${line}\r\n`).join("");
}
