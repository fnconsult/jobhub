import { describe, expect, it } from "vitest";
import type { CoachingSessionAgendaItem, InterviewAgendaItem } from "./index";
import { calendarFile } from "./calendar-file";

const NOW = new Date("2026-10-20T08:00:00.000Z");
const AGENDA_URL = "https://app.jobbbox.fr/agenda";

/** An Interview on Thursday 22 October 2026, 14:30 French time (UTC+2: summer time). */
const interview: InterviewAgendaItem = {
  kind: "interview",
  id: "3f0c2a8e-1111-4c4c-9999-000000000001",
  scheduledAt: new Date("2026-10-22T12:30:00.000Z"),
  durationMinutes: 45,
  format: "on_site",
  place: "12 rue de la Paix, Paris",
  applicationId: "app-1",
  jobTitle: "Directrice financière",
  employer: "Acme Industrie",
  reschedules: [],
};

/** A Coaching Session on Monday 7 December 2026, 9:00 French time (UTC+1: winter time). */
const session: CoachingSessionAgendaItem = {
  kind: "coachingSession",
  id: "7a7a7a7a-2222-4c4c-9999-000000000002",
  scheduledAt: new Date("2026-12-07T08:00:00.000Z"),
  coach: { id: "coach-1", name: "Claire Martin" },
  durationMinutes: 60,
  videoLink: "https://meet.example.com/abc-def",
  changedBy: "candidate",
  reschedules: [],
};

/** The file's content lines, unfolded (RFC 5545 s3.1). */
const lines = (file: string) => file.replace(/\r\n[ \t]/g, "").split("\r\n");
/** The VEVENT's content line named `name` (with its parameters, if any, before the colon). */
const property = (file: string, name: string) => {
  const all = lines(file);
  return all.slice(all.indexOf("BEGIN:VEVENT")).find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
};

describe("calendarFile", () => {
  it("is one VEVENT in a VCALENDAR, with CRLF line breaks, a stable UID and the time stamp in UTC", () => {
    const file = calendarFile(interview, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(file.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(true);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(file.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(lines(file).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(property(file, "UID")).toBe("UID:interview-3f0c2a8e-1111-4c4c-9999-000000000001@jobbbox.fr");
    expect(property(file, "DTSTAMP")).toBe("DTSTAMP:20261020T080000Z");
    // Downloaded again later, the file names the same event.
    expect(property(calendarFile(interview, { now: new Date(), agendaUrl: AGENDA_URL, locale: "fr" })!, "UID")).toBe(property(file, "UID"));
    expect(property(calendarFile(session, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!, "UID")).toBe("UID:coaching-session-7a7a7a7a-2222-4c4c-9999-000000000002@jobbbox.fr");
  });

  it("writes the start and end in French time with TZID=Europe/Paris, in summer and in winter, with a VTIMEZONE block", () => {
    const summer = calendarFile(interview, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(summer, "DTSTART")).toBe("DTSTART;TZID=Europe/Paris:20261022T143000");
    expect(property(summer, "DTEND")).toBe("DTEND;TZID=Europe/Paris:20261022T151500");
    const winter = calendarFile(session, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(winter, "DTSTART")).toBe("DTSTART;TZID=Europe/Paris:20261207T090000");
    expect(property(winter, "DTEND")).toBe("DTEND;TZID=Europe/Paris:20261207T100000");
    for (const file of [summer, winter]) {
      const body = lines(file);
      const timezone = body.slice(body.indexOf("BEGIN:VTIMEZONE"), body.indexOf("END:VTIMEZONE") + 1);
      expect(timezone).toEqual([
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Paris",
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
      ]);
      // The VTIMEZONE comes before the event that uses it.
      expect(body.indexOf("END:VTIMEZONE")).toBeLessThan(body.indexOf("BEGIN:VEVENT"));
    }
  });
});
