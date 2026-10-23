/**
 * The day `offset` days from `now`, in French time ("2026-10-30"). Counted on the calendar:
 * a French day lasts 23 or 25 hours when the clocks change, so adding `offset` × 24 hours to
 * `now` would land on the wrong day in the hour after midnight (two offsets giving one day).
 */
export function parisDay(offset: number, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
