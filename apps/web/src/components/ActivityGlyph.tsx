import type { Activity } from "@jobhub/shared";

/**
 * The glyph of an Activity (ADR-0034, #319 §5): what a running step is doing, drawn in the line icons' style (24 grid,
 * stroke 1.5; the prototype's still frames). It breathes while the step runs, and holds still under
 * prefers-reduced-motion (app.css). Decoration only: the step's label in words always sits beside it.
 */
const BRAIN = [
  "M6 16.5C3.8 16 2.5 14.2 2.5 12c0-1.2.4-2.3 1.1-3.1C3.7 6.6 5.6 4.8 8 4.5c1-.9 2.4-1.4 3.9-1.2 1.2-.5 2.6-.4 3.7.3 2.3.3 4.2 2 4.8 4.2 1 .7 1.6 1.9 1.6 3.2 0 2.6-2.1 4.7-4.7 4.7H6z",
  "M14.2 16.5c0 1.6 1.3 2.8 2.9 2.8 1.5 0 2.6-1.1 2.6-2.6",
  "M11.2 16.5l-.6 4",
  "M4 12.6c2.5-.4 5 .2 7.2 1.8",
  "M12.4 3.6c-.6 2.2.6 3.6-.2 5.8-.5 1.3-.2 2.4.6 3.2",
];

const PATHS: Record<Activity, readonly string[]> = {
  think: BRAIN,
  // A model writes its text: it thinks first.
  think_write: [...BRAIN, "M17.5 20.5h4"],
  // A feather writing a document.
  write: ["M20.2 3.8a6 6 0 0 0-8.5 0l-5.7 5.7v6.5h6.5l5.7-5.7a6 6 0 0 0 0-8.5z", "M15 7L4 18", "M16.5 12.5H9"],
  // A magnifier.
  search: ["M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M14.3 14.3l4.2 4.2"],
  // A globe.
  web_search: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3 12h18", "M4.5 7.5h15M4.5 16.5h15", "M12 3a6 9 0 1 0 0 18a6 9 0 1 0 0-18z"],
  // An open book.
  read: ["M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z", "M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"],
  // A checklist: rules, no AI.
  compute: ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5", "M4 12l1.2 1.2 2.3-2.2", "M4 18l1.2 1.2 2.3-2.2"],
};

export function ActivityGlyph({ activity }: { activity: Activity }) {
  return (
    <svg className="activity-glyph" data-activity={activity} viewBox="0 0 24 24" aria-hidden focusable={false}>
      {PATHS[activity].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
