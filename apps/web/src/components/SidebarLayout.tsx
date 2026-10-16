"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { ProfileSwitcherMenu } from "@/components/ProfileSwitcherMenu";
import { sidebarNav, type SidebarNavKey } from "@/components/sidebar-nav";
import { CURRENT, SidebarShell } from "@/components/SidebarShell";
import { routes } from "@/routes";

export type SidebarProfile = { id: string; name: string; archived: boolean };

const LABELS = {
  applications: "nav.applications",
  jobSearches: "sidebar.jobSearches",
  jobDigests: "sidebar.jobDigests",
  account: "nav.account",
  subscription: "sidebar.subscription",
} as const satisfies Record<SidebarNavKey, string>;

/**
 * The sidebar layout of the Candidate's pages (#132, #134): the sidebar shell
 * (see SidebarShell) with the Profile switcher and the Candidate's labelled links.
 */
export function SidebarLayout({
  profiles,
  currentProfileId,
  canAddProfile,
  wide = false,
  children,
}: {
  profiles: ReadonlyArray<SidebarProfile>;
  currentProfileId?: string | undefined;
  canAddProfile: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const items = sidebarNav({ pathname, profiles, currentProfileId });
  const switcherProfiles = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const current = profiles.find((profile) => profile.id === currentProfileId);

  return (
    <SidebarShell
      brand={{ href: routes.home, label: t("app.name") }}
      wide={wide}
      top={
        profiles.length > 0 ? (
          <ProfileSwitcherMenu
            // Keyed by the current Profile so it opens closed again after switching.
            key={currentProfileId ?? ""}
            profiles={switcherProfiles}
            current={current ? { id: current.id, name: current.name } : undefined}
            canAdd={canAddProfile}
          />
        ) : null
      }
      nav={(closeDrawer) => (
        <nav className="sidebar-nav" aria-label={t("sidebar.label")}>
          <ul>
            {items.map((item) => {
              const NavIcon = Icons[item.key];
              return (
                <li key={item.key}>
                  <Link className="sidebar-link" href={item.href} aria-current={item.current ? CURRENT : undefined} onClick={closeDrawer}>
                    <NavIcon />
                    {t(LABELS[item.key])}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    >
      {children}
    </SidebarShell>
  );
}
