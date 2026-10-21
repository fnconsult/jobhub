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

  it("lasts an hour when the Interview's duration is not known", () => {
    const file = calendarFile({ ...interview, durationMinutes: null }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(file, "DTEND")).toBe("DTEND;TZID=Europe/Paris:20261022T153000");
  });

  it("names an Interview by its Job Offer and company, a Coaching Session by its Human Coach, in the Interface Language", () => {
    expect(property(calendarFile(interview, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!, "SUMMARY")).toBe("SUMMARY:Entretien — Directrice financière\\, Acme Industrie");
    expect(property(calendarFile({ ...interview, employer: undefined }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!, "SUMMARY")).toBe("SUMMARY:Entretien — Directrice financière");
    expect(property(calendarFile(interview, { now: NOW, agendaUrl: AGENDA_URL, locale: "en" })!, "SUMMARY")).toBe("SUMMARY:Interview — Directrice financière\\, Acme Industrie");
    expect(property(calendarFile(session, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!, "SUMMARY")).toBe("SUMMARY:Séance avec Claire Martin");
    expect(property(calendarFile(session, { now: NOW, agendaUrl: AGENDA_URL, locale: "en" })!, "SUMMARY")).toBe("SUMMARY:Session with Claire Martin");
  });

  it("gives the place or the video link as LOCATION, and a web address in it as URL", () => {
    const onSite = calendarFile(interview, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(onSite, "LOCATION")).toBe("LOCATION:12 rue de la Paix\\, Paris");
    expect(property(onSite, "URL")).toBeUndefined();

    const video = calendarFile({ ...interview, format: "video", place: "Teams : https://teams.example.com/l/meetup-join/19%3Ameeting?ctx=a,b." }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(video, "LOCATION")).toBe("LOCATION:Teams : https://teams.example.com/l/meetup-join/19%3Ameeting?ctx=a\\,b.");
    // A URI is not TEXT: no escaping, and no punctuation that ends the sentence.
    expect(property(video, "URL")).toBe("URL:https://teams.example.com/l/meetup-join/19%3Ameeting?ctx=a,b");

    const coaching = calendarFile(session, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(coaching, "LOCATION")).toBe("LOCATION:https://meet.example.com/abc-def");
    expect(property(coaching, "URL")).toBe("URL:https://meet.example.com/abc-def");

    const nowhere = calendarFile({ ...interview, place: "" }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(nowhere, "LOCATION")).toBeUndefined();
    expect(property(calendarFile({ ...session, videoLink: undefined }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!, "LOCATION")).toBeUndefined();
  });

  it("describes the item with its note and a link back to the Agenda", () => {
    const file = calendarFile({ ...interview, note: "avec la DRH" }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(file, "DESCRIPTION")).toBe("DESCRIPTION:avec la DRH\\n\\nDans votre agenda Jobbbox : https://app.jobbbox.fr/agenda");
    const noNote = calendarFile(session, { now: NOW, agendaUrl: AGENDA_URL, locale: "en" })!;
    expect(property(noNote, "DESCRIPTION")).toBe("DESCRIPTION:In your Jobbbox agenda: https://app.jobbbox.fr/agenda");
  });

  it("escapes backslashes, semicolons, commas and line breaks in text, so a note cannot add properties", () => {
    const note = "Code\\porte; 2e étage, bureau 4\r\nEND:VEVENT\nBEGIN:VEVENT\rfin";
    const file = calendarFile({ ...interview, jobTitle: "DAF; H/F", employer: "Dupont, Durand & Cie", note }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    expect(property(file, "SUMMARY")).toBe("SUMMARY:Entretien — DAF\\; H/F\\, Dupont\\, Durand & Cie");
    expect(property(file, "DESCRIPTION")).toBe("DESCRIPTION:Code\\\\porte\\; 2e étage\\, bureau 4\\nEND:VEVENT\\nBEGIN:VEVENT\\nfin\\n\\nDans votre agenda Jobbbox : https://app.jobbbox.fr/agenda");
    expect(lines(file).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("folds lines longer than 75 octets, counting octets and never splitting a UTF-8 character", () => {
    const note = "Rendez-vous à l'accueil — demander Mme Léa Étienne, responsable RH ; prévoir une pièce d'identité. ".repeat(4);
    const file = calendarFile({ ...interview, jobTitle: "Directeur administratif et financier — groupe industriel européen", note }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    const physical = file.split("\r\n").slice(0, -1);
    for (const line of physical) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      // No character was cut in two (it would decode as U+FFFD).
      expect(line).not.toContain("\uFFFD");
    }
    expect(physical.some((line) => line.startsWith(" "))).toBe(true);
    // Unfolded, the text is whole again.
    expect(property(file, "SUMMARY")).toBe("SUMMARY:Entretien — Directeur administratif et financier — groupe industriel européen\\, Acme Industrie");
    expect(property(file, "DESCRIPTION")).toContain(note.replace(/,/g, "\\,").replace(/;/g, "\\;"));
  });

  it("folds a line made only of multi-octet characters on character boundaries", () => {
    const file = calendarFile({ ...interview, jobTitle: "é".repeat(100) }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!;
    const summary = file.split("\r\n").filter((line, index, all) => line.startsWith("SUMMARY:") || (line.startsWith(" ") && all.slice(0, index).some((l) => l.startsWith("SUMMARY:"))));
    expect(summary.map((line) => Buffer.byteLength(line, "utf8"))).toEqual(expect.arrayContaining([75]));
    expect(property(file, "SUMMARY")).toBe(`SUMMARY:Entretien — ${"é".repeat(100)}\\, Acme Industrie`);
  });
});

describe("a Cancelled Agenda Item", () => {
  it("has no Calendar file", () => {
    expect(calendarFile({ ...interview, cancelledAt: new Date("2026-10-21T09:00:00.000Z") }, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })).toBeNull();
  });
});

describe("a Rescheduled Agenda Item", () => {
  it("counts its Reschedules in SEQUENCE, so a new download is a newer revision of the same event", () => {
    expect(lines(calendarFile(interview, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!)).toContain("SEQUENCE:0");
    const moved: InterviewAgendaItem = {
      ...interview,
      reschedules: [{ previousAt: new Date("2026-10-21T12:30:00.000Z"), newAt: interview.scheduledAt, by: "candidate", at: new Date("2026-10-19T08:00:00.000Z") }],
    };
    expect(lines(calendarFile(moved, { now: NOW, agendaUrl: AGENDA_URL, locale: "fr" })!)).toContain("SEQUENCE:1");
  });
});
