"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, type ReactNode } from "react";

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
