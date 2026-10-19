import { routes } from "../routes";

export type SidebarNavKey = "applications" | "jobSearches" | "jobDigests" | "account" | "subscription" | "humanCoaches" | "coachSpace" | "admin";

export interface SidebarNavItem {
  key: SidebarNavKey;
  href: string;
  /** The page shown is this item's page (or one under it): `aria-current="page"`. */
  current: boolean;
}

/** Job Searches and Job Digests have no index page: theirs live under these paths. */
const JOB_SEARCH_PAGES = "/recherches/";
const JOB_DIGEST_PAGES = "/job-digests/";

const isUnder = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/**
 * The links of the Candidate's sidebar, in order, for the page at `pathname`.
 * Job Searches and Job Digests are run and kept per Profile, so they lead to
 * the sections of a Profile's page: the Profile in view when it is active,
 * otherwise the Candidate's first active Profile. With no active Profile they
 * are left out (an Archived Profile has neither section). Then Mon compte, the
 * Subscription and the Human Coaches; the Coach space for a Human Coach and the
 * Back Office for an Administrator.
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
  const items: SidebarNavItem[] = [{ key: "applications", href: routes.applications, current: isUnder(pathname, routes.applications) }];
  if (profile) {
    items.push(
      { key: "jobSearches", href: routes.profileJobSearch(profile.id), current: pathname.startsWith(JOB_SEARCH_PAGES) },
      { key: "jobDigests", href: routes.profileJobDigest(profile.id), current: pathname.startsWith(JOB_DIGEST_PAGES) },
    );
  }
  items.push(
    { key: "account", href: routes.account, current: isUnder(pathname, routes.account) },
    { key: "subscription", href: routes.subscription, current: isUnder(pathname, routes.subscription) },
    { key: "humanCoaches", href: routes.coaching, current: isUnder(pathname, routes.coaching) },
  );
  if (isHumanCoach) items.push({ key: "coachSpace", href: routes.coachSpace, current: isUnder(pathname, routes.coachSpace) });
  if (isAdministrator) items.push({ key: "admin", href: routes.admin, current: isUnder(pathname, routes.admin) });
  return items;
}
