import type { AgendaResponse, ApplicationRow, ApplicationsResponse } from "@jobhub/shared/reads";
import { todayLines } from "./today";

const NOW = new Date("2026-11-12T09:00:00.000Z");

const interview = (id: string, scheduledAt: string, cancelledAt: string | null = null) => ({
  kind: "interview" as const,
  id,
  applicationId: `a-${id}`,
  jobTitle: "Responsable qualité",
  employer: "Aéroline",
  scheduledAt,
  durationMinutes: 45,
  format: null,
  place: "",
  note: null,
  cancelledAt,
  reschedules: [],
});
const agenda = (items: AgendaResponse["days"][number]["items"], toSchedule: AgendaResponse["toSchedule"] = []): AgendaResponse => ({
  toSchedule,
  days: [{ day: "2026-11-12", items }],
});
const row = (id: string, toHandle: ApplicationRow["toHandle"], archived = false): ApplicationRow => ({
  id,
  title: `Poste ${id}`,
  employer: `Employeur ${id}`,
  status: "applied",
  matchScore: null,
  toHandle,
  nextDeadline: null,
  expired: false,
  reportedByYou: false,
  archived,
});
const applications = (rows: ApplicationRow[]): ApplicationsResponse => ({ applications: rows, toHandle: rows.filter((r) => r.toHandle).length, archivedHidden: 0 });

describe("« Votre point du jour », the home page's card (#979)", () => {
  it("has no line when nothing calls for the Candidate's action, or nothing was read", () => {
    expect(todayLines({}, NOW)).toEqual([]);
    expect(todayLines({ offersToHandle: 0, agenda: agenda([]), applications: applications([row("a", null)]), conversations: { conversations: [] } }, NOW)).toEqual([]);
  });

  it("lists, in order, the offers à traiter, the next Interview, the Follow-ups ready and the Free conversation to resume", () => {
    const lines = todayLines(
      {
        offersToHandle: 7,
        agenda: agenda([interview("late", "2026-11-14T09:30:00.000Z"), interview("next", "2026-11-13T08:00:00.000Z")]),
        applications: applications([row("a", "follow_up"), row("b", "abandon_suggestion"), row("c", "follow_up")]),
        conversations: {
          conversations: [
            { id: "c1", title: "Préparer l'entretien", subject: null, profile: null, lastMessageAt: "2026-11-11T17:12:00.000Z" },
            { id: "c2", title: "Plus ancienne", subject: null, profile: null, lastMessageAt: "2026-11-01T17:12:00.000Z" },
          ],
        },
      },
      NOW,
    );
    expect(lines.map((line) => line.kind)).toEqual(["offersToHandle", "interview", "followUps", "resume"]);
    expect(lines[1]).toMatchObject({ applicationId: "a-next", scheduledAt: "2026-11-13T08:00:00.000Z" });
    expect(lines[2]).toEqual({ kind: "followUps", count: 2, titles: ["Poste a · Employeur a", "Poste c · Employeur c"], applicationId: null });
    expect(lines[3]).toMatchObject({ conversationId: "c1" });
  });

  it("skips an Interview already past or cancelled, and names the Coaching Session that comes next", () => {
    const session = {
      kind: "coachingSession" as const,
      id: "s1",
      coach: { id: "h1", name: "Claire Martin" },
      scheduledAt: "2026-11-12T15:00:00.000Z",
      durationMinutes: 60,
      videoLink: null,
      note: null,
      changedBy: "candidate" as const,
      reschedules: [],
    };
    const lines = todayLines({ agenda: agenda([interview("past", "2026-11-12T07:00:00.000Z"), interview("off", "2026-11-12T10:00:00.000Z", "2026-11-10T10:00:00.000Z"), session]) }, NOW);
    expect(lines).toEqual([{ kind: "coachingSession", scheduledAt: session.scheduledAt, coachName: "Claire Martin", id: "s1" }]);
  });

  it("counts the Unscheduled Coaching Sessions when no Agenda Item is to come", () => {
    const unscheduled = { id: "u1", coach: { id: "h1", name: "Claire Martin", bookingUrl: "https://cal.example/claire" }, paidAt: "2026-11-01T10:00:00.000Z", reschedules: [] };
    expect(todayLines({ agenda: agenda([], [unscheduled, { ...unscheduled, id: "u2" }]) }, NOW)).toEqual([{ kind: "toSchedule", count: 2 }]);
  });

  it("opens the Application itself when one alone is to follow up, and leaves Archived ones out", () => {
    expect(todayLines({ applications: applications([row("a", "follow_up"), row("z", "follow_up", true)]) }, NOW)).toEqual([
      { kind: "followUps", count: 1, titles: ["Poste a · Employeur a"], applicationId: "a" },
    ]);
  });
});
