import { routes } from "../routes";

export type SidebarNavKey = "applications" | "agenda" | "jobSearches" | "jobDigests" | "humanCoaches" | "coachSpace" | "admin";

export interface SidebarNavItem {
  key: SidebarNavKey;
  href: string;
  /** The page shown is this item's page (or one under it): `aria-current="page"`. */
  current: boolean;
}



const isUnder = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/**
 * The links of the Candidate's sidebar, in order, for the page at `pathname`:
 * Mes candidatures, then the Agenda. Job Searches and Job Digests have pages of their own (ADR-0024): Job Searches
 * opens on the Profile in view when it is active, otherwise the Candidate's
 * first active Profile. With no active Profile both are left out (an Archived
 * Profile has neither). Then the Human
 * Coaches; the Coach space for a Human Coach and the Back Office for an
 * Administrator. Mon compte is not among them: it sits in the Sidebar's foot
 * (see accountLink).
 */
export function sidebarNav({
  pathname,
  profiles,
  currentProfileId,
  isHumanCoach = false,
  isAdministrator = false,
}: {
  pathname: string;
  profiles: ReadonlyArray<{ id: string; archived: boolean }>;
  currentProfileId?: string | undefined;
  isHumanCoach?: boolean;
  isAdministrator?: boolean;
}): SidebarNavItem[] {
  const active = profiles.filter((profile) => !profile.archived);
  const profile = active.find((candidate) => candidate.id === currentProfileId) ?? active[0];
  const items: SidebarNavItem[] = [
    { key: "applications", href: routes.applications, current: isUnder(pathname, routes.applications) },
    { key: "agenda", href: routes.agenda(), current: isUnder(pathname, routes.agenda()) },
  ];
  if (profile) {
    items.push(
      { key: "jobSearches", href: routes.jobSearches(profile.id), current: isUnder(pathname, routes.jobSearches()) },
      { key: "jobDigests", href: routes.jobDigests, current: isUnder(pathname, routes.jobDigests) },
    );
  }
  items.push({ key: "humanCoaches", href: routes.coaching, current: isUnder(pathname, routes.coaching) });
  if (isHumanCoach) items.push({ key: "coachSpace", href: routes.coachSpace, current: isUnder(pathname, routes.coachSpace) });
  if (isAdministrator) items.push({ key: "admin", href: routes.admin, current: isUnder(pathname, routes.admin) });
  return items;
}

/** Mon compte, in the Sidebar's foot above signing out: current on its Sections, the Subscription among them. */
export function accountLink(pathname: string): { href: string; current: boolean } {
  return { href: routes.account, current: isUnder(pathname, routes.account) || isUnder(pathname, routes.subscription) };
}
