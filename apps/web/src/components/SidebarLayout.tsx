"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CoachPanelToggle } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { ProfileSwitcherMenu } from "@/components/ProfileSwitcherMenu";
import { sidebarNav, type SidebarNavKey } from "@/components/sidebar-nav";
import { TextSizeControl } from "@/components/TextSizeControl";
import { SIDEBAR_CLOSED, SIDEBAR_OPEN, SIDEBAR_STORAGE_KEY } from "@/design/sidebar-state";
import { routes } from "@/routes";

export type SidebarProfile = { id: string; name: string; archived: boolean };

/** At and above this width the sidebar sits beside the page; below it, it is a drawer. */
const WIDE = "(width >= 64rem)";
/** `aria-current` of the link to the page shown. */
const CURRENT = "page";
const MAIN_ID = "main";

const LABELS = {
  applications: "nav.applications",
  jobSearches: "sidebar.jobSearches",
  jobDigests: "sidebar.jobDigests",
  account: "nav.account",
  subscription: "sidebar.subscription",
} as const satisfies Record<SidebarNavKey, string>;

/** Hides or shows the sidebar on wide screens. The state lives on <html data-sidebar>, which the CSS reads (see design/sidebar-state). */
function setHidden(hidden: boolean) {
  document.documentElement.dataset.sidebar = hidden ? SIDEBAR_CLOSED : SIDEBAR_OPEN;
  try {
    if (hidden) window.localStorage.setItem(SIDEBAR_STORAGE_KEY, SIDEBAR_CLOSED);
    else window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Storage blocked: the choice holds until the next page load.
  }
}

/**
 * The sidebar layout of the Candidate's pages (#132, #134): a skip link, the
 * sidebar (Profile switcher, labelled links, Text Size control), a top bar
 * with the Menu and Coach Panel buttons, and the page as `<main>`.
 *
 * On a wide screen the sidebar sits beside the page and the Candidate can hide
 * it (remembered by this browser); the Menu button brings it back. Below 64rem
 * it is a drawer: a modal dialog (Radix, ADR-0018) the Menu button opens, and
 * Escape, its close button or any link closes. Icons always come with words.
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
  const id = useId();
  // The drawer is open on the page it was opened on: going to another page closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const items = sidebarNav({ pathname, profiles, currentProfileId });

  // Widening the window past 64rem turns the drawer back into the sidebar.
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = () => {
      if (query.matches) setDrawerPath(null);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function showMenu() {
    if (window.matchMedia(WIDE).matches) {
      setHidden(false);
      // The button that hides it again takes the focus the Menu button had.
      requestAnimationFrame(() => collapseButton.current?.focus());
    } else setDrawerPath(pathname);
  }

  function hide() {
    setHidden(true);
    requestAnimationFrame(() => menuButton.current?.focus());
  }

  const switcherProfiles = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const current = profiles.find((profile) => profile.id === currentProfileId);

  const content = (inDrawer: boolean) => (
    <>
      <div className="sidebar-head">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        {inDrawer ? (
          <Dialog.Close className="button button-quiet">
            <Icons.close />
            {t("sidebar.close")}
          </Dialog.Close>
        ) : null}
      </div>
      {profiles.length > 0 ? (
        <ProfileSwitcherMenu
          // Keyed by the current Profile so it opens closed again after switching.
          key={currentProfileId ?? ""}
          profiles={switcherProfiles}
          current={current ? { id: current.id, name: current.name } : undefined}
          canAdd={canAddProfile}
        />
      ) : null}
      <nav className="sidebar-nav" aria-label={t("sidebar.label")}>
        <ul>
          {items.map((item) => {
            const NavIcon = Icons[item.key];
            return (
              <li key={item.key}>
                <Link className="sidebar-link" href={item.href} aria-current={item.current ? CURRENT : undefined} onClick={() => setDrawerPath(null)}>
                  <NavIcon />
                  {t(LABELS[item.key])}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="sidebar-foot">
        <TextSizeControl />
        {inDrawer ? null : (
          <button ref={collapseButton} className="button button-quiet sidebar-collapse" type="button" aria-controls={`${id}-sidebar`} onClick={hide}>
            <Icons.collapse />
            {t("sidebar.collapse")}
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href={`#${MAIN_ID}`}>
        {t("sidebar.skipToContent")}
      </a>
      <div id={`${id}-sidebar`} className="sidebar sidebar-docked">
        {content(false)}
      </div>
      <Dialog.Root open={drawerOpen} onOpenChange={(open) => setDrawerPath(open ? pathname : null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="scrim" />
          <Dialog.Content
            className="sidebar sidebar-drawer"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // Focus starts on the current page's link, where the Candidate is.
              const here = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(`.sidebar-link[aria-current="${CURRENT}"]`);
              if (here) {
                event.preventDefault();
                here.focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuButton.current?.focus();
            }}
          >
            <Dialog.Title className="visually-hidden">{t("sidebar.menu")}</Dialog.Title>
            {content(true)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="workspace">
        <header className="topbar">
          <button ref={menuButton} className="button button-quiet menu-toggle" type="button" aria-expanded={drawerOpen} onClick={showMenu}>
            <Icons.menu />
            {t("sidebar.menu")}
          </button>
          <CoachPanelToggle />
        </header>
        <main id={MAIN_ID} tabIndex={-1} className={wide ? "page page-wide" : "page"}>
          {children}
        </main>
      </div>
    </div>
  );
}
