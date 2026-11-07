import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { routes } from "../routes";
import type { PushNotification } from "./catalog";

/**
 * What a device shows and opens: a fixed title and body, and the web app's path of the object (the app's deep link);
 * and, when it was counted, `badge`: the app icon's badge, the person's offers à traiter at sending (#818, ADR-0090).
 */
export interface PushMessage {
  title: string;
  body: string;
  path: string;
  badge?: number;
}

/** The path a notification opens: its object's page, by id; the Agenda, the coach space or home for an event about no one object. */
function pathOf(notification: PushNotification): string {
  switch (notification.event) {
    case "job_search_results":
      return routes.jobSearch(notification.jobSearchId);
    case "job_digest":
      return routes.jobDigest(notification.jobDigestId);
    case "coach_review":
    case "follow_up_due":
      return routes.application(notification.applicationId);
    case "appointment_reminder":
    case "coaching_session_changed":
      return routes.agendaList();
    case "coach_access_granted":
      return routes.coachSpaceCandidate(notification.candidateId);
    case "coaching_session_paid":
    case "coaching_session_changed_by_candidate":
      return routes.coachSpace;
    case "test":
      return "/";
  }
}

/**
 * A Push notification as a device shows it, in `language`. Its text is the event's fixed gabarit: nothing is filled in,
 * so it never names a company, a job or a person (ADR-0076: a lock screen is public). The rest is read once the app opens.
 */
export function pushMessage(notification: PushNotification, language: Locale): PushMessage {
  const { t } = createI18n(language);
  return {
    title: t(`pushNotifications.messages.${notification.event}.title`),
    body: t(`pushNotifications.messages.${notification.event}.body`),
    path: pathOf(notification),
  };
}
