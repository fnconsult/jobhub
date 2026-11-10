import { calendarFileText } from "@jobhub/shared/calendar-file";
import type { TFunction } from "i18next";
import type { AgendaItem } from "./agenda-read";

/**
 * The event « Ajouter au calendrier » fills in on the system's « Nouvel événement » sheet (ADR-0029, #693): what the
 * Candidate sees there before saving it. Its times are instants, so the sheet shows them in the device's zone, the
 * time entered in French time converted.
 */
export interface AgendaEvent {
  /** Stable per Agenda Item, as the web's Calendar file names it. */
  uid: string;
  title: string;
  startDate: Date;
  endDate: Date;
  /** The Interview's place or the Coaching Session's video link, as entered. */
  location?: string;
  /** The video link, the first web address of the location. */
  url?: string;
  /** The Candidate's note. */
  notes?: string;
  /** How many times the item was Rescheduled: the Calendar file's revision. */
  sequence: number;
}

/** How long an Agenda Item lasts when no duration was given (the web's INTERVIEW_DEFAULT_DURATION_MINUTES). */
const DEFAULT_DURATION_MINUTES = 60;
/** The domain that makes an Agenda Item's UID globally unique (the web's Calendar file). */
const UID_DOMAIN = "jobbbox.fr";

const WEB_ADDRESS = /https?:\/\/[^\s<>"]+/i;
/** Punctuation that ends a sentence rather than an address. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'»]+$/;

/**
 * The first http or https web address in `value`, the sentence's punctuation after it left out. Matched, not parsed:
 * React Native's URL has no `canParse`.
 */
function webAddressIn(value: string | undefined): string | undefined {
  const address = value?.match(WEB_ADDRESS)?.[0].replace(TRAILING_PUNCTUATION, "");
  return address && /^https?:\/\/[^/?#]+/i.test(address) ? address : undefined;
}

/** Whether `item` can go to a calendar: every dated Agenda Item but a Cancelled one (no Calendar file for it). */
export const canAddToCalendar = (item: AgendaItem) => !(item.kind === "interview" && item.cancelledAt);

/** The event for `item`, its words in the Interface Language (`t`); null for a Cancelled Agenda Item. */
export function agendaEvent(item: AgendaItem, t: TFunction): AgendaEvent | null {
  if (!canAddToCalendar(item)) return null;
  const startDate = new Date(item.scheduledAt);
  const endDate = new Date(startDate.getTime() + (item.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000);
  const title =
    item.kind === "interview"
      ? item.employer
        ? t("agenda.calendarFile.interviewTitle", { job: item.jobTitle, employer: item.employer })
        : t("agenda.calendarFile.interviewTitleNoEmployer", { job: item.jobTitle })
      : t("agenda.calendarFile.sessionTitle", { name: item.coach.name });
  const location = (item.kind === "interview" ? item.place : item.videoLink) || undefined;
  return {
    uid: `${item.kind === "interview" ? "interview" : "coaching-session"}-${item.id}@${UID_DOMAIN}`,
    title,
    startDate,
    endDate,
    location,
    url: webAddressIn(location),
    notes: item.note || undefined,
    sequence: item.reschedules.length,
  };
}

/** The Calendar file (.ics) of `item`, made `now`, for the share sheet; null for a Cancelled Agenda Item. */
export function agendaCalendarFile(item: AgendaItem, { t, now }: { t: TFunction; now: Date }): string | null {
  const event = agendaEvent(item, t);
  if (!event) return null;
  return calendarFileText(
    {
      uid: event.uid,
      timeZone: item.kind === "coachingSession" ? item.timeZone : undefined,
      start: event.startDate,
      end: event.endDate,
      sequence: event.sequence,
      summary: event.title,
      location: event.location,
      url: event.url,
      description: event.notes ?? "",
    },
    { now },
  );
}
