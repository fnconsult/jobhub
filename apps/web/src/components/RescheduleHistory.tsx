import type { getServerT } from "@/i18n/server";
import { firstPlannedAt, type Reschedule } from "@/reschedules";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * What changed an Agenda Item's date, for the Candidate: « Reporté · initialement prévu le … » once it was
 * Rescheduled, then an « Historique » disclosure listing every Reschedule and cancellation, oldest first, with
 * who made it (« vous », or the Human Coach by name). Nothing for an item never Rescheduled nor cancelled.
 * `dateTime` formats dates and times in French time.
 */
export function RescheduleHistory({ reschedules, coachName, dateTime, t }: { reschedules: Reschedule[]; coachName?: string; dateTime: Intl.DateTimeFormat; t: T }) {
  if (reschedules.length === 0) return null;
  const firstPlanned = firstPlannedAt(reschedules);
  const format = (date: Date) => dateTime.format(date);
  return (
    <div className="reschedules">
      {firstPlanned ? <p className="rescheduled">{t("agendaChanges.rescheduled", { date: format(firstPlanned) })}</p> : null}
      <details className="reschedule-history">
        <summary>{t("agendaChanges.history")}</summary>
        <ol>
          {reschedules.map((entry, index) => {
            const by = entry.by === "coach" ? (coachName ?? t("agendaChanges.byCoach")) : t("agendaChanges.byYou");
            return (
              <li key={index}>
                {entry.newAt
                  ? t("agendaChanges.historyRescheduled", { at: format(entry.at), from: format(entry.previousAt), to: format(entry.newAt), by })
                  : t("agendaChanges.historyCancelled", { at: format(entry.at), from: format(entry.previousAt), by })}
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}
