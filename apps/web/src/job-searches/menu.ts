import { routes } from "../routes";
import { unfoldMenu, type UnfoldedMenu } from "../sidebar-menus";
import type { JobSearchSummary } from "./index";

type Profile = { id: string; name: string };

/** One active Profile on Recherches d'offres' card and its Job Searches, most recent first. */
export interface JobSearchesMenuGroup {
  profile: Profile;
  searches: JobSearchSummary[];
}

/** Recherches d'offres (ADR-0070, #606): its card in the menu's conversation, and what it unfolds into in the Sidebar. */
export interface JobSearchesMenu {
  /** One per active Profile, in the Profiles' order, even with no Job Search yet. */
  groups: JobSearchesMenuGroup[];
  /** How many Job Searches are à traiter: finished, their outcome still unseen. */
  unseen: number;
  /** The Sidebar's objects: the active Profiles' Job Searches, each named by its Profile and day. */
  sidebar: UnfoldedMenu;
}

/**
 * Recherches d'offres from the Candidate's active `profiles` (in their order) and their `searches` (most recent first, as
 * the Job Searches module lists them); an Archived Profile's are left out. `dateLabel` writes the day a Job Search started.
 */
export function jobSearchesMenu({
  profiles,
  searches,
  dateLabel,
}: {
  profiles: readonly Profile[];
  searches: readonly JobSearchSummary[];
  dateLabel: (date: Date) => string;
}): JobSearchesMenu {
  const active = new Set(profiles.map((profile) => profile.id));
  const shown = searches.filter((search) => active.has(search.profile.id));
  return {
    groups: profiles.map((profile) => ({ profile, searches: shown.filter((search) => search.profile.id === profile.id) })),
    unseen: shown.filter((search) => search.unseen).length,
    sidebar: unfoldMenu(
      shown.map((search) => ({
        id: search.id,
        label: `${search.profile.name} · ${dateLabel(search.startedAt)}`,
        href: routes.jobSearch(search.id),
        toHandle: search.unseen,
      })),
    ),
  };
}
