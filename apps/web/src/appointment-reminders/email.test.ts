import { describe, expect, it } from "vitest";
import { appointmentReminderEmail, type ReminderEmailItem } from "./email";

const items: ReminderEmailItem[] = [
  { table: "interview", scheduledAt: new Date("2026-10-21T07:00:00Z"), durationMinutes: 60, note: null, title: "DAF H/F", employer: "Acme Industrie", format: "on_site", place: "Lyon" },
  { table: "coaching_session", scheduledAt: new Date("2026-10-21T12:30:00Z"), durationMinutes: 45, note: null, coach: "Sophie Martin", videoLink: null },
];
const links = { agendaUrl: "https://app.jobbbox.fr/agenda?vue=liste", settingsUrl: "https://app.jobbbox.fr/compte/rappels" };

describe("the Appointment Reminder's Coaching Session time (« Espace coach v2 », ADR-0107)", () => {
  it("off (or not given): French time, like an Interview's, as before the Human Coach epic, whatever time zone it is given", () => {
    const before = appointmentReminderEmail({ items, ...links }, "fr");
    expect(before.text).toContain("14:30 · Séance de coaching avec Sophie Martin");
    expect(before.text).not.toContain("Europe/Paris");
    expect(appointmentReminderEmail({ items, ...links, coachSpaceV2: false, timeZone: "America/Montreal" }, "fr")).toEqual(before);
    expect(appointmentReminderEmail({ items, ...links }, "en").text).toContain("2:30 PM · Coaching session with Sophie Martin");
  });

  it("on: the Candidate's time zone, with Paris alongside (ADR-0096); an Interview's still in French time", () => {
    const text = appointmentReminderEmail({ items, ...links, coachSpaceV2: true, timeZone: "America/Montreal" }, "fr").text;
    expect(text).toContain("(America/Montreal)");
    expect(text).toContain("08:30");
    expect(text).toContain("14:30 (Europe/Paris) · Séance de coaching avec Sophie Martin");
    expect(text).toContain("09:00 · Entretien");
    expect(appointmentReminderEmail({ items, ...links, coachSpaceV2: true }, "fr").text).toContain("14:30 (Europe/Paris) · Séance de coaching");
  });
});
