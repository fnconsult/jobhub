import { describe, expect, it } from "vitest";
import { coachingCalendarZone, coachingDay, coachingTime, coachingTimeZone, zonedClock, coachingSessionOver } from "./coaching-time";
import { calendarFileText } from "./calendar-file";

describe("Coaching Session clocks (ADR-0096)", () => {
  it("validates IANA names and rejects malformed or injected names", () => {
    expect(coachingTimeZone("America/Montreal")).toBe("America/Montreal");
    for (const value of ["Paris", "Europe/Paris\r\nEND:VCALENDAR", 4, null]) expect(coachingTimeZone(value)).toBeNull();
  });
  it("uses each person's day across midnight", () => {
    const at = new Date("2026-11-10T00:30:00Z");
    expect(coachingDay(at, "Europe/Paris")).toBe("2026-11-10");
    expect(coachingDay(at, "America/Montreal")).toBe("2026-11-09");
  });
  it("tracks the different DST transition dates of Paris and Montréal", () => {
    for (const [at, paris, montreal] of [
      ["2026-03-08T06:59:00Z", "07:59", "01:59"],
      ["2026-03-08T07:00:00Z", "08:00", "03:00"],
      ["2026-03-29T01:00:00Z", "03:00", "21:00"],
      ["2026-10-25T01:00:00Z", "02:00", "21:00"],
      ["2026-11-01T06:00:00Z", "07:00", "01:00"],
    ]) {
      expect(zonedClock(new Date(at!), "Europe/Paris").slice(11, 16)).toBe(paris);
      expect(zonedClock(new Date(at!), "America/Montreal").slice(11, 16)).toBe(montreal);
    }
  });
  it("shows Paris alongside a different zone and writes a portable TZID and its observances", () => {
    const at = new Date("2026-07-10T14:30:00Z");
    expect(coachingTime(at, "fr", "America/Montreal")).toContain("Europe/Paris");
    expect(coachingTime(at, "fr", "America/Montreal")).toContain("10:30");
    const zone = coachingCalendarZone("America/Montreal", at).join("\n");
    expect(zone).toContain("DTSTART:20260308T020000");
    expect(zone).toContain("TZOFFSETFROM:-0500\nTZOFFSETTO:-0400");
    const file = calendarFileText({ uid: "session-1", timeZone: "America/Montreal", start: at, end: new Date(+at + 3_600_000), sequence: 0, summary: "Séance", description: "" }, { now: at });
    expect(file).toContain("DTSTART;TZID=America/Montreal:20260710T103000");
    expect(file).toContain("TZID:America/Montreal");
  });
});
describe("a session that has ended (#1019)", () => {
  const session = { scheduledAt: new Date("2026-06-04T08:00:00Z"), durationMinutes: 45 };
  it("is over at its end, its start plus its duration, an hour when unknown; an Unscheduled one never is", () => {
    expect(coachingSessionOver(session, new Date("2026-06-04T07:59:59Z"))).toBe(false);
    expect(coachingSessionOver(session, new Date("2026-06-04T08:44:59Z"))).toBe(false);
    expect(coachingSessionOver(session, new Date("2026-06-04T08:45:00Z"))).toBe(true);
    expect(coachingSessionOver({ ...session, durationMinutes: null }, new Date("2026-06-04T08:59:59Z"))).toBe(false);
    expect(coachingSessionOver({ ...session, durationMinutes: null }, new Date("2026-06-04T09:00:00Z"))).toBe(true);
    // As the app reads it: an ISO string.
    expect(coachingSessionOver({ scheduledAt: "2026-06-04T08:00:00.000Z", durationMinutes: 45 }, new Date("2026-06-04T08:45:00Z"))).toBe(true);
    expect(coachingSessionOver({ scheduledAt: null, durationMinutes: 60 }, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
