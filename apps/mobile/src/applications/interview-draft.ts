import type { InterviewFormat } from "@jobhub/shared";
import type { InterviewRead } from "@jobhub/shared/reads";
import { inFrenchTime, wallClockOf } from "../agenda/french-time";

/**
 * An Interview as its form holds it, every value as typed: its day (« 12/11/2026 ») and time (« 14:30 »), French time;
 * its duration in minutes; its format; its place or link; its note. "" for nothing said.
 */
export interface InterviewDraft {
  date: string;
  time: string;
  durationMinutes: string;
  format: InterviewFormat | "";
  place: string;
  note: string;
}

export const EMPTY_INTERVIEW_DRAFT: InterviewDraft = { date: "", time: "", durationMinutes: "", format: "", place: "", note: "" };

/** An Interview the web app holds, as its form starts from it to change it (a new date is a Reschedule). */
export function draftOf(interview: InterviewRead): InterviewDraft {
  return {
    ...inFrenchTime(interview.scheduledAt),
    durationMinutes: interview.durationMinutes === null ? "" : String(interview.durationMinutes),
    format: interview.format ?? "",
    place: interview.place,
    note: interview.note,
  };
}

/**
 * What the web app is sent for a draft, as the web's form sends it (apps/web/src/components/InterviewFields.tsx): the
 * date and time as French time without an offset; a duration typed as digits as a number, anything else as typed for
 * the web app to refuse; "" for a format, a duration, a place or a note left empty.
 */
export function interviewBody(draft: InterviewDraft) {
  const duration = draft.durationMinutes.trim();
  return {
    scheduledAt: wallClockOf(draft.date, draft.time),
    durationMinutes: /^\d+$/.test(duration) ? Number(duration) : duration,
    format: draft.format,
    place: draft.place,
    note: draft.note,
  };
}
