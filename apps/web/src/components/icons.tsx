/**
 * Line icons from the Notion-like prototype (#132). Decoration only: each one
 * sits beside its label in words (ADR-0009: no icon-only function, but AI
 * Activity's stop icon and the Sidebar's Signalement icon, named by their aria-label), so it is hidden from screen readers.
 */
const PATHS = {
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["M6 6l12 12M18 6L6 18"],
  collapse: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 4v16M15 10l-2 2 2 2"],
  applications: ["M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"],
  // A calendar page: the Agenda.
  agenda: ["M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 10h18M8 3v4M16 3v4"],
  jobSearches: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4-4"],
  jobDigests: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 7l9 6 9-6"],
  account: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6.5 18.5c1.5-2 3.4-3 5.5-3s4 1 5.5 3"],
  subscription: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 10h18M7 15h4"],
  profile: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 21c0-4 4-6 8-6s8 2 8 6"],
  chevron: ["M8 10l4 4 4-4"],
  back: ["M15 6l-6 6 6 6"],
  // A clipboard: a Human Coach's own space.
  coachSpace: ["M9 3h6v3H9z", "M8 4.5H5V21h14V4.5h-3", "M8 11h8M8 15h5"],
  // A shield: the Back Office.
  admin: ["M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"],
  // A door with an arrow out: signing out.
  signOut: ["M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4", "M9 16l-4-4 4-4", "M5 12h11"],
  coach: ["M4 5h16v11H9l-5 4z", "M8 9h8M8 12h5"],
  // A list of ticked tasks: AI Activity (#332).
  aiActivity: ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5", "M4 12l1.2 1.2 2.3-2.2", "M4 18l1.2 1.2 2.3-2.2"],
  // Stop an AI action under way (#333): a square.
  stop: ["M7 7h10v10H7z"],
  // A tick: an AI action done (#333), « ✓ Dernière recherche · 16 s ».
  done: ["M5 12.5l4.5 4.5L19 7.5"],
  add: ["M12 5v14M5 12h14"],
  conversations: ["M4 6h16M4 12h16M4 18h10"],
  searchAgain: ["M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"],
  // The Back Office's sections (#204). Stacked layers: the Plans (#206).
  plans: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  planQuotas: ["M4 20V10M10 20V4M16 20v-7M22 20H2"],
  // A price tag.
  coupons: ["M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z", "M8 8h.01"],
  humanCoaches: ["M9 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 5.5a3 3 0 0 1 0 5M18 14.5c2 .8 3 2.8 3 5.5"],
  coachCost: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M15 8.5a4 4 0 1 0 0 7M7 11h6M7 13.5h6"],
  // An open book: the Coaching Playbooks (#225).
  coachingPlaybooks: ["M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z", "M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"],
  // A railing, two posts and two rails: the Guardrails (#228).
  guardrails: ["M5 4v16M19 4v16", "M5 8h14M5 14h14"],
  // A question mark in a speech bubble: the Unanswered Questions (#344).
  unansweredQuestions: ["M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M10 9.5a2 2 0 1 1 2.8 1.8c-.5.2-.8.7-.8 1.2v.5M12 15h.01"],
  searchSites: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"],
  // A key: Provider Secrets (#208).
  providerSecrets: ["M8 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M11 11l9-9M16 6l3 3M14 8l2 2"],
  // Three sliders: the Platform Settings (#298).
  platformSettings: ["M4 6h16M4 12h16M4 18h16", "M14 4v4M8 10v4M16 16v4"],
  // A door with an arrow in: Sign-in Providers (#209).
  signInProviders: ["M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4", "M10 16l4-4-4-4M14 12H4"],
  // A rising line on axes: AI consumption (#218).
  aiUsage: ["M4 4v16h16", "M8 15l3.5-4 3 2.5L19 8"],
  // A page under a magnifier: the AI message logs (#218).
  aiMessages: ["M6 3h9l4 4v6", "M6 3v18h6", "M9 8h5M9 12h3", "M17 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M19.2 20.2L21 22"],
  // A wrench: the Tools (#233).
  tools: ["M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"],
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
