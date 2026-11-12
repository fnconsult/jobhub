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
  { id: "coaching_cancellation", audience: "candidate" },
  {id:"coaching_session_hour",audience:"candidate"},
  { id: "follow_up_due", audience: "candidate" },
  { id: "coach_access_granted", audience: "human_coach" },
  { id: "coaching_session_paid", audience: "human_coach" },
  { id: "coaching_session_changed_by_candidate", audience: "human_coach" },
  {id:"coaching_session_updated",audience:"human_coach"},
  {id:"coaching_session_hour_for_coach",audience:"human_coach"},
  {id:"coaching_session_eve",audience:"human_coach"},
  {id:"coaching_day",audience:"human_coach"},
] as const satisfies readonly { id: string; audience: PushAudience }[];

/** An event a person can switch off. */
export type PushEvent = (typeof PUSH_EVENTS)[number]["id"];

export const PUSH_EVENT_IDS: readonly PushEvent[] = PUSH_EVENTS.map((event) => event.id);

export const isPushEvent = (value: unknown): value is PushEvent => PUSH_EVENT_IDS.includes(value as PushEvent);

/** Who a person is, as far as their events go: every account a Candidate's, a Human Coach's their own too. */
export const pushAudiencesOf = (isHumanCoach: boolean): PushAudience[] => (isHumanCoach ? ["candidate", "human_coach"] : ["candidate"]);

/**
 * The events that existed before the Human Coach epic (#867): the only ones while « Espace coach v2 » is off (ADR-0107).
 * The others are the epic's: not shown in Rappels, not queued, not sent while it is off.
 */
export const LEGACY_PUSH_EVENTS: readonly PushEvent[] = [
  "job_search_results",
  "job_digest",
  "appointment_reminder",
  "coach_review",
  "coaching_session_changed",
  "follow_up_due",
  "coach_access_granted",
  "coaching_session_paid",
  "coaching_session_changed_by_candidate",
];

/** Whether `event` exists while « Espace coach v2 » is `coachSpaceV2`: every event when on, the legacy ones and the test when off. */
export const pushEventAvailable = (event: PushNotificationEvent, coachSpaceV2: boolean): boolean =>
  coachSpaceV2 || event === "test" || LEGACY_PUSH_EVENTS.includes(event);

/**
 * The events `audiences` see in Rappels, in the catalogue's order. With « Espace coach v2 » off (the default), the events
 * before the epic only, as before it.
 */
export const pushEventsFor = (audiences: readonly PushAudience[], coachSpaceV2 = false): PushEvent[] =>
  PUSH_EVENTS.filter((event) => audiences.includes(event.audience) && pushEventAvailable(event.id, coachSpaceV2)).map((event) => event.id);

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
  | { event: "coaching_cancellation" }
  | { event: "follow_up_due"; applicationId: string }
  | { event: "coach_access_granted"; candidateId: string }
  | { event: "coaching_session_paid" }
  | { event: "coaching_session_changed_by_candidate" }
  | {event:'coaching_session_hour'|'coaching_session_hour_for_coach'|'coaching_session_eve';sessionId:string;noticeKey:string}
  | {event:'coaching_session_updated'}
  | {event:'coaching_day';noticeKey:string}
  | { event: "test" };

/** What a notification's event is: one of the catalogue's, or the test. */
export type PushNotificationEvent = PushNotification["event"];

/** The worker's queue a Push notification is sent from: { personId, notification, platform? }. */
export const PUSH_NOTIFICATIONS_QUEUE = "push-notifications.send";

/** Which id each event's notification carries, by its field's name; none for an event about no one object. */
const ID_FIELD: Record<PushNotificationEvent, "jobSearchId" | "jobDigestId" | "applicationId" | "candidateId" | "sessionId" | "noticeKey" | null> = {
  job_search_results: "jobSearchId",
  job_digest: "jobDigestId",
  appointment_reminder: null,
  coach_review: "applicationId",
  coaching_session_changed: null,
  coaching_cancellation: null,
  follow_up_due: "applicationId",
  coach_access_granted: "candidateId",
  coaching_session_paid: null,
  coaching_session_changed_by_candidate: null,
  coaching_session_hour:"sessionId",
  coaching_session_hour_for_coach:"sessionId",
  coaching_session_eve:"sessionId",
  coaching_session_updated:null,
  coaching_day:"noticeKey",
  test: null,
};

/** A notification as a queued job carries it (untrusted), or null when it is not one: its event and its object's id, nothing more. */
export function pushNotificationOf(value: unknown): PushNotification | null {
  if (typeof value !== "object" || value === null) return null;
  const { event } = value as { event?: unknown };
  if (typeof event !== "string" || !Object.hasOwn(ID_FIELD, event)) return null;
  const reminder=['coaching_session_hour','coaching_session_hour_for_coach','coaching_session_eve','coaching_day'].includes(event);
  const noticeKey=(value as {noticeKey?:unknown}).noticeKey;
  if(reminder&&(typeof noticeKey!=='string'||!/^[0-9a-f]{64}$/.test(noticeKey)))return null;
  const field = ID_FIELD[event as PushNotificationEvent];
  if (!field) return { event } as PushNotification;
  const id = (value as Record<string, unknown>)[field];
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? ({ event, [field]: id,...reminder?{noticeKey}:{} } as PushNotification) : null;
}
