"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { ProfileSwitcherMenu } from "@/components/ProfileSwitcherMenu";
import { SignalementButton } from "@/components/Signalement";
import { UsageMeter } from "@/components/UsageMeter";
import { AiActivityProvider } from "@/components/AiActivity";
import type { ActivityElement } from "@/ai-activity/pane";
import type { UsageMeter as Meter } from "@/billing/usage-meter";
import { accountLink, sidebarNav, type SidebarNavKey } from "@/components/sidebar-nav";
import { CURRENT, SidebarShell } from "@/components/SidebarShell";
import { routes } from "@/routes";

export type SidebarProfile = { id: string; name: string; archived: boolean };

/** A page with no AI content. */
const NO_AI_ACTIVITY: readonly ActivityElement[] = [];

const LABELS = {
  applications: "nav.applications",
  agenda: "sidebar.agenda",
  jobSearches: "sidebar.jobSearches",
  jobDigests: "sidebar.jobDigests",
  humanCoaches: "account.humanCoaches",
  coachSpace: "account.coachSpace",
  admin: "account.admin",
} as const satisfies Record<SidebarNavKey, string>;

/**
 * The sidebar layout of the Candidate's pages (#132, #134): the sidebar shell
 * (see SidebarShell) with the Profile switcher and the Candidate's labelled links,
 * and in its foot the Usage Meter of the week's Plan Quotas (null when billing could not be read).
 * Its Top Bar has AI Activity's button, its pane the page's `aiActivity` elements (none: « Aucun contenu
 * produit par l'IA sur cette page »). Beside « Mon compte », on its row, the Signalement icon (#375), which opens the
 * Signalement dialog; `version` is the Jobbbox version that dialog shows.
 */
export function SidebarLayout({
  profiles,
  currentProfileId,
  canAddProfile,
  isHumanCoach = false,
  isAdministrator = false,
  usage = null,
  title,
  wide = false,
  aiActivity = NO_AI_ACTIVITY,
  version,
  children,
}: {
  profiles: ReadonlyArray<SidebarProfile>;
  currentProfileId?: string | undefined;
  canAddProfile: boolean;
  isHumanCoach?: boolean;
  isAdministrator?: boolean;
  usage?: Meter | null;
  title?: ReactNode;
  wide?: boolean;
  aiActivity?: readonly ActivityElement[];
  version: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const items = sidebarNav({ pathname, profiles, currentProfileId, isHumanCoach, isAdministrator });
  const account = accountLink(pathname);
  const switcherProfiles = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const current = profiles.find((profile) => profile.id === currentProfileId);

  return (
    <AiActivityProvider elements={aiActivity}>
      <SidebarShell
        brand={{ href: routes.home, label: t("app.name") }}
        title={title}
        wide={wide}
        foot={(closeDrawer) => (
          <>
            {usage ? <UsageMeter meter={usage} onNavigate={closeDrawer} /> : null}
            <div className="sidebar-account-row">
              <Link className="sidebar-link" href={account.href} aria-current={account.current ? CURRENT : undefined} onClick={closeDrawer}>
                <Icons.account />
                {t("nav.account")}
              </Link>
              <SignalementButton version={version} />
            </div>
          </>
        )}
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
    </AiActivityProvider>
  );
}
