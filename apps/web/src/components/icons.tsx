/**
 * Line icons from the Notion-like prototype (#132). Decoration only: each one
 * sits beside its label in words (ADR-0009: no icon-only function), so it is
 * hidden from screen readers.
 */
const PATHS = {
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["M6 6l12 12M18 6L6 18"],
  collapse: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 4v16M15 10l-2 2 2 2"],
  applications: ["M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"],
  jobSearches: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4-4"],
  jobDigests: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 7l9 6 9-6"],
  account: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6.5 18.5c1.5-2 3.4-3 5.5-3s4 1 5.5 3"],
  subscription: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 10h18M7 15h4"],
  profile: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 21c0-4 4-6 8-6s8 2 8 6"],
  chevron: ["M8 10l4 4 4-4"],
  coach: ["M4 5h16v11H9l-5 4z", "M8 9h8M8 12h5"],
  add: ["M12 5v14M5 12h14"],
  conversations: ["M4 6h16M4 12h16M4 18h10"],
  searchAgain: ["M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"],
  // The Back Office's sections (#204).
  planQuotas: ["M4 20V10M10 20V4M16 20v-7M22 20H2"],
  humanCoaches: ["M9 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 5.5a3 3 0 0 1 0 5M18 14.5c2 .8 3 2.8 3 5.5"],
  coachCost: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M15 8.5a4 4 0 1 0 0 7M7 11h6M7 13.5h6"],
  administrators: ["M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z", "M9 12l2 2 4-4"],
  journal: ["M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M9 8h6M9 12h6M9 16h4"],
} as const;

export type IconName = keyof typeof PATHS;

const VIEW_BOX = "0 0 24 24";

function icon(name: IconName) {
  function Icon() {
    return (
      <svg className="icon" viewBox={VIEW_BOX} aria-hidden focusable={false}>
        {PATHS[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

/** One component per icon, e.g. `<Icons.close />`. */
export const Icons = {} as Record<IconName, () => React.JSX.Element>;
for (const name of Object.keys(PATHS) as IconName[]) Icons[name] = icon(name);
