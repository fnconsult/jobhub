/**
 * The Calendar file (ADR-0029): one Agenda Item as an iCalendar (.ics) file, written by hand
 * (RFC 5545, no ics package), for « Ajouter à mon calendrier ». See docs/research/issue-252.md.
 *
 * What the event says is composed here; `@jobhub/shared/calendar-file` writes it (French time,
 * escaping, folding), as it does for the app's share sheet. The UID is stable per Agenda Item, so
 * a later download names the same event.
 */
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { calendarFileText, FRENCH_TIME_ZONE } from "@jobhub/shared/calendar-file";
import { interviewEndsAt, interviewPlaceParts } from "../applications";
import type { AgendaItem, AgendaItemRef } from "./index";

/** The domain that makes an Agenda Item's UID globally unique. */
const UID_DOMAIN = "jobbbox.fr";

export interface CalendarFileOptions {
  /** When the file is made: its DTSTAMP. */
  now: Date;
  /** The Agenda's absolute address, linked from the DESCRIPTION. */
  agendaUrl: string;
  /** The Candidate's Interface Language, for the SUMMARY and DESCRIPTION. */
  locale: Locale;
  /** « Espace coach v2 » (ADR-0107): off, the file is the one before the Human Coach epic (Paris time, `timeZone` ignored). */
  coachSpaceV2?: boolean;
  /** The Candidate's coaching time zone, for a Coaching Session's file under « Espace coach v2 ». */
  timeZone?: string;
}

/** The event's zone: none off « Espace coach v2 » (as before it); on, the Candidate's for a Coaching Session, else Paris. */
function eventZone(item: AgendaItem, options: CalendarFileOptions): string | undefined {
  if (!options.coachSpaceV2) return undefined;
  return item.kind === "coachingSession" ? (options.timeZone ?? FRENCH_TIME_ZONE) : FRENCH_TIME_ZONE;
}

/** The first http or https web address in `value`, as it is shown linked on the Agenda, if it is a valid URI. */
function webAddressIn(value: string | undefined): string | undefined {
  const href = value ? interviewPlaceParts(value).find((part) => part.href)?.href : undefined;
  if (!href || !URL.canParse(href)) return undefined;
  return new URL(href).href === href ? href : undefined;
}

/** Whether `item` has a Calendar file: every dated Agenda Item but a Cancelled one. */
export const hasCalendarFile = (item: AgendaItem) => !(item.kind === "interview" && item.cancelledAt);

/**
 * The Calendar file of `item`, or null for a Cancelled Agenda Item, which has none. Its SEQUENCE
 * counts the item's Reschedules: each new download is a later revision of the same event.
 */
export function calendarFile(item: AgendaItem, options: CalendarFileOptions): string | null {
  if (!hasCalendarFile(item)) return null;
  const t = createI18n(options.locale).t;
  const uid = `${item.kind === "interview" ? "interview" : "coaching-session"}-${item.id}@${UID_DOMAIN}`;
  const endsAt = interviewEndsAt({ scheduledAt: item.scheduledAt, durationMinutes: item.durationMinutes ?? null });
  const summary =
    item.kind === "interview"
      ? item.employer
        ? t("agenda.calendarFile.interviewTitle", { job: item.jobTitle, employer: item.employer })
        : t("agenda.calendarFile.interviewTitleNoEmployer", { job: item.jobTitle })
      : t("agenda.calendarFile.sessionTitle", { name: item.coach.name });
  const location = item.kind === "interview" ? item.place : item.videoLink;
  const url = webAddressIn(location);
  const description = [item.note, t("agenda.calendarFile.seeInAgenda", { url: options.agendaUrl })].filter(Boolean).join("\n\n");
  return calendarFileText(
    { uid, timeZone: eventZone(item, options), start: item.scheduledAt, end: endsAt, sequence: item.reschedules.length, summary, location, url, description },
    { now: options.now },
  );
}

/** The kind of Agenda Item as the Calendar file's address names it. */
const URL_KINDS = { interview: "interviews", coachingSession: "coaching-sessions" } as const satisfies Record<AgendaItemRef["kind"], string>;

/** Where the Calendar file of the Agenda Item `ref` is downloaded. */
export const calendarFileUrl = ({ kind, id }: AgendaItemRef) => `/api/agenda/${URL_KINDS[kind]}/${encodeURIComponent(id)}/calendar.ics`;

/** The Agenda Item a Calendar file's address names (`kind` and `id` as in calendarFileUrl), or null for an unknown kind. */
export function agendaItemRefFrom(kind: string, id: string): AgendaItemRef | null {
  const found = (Object.keys(URL_KINDS) as AgendaItemRef["kind"][]).find((key) => URL_KINDS[key] === kind);
  return found ? { kind: found, id } : null;
}
