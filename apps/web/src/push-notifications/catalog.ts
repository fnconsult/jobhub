/**
 * The events a Push notification is sent for (CONTEXT.md, ADR-0076), each with its switch in Mon compte's Rappels.
 * A Candidate's, and a Human Coach's (who signs in to the same kind of account, ADR-0016). Each is on until the person
 * switches it off; nothing goes before they let the app notify them on a device, and email stays where it already is.
 *
 * A notification names the object it is about by its id alone: its text never names a company, a job or a person
 * (messages.ts), and the app fetches the rest once opened.
 */

/** Who an event is for: the Rappels Section shows a Human Coach their own events too. */
export type PushAudience = "candidate" | "human_coach";

export const PUSH_EVENTS = [
  { id: "job_search_results", audience: "candidate" },
  { id: "job_digest", audience: "candidate" },
  { id: "appointment_reminder", audience: "candidate" },
  { id: "coach_review", audience: "candidate" },
  { id: "coaching_session_changed", audience: "candidate" },
  { id: "follow_up_due", audience: "candidate" },
  { id: "coach_access_granted", audience: "human_coach" },
  { id: "coaching_session_paid", audience: "human_coach" },
  { id: "coaching_session_changed_by_candidate", audience: "human_coach" },
] as const satisfies readonly { id: string; audience: PushAudience }[];

/** An event a person can switch off. */
export type PushEvent = (typeof PUSH_EVENTS)[number]["id"];

export const PUSH_EVENT_IDS: readonly PushEvent[] = PUSH_EVENTS.map((event) => event.id);

export const isPushEvent = (value: unknown): value is PushEvent => PUSH_EVENT_IDS.includes(value as PushEvent);

/** The events `audiences` see in Rappels, in the catalogue's order. */
export const pushEventsFor = (audiences: readonly PushAudience[]): PushEvent[] => PUSH_EVENTS.filter((event) => audiences.includes(event.audience)).map((event) => event.id);

/**
 * One Push notification: its event and the id of the object it opens, nothing else. `test` is the one a super-admin
 * sends from the Back Office to their own devices (#698): no switch turns it off.
 */
export type PushNotification =
  | { event: "job_search_results"; jobSearchId: string }
  | { event: "job_digest"; jobDigestId: string }
  | { event: "appointment_reminder" }
  | { event: "coach_review"; applicationId: string }
  | { event: "coaching_session_changed" }
  | { event: "follow_up_due"; applicationId: string }
  | { event: "coach_access_granted"; candidateId: string }
  | { event: "coaching_session_paid" }
  | { event: "coaching_session_changed_by_candidate" }
  | { event: "test" };

/** What a notification's event is: one of the catalogue's, or the test. */
export type PushNotificationEvent = PushNotification["event"];
