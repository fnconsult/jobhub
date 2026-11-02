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
import { ClearConversationButton, ConversationFirstProvider, PageHelpButton, SidebarConversations, SidebarMenu, hasObjects, type FreeConversation, type SidebarMenus } from "@/components/conversation-first";
import { WorkPane, WorkPaneProvider } from "@/components/WorkPane";
import { PageHelpProvider } from "@/components/page-help";
import { ActivityColumn, Fiche, FicheButtons, FicheProvider, useColumnOverPage, type FicheContent } from "@/components/Fiche";
import { accountLink, sidebarNav, type SidebarNavKey } from "@/components/sidebar-nav";
import { AIDE_ET_LEGAL } from "@/public-pages/public-shell";
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
 * The sidebar layout of the Candidate's pages (#132, #134, ADR-0070): the sidebar shell (see SidebarShell) with
 * « Nouvelle conversation » and « Coach » with the Candidate's `freeConversations` (#601), the Profile switcher and the
 * Candidate's labelled links, its menus with objects unfolding into them (`menus`, #604, #606), and in its foot the Usage
 * Meter of the week's Plan Quotas (null when billing could not be read). Beside « Mon compte », on its row, the
 * Signalement icon (#375), whose form opens in the Work Pane; `version` is the Jobbbox version it shows. At the top of
 * its foot, « Aide et légal » (#544): the public Aide, Légal and Nouveautés, in the drawer too on a phone.
 * Its Top Bar has « Effacer » while the page is a conversation, « Aide » on a page without one (#602). The Work Pane opens
 * beside the page (#602). `fiche`: an object's page (an Application's, #603): the Fiche beside the conversation, after
 * the Work Pane, and « Fiche » and « Activité » in the Top Bar; the Fiche shows the page's `aiActivity`. Without one (the
 * home page, the menus, #607), « Activité » alone, which opens the Activité column with the Context bar and AI Activity.
 * On a phone those columns open over the conversation, full screen, the page behind out of reach (#608).
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
  freeConversations,
  menus,
  fiche = null,
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
  freeConversations: readonly FreeConversation[];
  menus?: SidebarMenus | undefined;
  fiche?: FicheContent | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const items = sidebarNav({ pathname, profiles, currentProfileId, isHumanCoach, isAdministrator });
  const account = accountLink(pathname);
  const switcherProfiles = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const current = profiles.find((profile) => profile.id === currentProfileId);

  const shell = (pageInert: boolean) => (
    <AiActivityProvider elements={aiActivity}>
      <SidebarShell
        pageInert={pageInert}
        brand={{ href: routes.home, label: t("app.name") }}
        title={title}
        wide={wide}
        topBarEnd={
          // One group, so on a phone its buttons stay together at the right of Menu, the title on its own row (#608).
          <div className="topbar-actions">
            <FicheButtons />
            <ClearConversationButton />
            {fiche ? null : <PageHelpButton />}
          </div>
        }
        beside={
          <>
            <WorkPane />
            {fiche ? <Fiche content={fiche} /> : <ActivityColumn />}
          </>
        }
        topBarActivity={null}
        foot={(closeDrawer, closeDrawerThen) => (
          <>
            {/* Named by its own words; no id, the drawer drawing the same block beside the docked sidebar. */}
            <nav className="sidebar-help" aria-label={t("sidebar.helpAndLegal")}>
              <p className="sidebar-help-title" aria-hidden="true">
                {t("sidebar.helpAndLegal")}
              </p>
              <ul>
                {AIDE_ET_LEGAL.map((link) => (
                  <li key={link.key}>
                    <Link href={link.href} onClick={closeDrawer}>
                      {t(link.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {usage ? <UsageMeter meter={usage} onNavigate={closeDrawer} /> : null}
            <div className="sidebar-account-row">
              <Link className="sidebar-link" href={account.href} aria-current={account.current ? CURRENT : undefined} onClick={closeDrawer}>
                <Icons.account />
                {t("nav.account")}
              </Link>
              <SignalementButton version={version} closeDrawerThen={closeDrawerThen} />
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
        nav={(closeDrawer, closeDrawerThen) => (
          <nav className="sidebar-nav" aria-label={t("sidebar.label")}>
            <SidebarConversations onNavigate={closeDrawer} closeDrawerThen={closeDrawerThen} />
            <ul>
              {items.map((item) => {
                const NavIcon = Icons[item.key];
                if (hasObjects(item.key))
                  return (
                    <SidebarMenu
                      key={item.key}
                      menu={item.key}
                      // Recherches d'offres' menu is one conversation for every Profile (#606): its page, not one Profile's.
                      href={item.key === "jobSearches" ? routes.jobSearches() : item.href}
                      current={item.current}
                      icon={<NavIcon />}
                      label={t(LABELS[item.key])}
                      onNavigate={closeDrawer}
                    />
                  );
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
  return (
    <ConversationFirstProvider conversations={freeConversations} {...(menus ? { menus } : {})}>
      <WorkPaneProvider version={version}>
        <PageHelpProvider>
          <FicheProvider object={fiche !== null}>
            <ColumnsOverPage>{shell}</ColumnsOverPage>
          </FicheProvider>
        </PageHelpProvider>
      </WorkPaneProvider>
    </ConversationFirstProvider>
  );
}

/** Draws the shell with the page out of reach while a column covers it, on a phone (#608). */
function ColumnsOverPage({ children }: { children: (pageInert: boolean) => ReactNode }) {
  return children(useColumnOverPage());
}
