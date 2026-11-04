/**
 * The Agenda as `GET /api/agenda` answers it (#684, `AgendaResponse` in `@jobhub/shared`'s reads): « À planifier »
 * first, then the Agenda Items by day in French time. Every instant is an ISO 8601 date and time in UTC, a day an ISO
 * date in French time (ADR-0028); an absent value is null.
 *
 * The same shape as #684's shared type, written here until that lands; then this file re-exports it.
 */
export type Reschedule = { previousAt: string; newAt: string | null; by: "candidate" | "coach"; at: string };

/** An Interview as the Agenda shows it: it leads to its Application's Interviews Section. */
export type InterviewAgendaItem = {
  kind: "interview";
  id: string;
  applicationId: string;
  jobTitle: string;
  employer: string | null;
  scheduledAt: string;
  durationMinutes: number | null;
  format: "on_site" | "video" | "phone" | null;
  place: string;
  note: string | null;
  cancelledAt: string | null;
  reschedules: Reschedule[];
};

/** A dated Coaching Session as the Agenda shows it: it leads to its Human Coach. `changedBy` "coach": « modifié par le coach ». */
export type CoachingSessionAgendaItem = {
  kind: "coachingSession";
  id: string;
  coach: { id: string; name: string };
  scheduledAt: string;
  durationMinutes: number | null;
  videoLink: string | null;
  note: string | null;
  changedBy: "candidate" | "coach";
  reschedules: Reschedule[];
};

export type AgendaItem = InterviewAgendaItem | CoachingSessionAgendaItem;

/** A paid Coaching Session with no date yet, with its Human Coach's booking link. */
export type UnscheduledCoachingSession = { id: string; coach: { id: string; name: string; bookingUrl: string }; paidAt: string; reschedules: Reschedule[] };

export type Agenda = { toSchedule: UnscheduledCoachingSession[]; days: { day: string; items: AgendaItem[] }[] };
