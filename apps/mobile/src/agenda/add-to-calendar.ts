import type { TFunction } from "i18next";
import type { AgendaItem } from "./agenda-read";
import { agendaCalendarFile, agendaEvent, type AgendaEvent } from "./calendar-event";
import { frenchDay } from "./french-time";

/**
 * The system's two sheets « Ajouter au calendrier » uses (ADR-0029: the app never reads the calendar and syncs
 * nothing). `newEvent` opens « Nouvel événement » filled in and says "unavailable" when the calendar cannot be used
 * (access refused, or no calendar); `shareFile` opens the share sheet on a file.
 */
export interface CalendarSheets {
  newEvent(event: AgendaEvent): Promise<"shown" | "unavailable">;
  shareFile(name: string, content: string): Promise<void>;
}

/**
 * Adds `item` to the device's calendar: the « Nouvel événement » sheet, or, when the calendar cannot be used, its
 * Calendar file (.ics) through the share sheet. Says which ("event", "file"); "none" for a Cancelled Agenda Item,
 * which has neither.
 */
export async function addToCalendar(item: AgendaItem, { sheets, t, now }: { sheets: CalendarSheets; t: TFunction; now: Date }): Promise<"event" | "file" | "none"> {
  const event = agendaEvent(item, t);
  const file = agendaCalendarFile(item, { t, now });
  if (!event || !file) return "none";
  const shown = await sheets.newEvent(event).catch(() => "unavailable" as const);
  if (shown === "shown") return "event";
  const day = frenchDay(event.startDate);
  await sheets.shareFile(t(item.kind === "interview" ? "agenda.calendarFile.fileName" : "agenda.calendarFile.sessionFileName", { day }), file);
  return "file";
}
