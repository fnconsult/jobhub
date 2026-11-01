import { routes } from "../routes";
import { unfoldMenu, type UnfoldedMenu } from "../sidebar-menus";
import type { ListedJobDigest } from "./index";

type Profile = { id: string; name: string };

/** One active Profile on the Job Digests' card and its Job Digests, newest first. */
export interface JobDigestsMenuGroup {
  profile: Profile;
  digests: ListedJobDigest[];
}

/** Job Digests (ADR-0070, #606): its card in the menu's conversation, and what it unfolds into in the Sidebar. */
export interface JobDigestsMenu {
  /** One per active Profile, in the Profiles' order, even with no Job Digest sent yet. */
  groups: JobDigestsMenuGroup[];
  /** The Sidebar's objects: the active Profiles' Job Digests, each named by its Profile and day. Nothing is à traiter. */
  sidebar: UnfoldedMenu;
}

/**
 * The Job Digests menu from the Candidate's active `profiles` (in their order) and the Job Digests sent to them (`digests`,
 * newest first, as the Job Digests module lists them); an Archived Profile's are left out. `dateLabel` writes the day one
 * was sent.
 */
export function jobDigestsMenu({ profiles, digests, dateLabel }: { profiles: readonly Profile[]; digests: readonly ListedJobDigest[]; dateLabel: (date: Date) => string }): JobDigestsMenu {
  const active = new Set(profiles.map((profile) => profile.id));
  const shown = digests.filter((digest) => active.has(digest.profile.id));
  return {
    groups: profiles.map((profile) => ({ profile, digests: shown.filter((digest) => digest.profile.id === profile.id) })),
    sidebar: unfoldMenu(
      shown.map((digest) => ({ id: digest.id, label: `${digest.profile.name} · ${dateLabel(digest.sentAt)}`, href: routes.jobDigest(digest.id), toHandle: false })),
    ),
  };
}
