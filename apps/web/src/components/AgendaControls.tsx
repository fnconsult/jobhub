"use client";

import { useRouter } from "next/navigation";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import type { AgendaView } from "@/agenda/calendar";
import { routes } from "@/routes";

/** Where this browser keeps the Agenda view last picked (ADR-0028). */
export const AGENDA_VIEW_STORAGE_KEY = "jobbbox.agendaView";

/**
 * Remembers the Agenda view in this browser. On an address that names a view it
 * keeps that view; on one that names none (`restore`, the Sidebar's link), it
 * brings back the week or month last picked. The list is the default, so it
 * stays when nothing was kept or the browser blocks storage.
 */
export function AgendaViewMemory({ view, restore }: { view: AgendaView; restore: boolean }) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (!restore) {
        window.localStorage.setItem(AGENDA_VIEW_STORAGE_KEY, view);
        return;
      }
      const kept = window.localStorage.getItem(AGENDA_VIEW_STORAGE_KEY);
      if (kept === "semaine" || kept === "mois") router.replace(routes.agendaCalendar(kept));
    } catch {
      // Storage blocked (a private window, cleared site data): the list it is.
    }
  }, [view, restore, router]);
  return null;
}

/**
 * A day of the month grid: a submit button of the grid's GET form (`date` = the
 * day), so it works without JavaScript; with it, it goes to the day's address in
 * place, keeping the scroll and the focus on the button.
 */
export function AgendaDayButton({ day, href, label, selected, today, className, children }: { day: string; href: string; label: string; selected: boolean; today: boolean; className?: string; children: ReactNode }) {
  const router = useRouter();
  function choose(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    router.push(href, { scroll: false });
  }
  return (
    <button type="submit" name="date" value={day} className={className} aria-label={label} aria-pressed={selected} aria-current={today ? "date" : undefined} onClick={choose}>
      {children}
    </button>
  );
}
