import type { Agenda, AgendaItem } from "./agenda/agenda-read";

/**
 * Sample data, until the app reads the API (ADR-0076: the GETs added to `/api/*`): one Application and two Free
 * conversations, enough to reach every kind of page, and one Job Offer of a Job Search.
 */
export const SAMPLE_APPLICATIONS = [{ id: "a1", title: "Aéroline · Responsable qualité" }] as const;
export const SAMPLE_FREE_CONVERSATIONS = [
  { id: "c1", title: "Me présenter en deux minutes" },
  { id: "c2", title: "Préparer la négociation du salaire" },
] as const;
export const SAMPLE_JOB_OFFERS = [
  { id: "o1", jobSearchId: "r1", title: "Responsable qualité · Aéroline", postingUrl: "https://www.example.com/offres/aeroline-responsable-qualite" },
] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FRENCH_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * A sample Agenda (`GET /api/agenda`'s shape, #684) around `now`: a session to schedule, the sample Application's
 * Interview, a Cancelled Interview and a session the Human Coach moved, enough to show every kind of item.
 */
export function sampleAgenda(now: Date): Agenda {
  const at = (days: number, hours: number) => new Date(now.getTime() + days * DAY + hours * HOUR).toISOString();
  const items: AgendaItem[] = [
    { kind: "interview", id: "i1", applicationId: SAMPLE_APPLICATIONS[0].id, jobTitle: "Responsable qualité", employer: "Aéroline", scheduledAt: at(1, 2), durationMinutes: 45, format: "video", place: "Teams : https://teams.microsoft.com/l/meetup-join/exemple", note: null, cancelledAt: null, reschedules: [] },
    { kind: "interview", id: "i2", applicationId: SAMPLE_APPLICATIONS[0].id, jobTitle: "Responsable qualité", employer: "Aéroline", scheduledAt: at(1, 5), durationMinutes: null, format: "on_site", place: "12 rue de la Paix, Paris", note: null, cancelledAt: at(-1, 0), reschedules: [] },
    { kind: "coachingSession", id: "s1", coach: { id: "coach-1", name: "Claire Martin" }, scheduledAt: at(3, 1), durationMinutes: 60, videoLink: "https://meet.google.com/exemple", note: null, changedBy: "coach", reschedules: [] },
  ];
  const days = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const day = FRENCH_DAY.format(new Date(item.scheduledAt));
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return {
    toSchedule: [{ id: "s0", coach: { id: "coach-2", name: "Paul Durand", bookingUrl: "https://cal.com/" }, paidAt: at(-2, 0), reschedules: [] }],
    days: [...days].map(([day, dayItems]) => ({ day, items: dayItems })),
  };
}
