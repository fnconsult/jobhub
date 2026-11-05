import { createI18n } from "@jobhub/shared/i18n";
import type { CoachingSessionAgendaItem, InterviewAgendaItem } from "./agenda-read";
import { agendaCalendarFile, agendaEvent } from "./calendar-event";

const fr = createI18n("fr").t;
const en = createI18n("en").t;
const NOW = new Date("2026-10-20T08:00:00.000Z");

/** Thursday 22 October 2026, 14:30 French time (summer time, UTC+2), 45 minutes, on Teams. */
const interview: InterviewAgendaItem = {
  kind: "interview",
  id: "i1",
  applicationId: "a1",
  jobTitle: "Responsable qualité",
  employer: "Aéroline",
  scheduledAt: "2026-10-22T12:30:00.000Z",
  durationMinutes: 45,
  format: "video",
  place: "Teams : https://teams.example.com/l/meetup-join/abc.",
  note: "Demander Mme Martin",
  cancelledAt: null,
  reschedules: [],
};

/** Monday 7 December 2026, 9:00 French time (winter time, UTC+1), no duration given. */
const session: CoachingSessionAgendaItem = {
  kind: "coachingSession",
  id: "s1",
  coach: { id: "coach-1", name: "Claire Martin" },
  scheduledAt: "2026-12-07T08:00:00.000Z",
  durationMinutes: null,
  videoLink: "https://meet.example.com/abc-def",
  note: null,
  changedBy: "coach",
  reschedules: [],
};

/** `instant` as a wall clock in French time. */
const inParis = (instant: Date) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(instant);

describe("the event « Ajouter au calendrier » fills in", () => {
  it("names an Interview by its job and company, and a Coaching Session by its Human Coach, in the Interface Language", () => {
    expect(agendaEvent(interview, fr)?.title).toBe("Entretien — Responsable qualité, Aéroline");
    expect(agendaEvent({ ...interview, employer: null }, fr)?.title).toBe("Entretien — Responsable qualité");
    expect(agendaEvent(interview, en)?.title).toBe("Interview — Responsable qualité, Aéroline");
    expect(agendaEvent(session, fr)?.title).toBe("Séance avec Claire Martin");
  });

  it("starts at the time entered in French time, whatever the device's zone, in summer and in winter", () => {
    const summer = agendaEvent(interview, fr)!;
    expect(summer.startDate.toISOString()).toBe("2026-10-22T12:30:00.000Z");
    expect(inParis(summer.startDate)).toBe("22/10/2026 14:30");
    const winter = agendaEvent(session, fr)!;
    expect(winter.startDate.toISOString()).toBe("2026-12-07T08:00:00.000Z");
    expect(inParis(winter.startDate)).toBe("07/12/2026 09:00");
  });

  it("lasts its duration, or an hour when none was given", () => {
    expect(agendaEvent(interview, fr)!.endDate.toISOString()).toBe("2026-10-22T13:15:00.000Z");
    expect(agendaEvent(session, fr)!.endDate.toISOString()).toBe("2026-12-07T09:00:00.000Z");
  });

  it("gives the place or video link as its location, and the video link as its address", () => {
    const video = agendaEvent(interview, fr)!;
    expect(video.location).toBe("Teams : https://teams.example.com/l/meetup-join/abc.");
    expect(video.url).toBe("https://teams.example.com/l/meetup-join/abc");
    expect(agendaEvent(session, fr)).toMatchObject({ location: "https://meet.example.com/abc-def", url: "https://meet.example.com/abc-def" });
    const onSite = agendaEvent({ ...interview, format: "on_site", place: "12 rue de la Paix, Paris" }, fr)!;
    expect(onSite.location).toBe("12 rue de la Paix, Paris");
    expect(onSite.url).toBeUndefined();
    expect(agendaEvent({ ...session, videoLink: null }, fr)).toMatchObject({ location: undefined, url: undefined });
  });

  it("keeps the Candidate's note in its notes", () => {
    expect(agendaEvent(interview, fr)!.notes).toBe("Demander Mme Martin");
    expect(agendaEvent(session, fr)!.notes).toBeUndefined();
  });

  it("is none for a Cancelled Interview", () => {
    expect(agendaEvent({ ...interview, cancelledAt: "2026-10-21T09:00:00.000Z" }, fr)).toBeNull();
  });
});

describe("the Calendar file shared when the calendar cannot be used", () => {
  it("is the same event, in French time, with the UID the web's download gives it", () => {
    const file = agendaCalendarFile(interview, { t: fr, now: NOW })!;
    const lines = file.replace(/\r\n[ \t]/g, "").split("\r\n");
    expect(lines).toContain("UID:interview-i1@jobbbox.fr");
    expect(lines).toContain("DTSTART;TZID=Europe/Paris:20261022T143000");
    expect(lines).toContain("DTEND;TZID=Europe/Paris:20261022T151500");
    expect(lines).toContain("SUMMARY:Entretien — Responsable qualité\\, Aéroline");
    expect(lines).toContain("URL:https://teams.example.com/l/meetup-join/abc");
    expect(agendaCalendarFile(session, { t: fr, now: NOW })).toContain("UID:coaching-session-s1@jobbbox.fr");
  });

  it("counts the Reschedules in its SEQUENCE", () => {
    const moved = { ...interview, reschedules: [{ previousAt: "2026-10-21T12:30:00.000Z", newAt: interview.scheduledAt, by: "candidate" as const, at: "2026-10-19T08:00:00.000Z" }] };
    expect(agendaCalendarFile(moved, { t: fr, now: NOW })).toContain("SEQUENCE:1");
  });

  it("is none for a Cancelled Agenda Item", () => {
    expect(agendaCalendarFile({ ...interview, cancelledAt: "2026-10-21T09:00:00.000Z" }, { t: fr, now: NOW })).toBeNull();
  });
});
