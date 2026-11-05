/**
 * The Agenda as `GET /api/agenda` answers it (#684, `@jobhub/shared/reads`), under the names the app's Agenda uses:
 * « À planifier » first, then the Agenda Items by day in French time. Every instant is an ISO 8601 date and time in UTC,
 * a day an ISO date in French time (ADR-0028); an absent value is null.
 */
export {
  agendaResponseSchema as agendaSchema,
  type AgendaItemRead as AgendaItem,
  type AgendaResponse as Agenda,
  type CoachingSessionAgendaItemRead as CoachingSessionAgendaItem,
  type InterviewAgendaItemRead as InterviewAgendaItem,
  type RescheduleRead as Reschedule,
  type UnscheduledCoachingSessionRead as UnscheduledCoachingSession,
} from "@jobhub/shared/reads";
