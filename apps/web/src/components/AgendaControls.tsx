"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

/**
 * The day last chosen in the month grid, until its new button takes the focus back: in the Work Pane (#606) the day's
 * address draws the month anew (InWorkPane mounts one view per address), the chosen button gone with the focus.
 */
let chosen: string | null = null;

/**
 * A day of the month grid: a submit button of the grid's GET form (`date` = the
 * day), so it works without JavaScript; with it, it goes to the day's address in
 * place, keeping the scroll and the focus on the button.
 */
export function AgendaDayButton({ day, href, label, selected, today, className, children }: { day: string; href: string; label: string; selected: boolean; today: boolean; className?: string; children: ReactNode }) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Drawn first into the pane's previous body, out of the page, then into its new one: the focus once it is there.
    if (chosen !== day || !button.current?.isConnected) return;
    chosen = null;
    button.current?.focus();
  }, [day]);
  function choose(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    chosen = day;
    router.push(href, { scroll: false });
  }
  return (
    <button ref={button} type="submit" name="date" value={day} className={className} aria-label={label} aria-pressed={selected} aria-current={today ? "date" : undefined} onClick={choose}>
      {children}
    </button>
  );
}
