import { describe, expect, it } from "vitest";
import { calendarFileText, type CalendarFileEvent } from "./calendar-file";

const NOW = new Date("2026-10-20T08:00:00.000Z");

/** 14:30 to 15:15 French time on Thursday 22 October 2026 (summer time, UTC+2). */
const event: CalendarFileEvent = {
  uid: "interview-1@jobbbox.fr",
  start: new Date("2026-10-22T12:30:00.000Z"),
  end: new Date("2026-10-22T13:15:00.000Z"),
  sequence: 0,
  summary: "Entretien — DAF, Acme",
  location: "Teams : https://teams.example.com/l/abc",
  url: "https://teams.example.com/l/abc",
  description: "Code; porte\nbureau 4",
};

const lines = (file: string) => file.replace(/\r\n[ \t]/g, "").split("\r\n");
const property = (file: string, name: string) => {
  const all = lines(file);
  return all.slice(all.indexOf("BEGIN:VEVENT")).find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
};

describe("calendarFileText", () => {
  it("writes one VEVENT in a VCALENDAR, with no METHOD, CRLF line breaks and the time stamp in UTC", () => {
    const file = calendarFileText(event, { now: NOW });
    expect(file.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(true);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(lines(file).some((line) => line.startsWith("METHOD"))).toBe(false);
    expect(property(file, "UID")).toBe("UID:interview-1@jobbbox.fr");
    expect(property(file, "DTSTAMP")).toBe("DTSTAMP:20261020T080000Z");
    expect(property(file, "SEQUENCE")).toBe("SEQUENCE:0");
  });

  it("writes the start and end in French time, in summer and in winter", () => {
    const summer = calendarFileText(event, { now: NOW });
    expect(property(summer, "DTSTART")).toBe("DTSTART;TZID=Europe/Paris:20261022T143000");
    expect(property(summer, "DTEND")).toBe("DTEND;TZID=Europe/Paris:20261022T151500");
    const winter = calendarFileText({ ...event, start: new Date("2026-12-07T08:00:00.000Z"), end: new Date("2026-12-07T09:00:00.000Z") }, { now: NOW });
    expect(property(winter, "DTSTART")).toBe("DTSTART;TZID=Europe/Paris:20261207T090000");
    expect(property(winter, "DTEND")).toBe("DTEND;TZID=Europe/Paris:20261207T100000");
    expect(lines(winter)).toContain("TZID:Europe/Paris");
  });

  it.each([
    ["America/Montreal", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"],
    ["America/Montreal", "2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z"],
    ["Europe/Paris", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"],
    ["Europe/Paris", "2026-10-25T01:30:00Z", "2026-10-25T02:30:00Z"],
  ])("round-trips both occurrences of a DST fold in %s (%s)", (timeZone, start, end) => {
    const file = calendarFileText({ ...event, timeZone, start: new Date(start), end: new Date(end) }, { now: NOW });
    const readUtc = (name: string) => {
      const value = property(file, name)!.split(":").at(-1)!;
      expect(value).toMatch(/^\d{8}T\d{6}Z$/);
      return new Date(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
    };
    expect(+readUtc("DTSTART")).toBe(+new Date(start));
    expect(+readUtc("DTEND")).toBe(+new Date(end));
    expect(+readUtc("DTEND") - +readUtc("DTSTART")).toBe(+new Date(end) - +new Date(start));
    expect(lines(file)).toContain(`X-JOBBBOX-TIMEZONE:${timeZone}`);
  });
  it("escapes text, leaves the URL as it is, and leaves out an absent location or URL", () => {
    const file = calendarFileText(event, { now: NOW });
    expect(property(file, "SUMMARY")).toBe("SUMMARY:Entretien — DAF\\, Acme");
    expect(property(file, "DESCRIPTION")).toBe("DESCRIPTION:Code\\; porte\\nbureau 4");
    expect(property(file, "URL")).toBe("URL:https://teams.example.com/l/abc");
    const bare = calendarFileText({ ...event, location: null, url: null }, { now: NOW });
    expect(property(bare, "LOCATION")).toBeUndefined();
    expect(property(bare, "URL")).toBeUndefined();
  });

  it("folds lines at 75 octets without cutting a character", () => {
    const file = calendarFileText({ ...event, summary: "é".repeat(100) }, { now: NOW });
    for (const line of file.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(property(file, "SUMMARY")).toBe(`SUMMARY:${"é".repeat(100)}`);
  });
});
