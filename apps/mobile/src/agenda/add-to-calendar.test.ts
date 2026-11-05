import { createI18n } from "@jobhub/shared/i18n";
import type { InterviewAgendaItem } from "./agenda-read";
import { addToCalendar, type CalendarSheets } from "./add-to-calendar";

const t = createI18n("fr").t;
const NOW = new Date("2026-10-20T08:00:00.000Z");

const interview: InterviewAgendaItem = {
  kind: "interview",
  id: "i1",
  applicationId: "a1",
  jobTitle: "Responsable qualité",
  employer: "Aéroline",
  scheduledAt: "2026-10-22T12:30:00.000Z",
  durationMinutes: 45,
  format: "video",
  place: "https://teams.example.com/l/abc",
  note: null,
  cancelledAt: null,
  reschedules: [],
};

/** The system's two sheets, recording what they were given; the calendar answers `calendar`. */
function sheets(calendar: () => Promise<"shown" | "unavailable">) {
  const shown = { events: [] as unknown[], files: [] as { name: string; content: string }[] };
  const adapters: CalendarSheets = {
    newEvent: async (event) => {
      shown.events.push(event);
      return calendar();
    },
    shareFile: async (name, content) => {
      shown.files.push({ name, content });
    },
  };
  return { adapters, shown };
}

describe("« Ajouter au calendrier »", () => {
  it("opens the system's « Nouvel événement » sheet, filled in, and shares no file", async () => {
    const { adapters, shown } = sheets(async () => "shown");
    expect(await addToCalendar(interview, { sheets: adapters, t, now: NOW })).toBe("event");
    expect(shown.events).toEqual([expect.objectContaining({ title: "Entretien — Responsable qualité, Aéroline", url: "https://teams.example.com/l/abc" })]);
    expect(shown.files).toEqual([]);
  });

  it("shares the Calendar file through the share sheet when calendar access is refused or unavailable", async () => {
    const { adapters, shown } = sheets(async () => "unavailable");
    expect(await addToCalendar(interview, { sheets: adapters, t, now: NOW })).toBe("file");
    expect(shown.files).toHaveLength(1);
    expect(shown.files[0]!.name).toBe("entretien-2026-10-22.ics");
    expect(shown.files[0]!.content).toContain("DTSTART;TZID=Europe/Paris:20261022T143000");
  });

  it("shares the Calendar file when the calendar sheet fails", async () => {
    const { adapters, shown } = sheets(() => Promise.reject(new Error("no calendar app")));
    expect(await addToCalendar({ ...interview, scheduledAt: "2026-12-07T22:30:00.000Z" }, { sheets: adapters, t, now: NOW })).toBe("file");
    // The day in the name is French time's: 23:30 on 7 December there.
    expect(shown.files.map((file) => file.name)).toEqual(["entretien-2026-12-07.ics"]);
  });

  it("names a Coaching Session's file as a session", async () => {
    const { adapters, shown } = sheets(async () => "unavailable");
    await addToCalendar(
      { kind: "coachingSession", id: "s1", coach: { id: "c1", name: "Claire Martin" }, scheduledAt: "2026-12-07T08:00:00.000Z", durationMinutes: 60, videoLink: null, note: null, changedBy: "candidate", reschedules: [] },
      { sheets: adapters, t, now: NOW },
    );
    expect(shown.files.map((file) => file.name)).toEqual(["seance-2026-12-07.ics"]);
  });

  it("does nothing for a Cancelled Agenda Item: no event, no Calendar file", async () => {
    const { adapters, shown } = sheets(async () => "shown");
    expect(await addToCalendar({ ...interview, cancelledAt: "2026-10-21T09:00:00.000Z" }, { sheets: adapters, t, now: NOW })).toBe("none");
    expect(shown).toEqual({ events: [], files: [] });
  });
});
