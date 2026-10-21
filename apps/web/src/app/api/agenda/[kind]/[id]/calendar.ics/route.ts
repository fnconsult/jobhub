import { createI18n } from "@jobhub/shared/i18n";
import { NextResponse } from "next/server";
import { agendaItemRefFrom, calendarFile } from "@/agenda/calendar-file";
import { frenchDay } from "@/agenda/calendar";
import { getAgenda } from "@/agenda/server";
import { getCurrentCandidate } from "@/auth/server";
import { localeOf } from "@/i18n/server";
import { routes } from "@/routes";

/**
 * Downloads one of the Candidate's Agenda Items as a Calendar file (.ics, ADR-0029), in French time,
 * in their Interface Language. A Cancelled Agenda Item, an Unscheduled Coaching Session and another
 * Candidate's item have none: 404.
 * 200 text/calendar · 401 · 404
 */
export async function GET(request: Request, { params }: RouteContext<"/api/agenda/[kind]/[id]/calendar.ics">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { kind, id } = await params;
  const ref = agendaItemRefFrom(kind, id);
  const item = ref ? await getAgenda().item(candidate.id, ref) : null;
  const locale = localeOf(candidate);
  const now = new Date();
  const agendaUrl = new URL(routes.agenda(), process.env.APP_URL ?? request.url).href;
  const file = item ? calendarFile(item, { now, agendaUrl, locale }) : null;
  if (!item || !file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const t = createI18n(locale).t;
  const fileName = t(item.kind === "interview" ? "agenda.calendarFile.fileName" : "agenda.calendarFile.sessionFileName", { day: frenchDay(item.scheduledAt) });
  return new Response(file, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
