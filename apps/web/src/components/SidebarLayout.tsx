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
import { ClearConversationButton, ConversationFirstProvider, PageHelpButton, SidebarConversations, SidebarMenu, type FreeConversation, type SidebarMenus } from "@/components/conversation-first";
import { WorkPane, WorkPaneProvider } from "@/components/WorkPane";
import { Fiche, FicheButtons, FicheProvider, type FicheContent } from "@/components/Fiche";
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
 * `freeConversations`: under « Conversation au centre » (#601, ADR-0070), the Candidate's Free conversations; the Sidebar
 * then has « Nouvelle conversation » and « Coach » with them above its links, and the Top Bar « Effacer » in place of
 * « Aide et coach » (« Aide » on a page without a conversation), and the Work Pane opens beside the page (#602). Null
 * while the switch is off. `menus`: then, what its menus with objects unfold into (#604). `fiche`: an object's page (an
 * Application's, #603): the Fiche beside the conversation, after the Work Pane, and « Fiche » and « Activité » in the Top
 * Bar in place of AI Activity's button, which the Fiche shows; ignored while the switch is off.
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
  freeConversations = null,
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
  freeConversations?: readonly FreeConversation[] | null;
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

  const shell = (
    <AiActivityProvider elements={aiActivity}>
      <SidebarShell
        brand={{ href: routes.home, label: t("app.name") }}
        title={title}
        wide={wide}
        {...(freeConversations
          ? {
              topBarEnd: (
                <>
                  {fiche ? <FicheButtons /> : null}
                  <ClearConversationButton />
                  {fiche ? null : <PageHelpButton />}
                </>
              ),
              beside: (
                <>
                  <WorkPane />
                  {fiche ? <Fiche content={fiche} /> : null}
                </>
              ),
              ...(fiche ? { topBarActivity: null } : {}),
            }
          : {})}
        foot={(closeDrawer, closeDrawerThen) => (
          <>
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
                if (item.key === "applications" && freeConversations)
                  return <SidebarMenu key={item.key} menu={item.key} href={item.href} current={item.current} icon={<NavIcon />} label={t(LABELS[item.key])} onNavigate={closeDrawer} />;
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
  return freeConversations ? (
    <ConversationFirstProvider conversations={freeConversations} {...(menus ? { menus } : {})}>
      <WorkPaneProvider version={version}>{fiche ? <FicheProvider>{shell}</FicheProvider> : shell}</WorkPaneProvider>
    </ConversationFirstProvider>
  ) : (
    shell
  );
}
