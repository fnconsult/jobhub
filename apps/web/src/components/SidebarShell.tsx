"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AiActivityButton, AiActivityPane } from "@/components/AiActivity";
import { CoachPanelToggle } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { SignOutButton } from "@/components/SignOutButton";
import { buttonClass } from "@/design/Button";
import { Drawer, DrawerTitle } from "@/design/Drawer";
import { SIDEBAR_CLOSED, SIDEBAR_OPEN, SIDEBAR_STORAGE_KEY } from "@/design/sidebar-state";

/** At and above this width the sidebar sits beside the page; below it, it is a drawer. */
const WIDE = "(width >= 64rem)";
/** `aria-current` of the link to the page shown. */
export const CURRENT = "page";
const MAIN_ID = "main";
/** Marks what is open inside the drawer and closes on Escape before the drawer does (the Usage Meter's card). */
const CLOSES_ON_ESCAPE = "[data-closes-on-escape]";

/**
 * What a page split into Sections tells the Top Bar (ADR-0024): the Section shown, named after
 * the page's title, and, for a Section shown alone on a phone, where the back arrow leads.
 */
export type TopBarBackLink = { href: string; label: string };
export type TopBarSection = { section: string; back: TopBarBackLink | null };
/** Sets (or clears) the Section the Top Bar names; SectionsLayout calls it. */
export const TopBarBack = createContext<(section: TopBarSection | null) => void>(() => {});

/** A page's Sections, which the sidebar takes over when the page's column has no room for their list. */
export type SidebarSectionsMenu = { title: string; label: string; items: ReadonlyArray<{ href: string; label: string; current: boolean }> };
/** Sets (or clears) the page's Sections for the sidebar; SectionsLayout calls it. */
export const SidebarSections = createContext<(menu: SidebarSectionsMenu | null) => void>(() => {});
/** Below this width (in rem) the page's column has no room for its Sections' list: the same as app.css. */
const CRAMPED_REM = 44;

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
 * The sidebar layout (#132, #134), whatever the sidebar holds: a skip link, the
 * sidebar (brand, `top`, the `nav`, signing out), the Top
 * Bar with the Menu button, the page's `title`, the AI Activity button and the
 * Coach Panel button (or `topBarEnd` in its place), and the page as `<main>`, `beside` it (the Work Pane), then AI Activity's pane (both
 * only inside an AiActivityProvider: Candidate pages, never the Back Office). `title` is the page's `<h1>`: a string, or an element that
 * is one itself (an editable title). Pages never render their own (ADR-0024).
 *
 * On a wide screen the sidebar sits beside the page and can be hidden
 * (remembered by this browser); the Menu button brings it back. Below 64rem
 * it is a drawer: a modal dialog (Radix, ADR-0018) the Menu button opens, and
 * Escape, its close button or any link closes. `nav` gets the function its
 * links call to close the drawer. Icons always come with words.
 */
export function SidebarShell({
  brand,
  top,
  nav,
  foot,
  title,
  wide = false,
  topBarEnd = <CoachPanelToggle />,
  beside,
  children,
}: {
  brand: { href: string; label: string };
  top?: ReactNode;
  title?: ReactNode;
  nav: (closeDrawer: () => void) => ReactNode;
  /** Above signing out, in the sidebar's foot (Mon compte); gets the drawer's close function too. */
  foot?: (closeDrawer: () => void) => ReactNode;
  wide?: boolean;
  /** The Top Bar's last button: the Coach Panel's, or « Effacer » under « Conversation au centre » (#601). */
  topBarEnd?: ReactNode;
  /** The column beside the page, never over it: the Work Pane under « Conversation au centre » (#602). */
  beside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const id = useId();
  // The drawer is open on the page it was opened on: going to another page closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  const topbar = useRef<HTMLElement>(null);
  const [shownSection, setShownSection] = useState<TopBarSection | null>(null);
  const back = shownSection?.back ?? null;
  // The Section shown, after the page's title: « Mon compte › Relances ».
  const crumb = shownSection ? <span className="topbar-crumb">{shownSection.section}</span> : null;
  const [sectionsMenu, setSectionsMenu] = useState<SidebarSectionsMenu | null>(null);
  // The page's column is too narrow for its Sections' list (the Coach Panel docked beside it).
  const [cramped, setCramped] = useState(false);
  // The main menu, asked for over the Sections on this page; another page brings the Sections back.
  const [mainMenuPath, setMainMenuPath] = useState<string | null>(null);
  const sectionsInSidebar = sectionsMenu !== null && cramped;
  const showSections = sectionsInSidebar && mainMenuPath !== pathname;
  const switchButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const main = document.getElementById(MAIN_ID);
    if (!main) return;
    const wide = window.matchMedia(WIDE);
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const style = getComputedStyle(main);
      const column = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setCramped(wide.matches && column < CRAMPED_REM * rem);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    measure();
    return () => observer.disconnect();
  }, []);

  // The Top Bar's height, for what sticks under it as the page scrolls (--topbar-height in app.css):
  // it grows with the Text Size, and takes two rows on a phone.
  useEffect(() => {
    const bar = topbar.current;
    if (!bar) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--topbar-height", `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--topbar-height");
    };
  }, []);

  /** Between the main menu and the page's Sections; focus stays on the button that switches them. */
  function switchMenu(toMain: boolean) {
    setMainMenuPath(toMain ? pathname : null);
    requestAnimationFrame(() => switchButton.current?.focus());
  }
  const collapseButton = useRef<HTMLButtonElement>(null);

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

  const content = (inDrawer: boolean) => (
    <>
      <div className="sidebar-head">
        <Link className="brand" href={brand.href}>
          {brand.label}
        </Link>
        {inDrawer ? (
          <button className="button button-quiet" type="button" onClick={() => setDrawerPath(null)}>
            <Icons.close />
            {t("sidebar.close")}
          </button>
        ) : null}
      </div>
      {showSections && !inDrawer ? (
        // No room beside the page for its Sections: the sidebar lists them, the main menu one arrow away.
        <>
          <button ref={switchButton} className="button button-quiet sidebar-switch" type="button" onClick={() => switchMenu(true)}>
            <Icons.back />
            {t("sidebar.mainMenu")}
          </button>
          <nav className="sidebar-nav" aria-label={sectionsMenu.label}>
            <p className="sidebar-group-label">{sectionsMenu.title}</p>
            <ul>
              {sectionsMenu.items.map((item) => (
                <li key={item.href}>
                  <Link className="sidebar-link" href={item.href} aria-current={item.current ? CURRENT : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </>
      ) : (
        <>
          {top}
          {sectionsInSidebar && !inDrawer ? (
            <button ref={switchButton} className="button button-quiet sidebar-switch sidebar-switch-forward" type="button" onClick={() => switchMenu(false)}>
              {sectionsMenu.title}
              <Icons.chevron />
            </button>
          ) : null}
          {nav(() => setDrawerPath(null))}
        </>
      )}
      <div className="sidebar-foot">
        {foot?.(() => setDrawerPath(null))}
        <SignOutButton />
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
    <TopBarBack.Provider value={setShownSection}>
      <SidebarSections.Provider value={setSectionsMenu}>
        <div className="app-shell">
          <a className="skip-link" href={`#${MAIN_ID}`}>
            {t("sidebar.skipToContent")}
          </a>
          <div id={`${id}-sidebar`} className="sidebar sidebar-docked">
            {content(false)}
          </div>
          <Drawer
            open={drawerOpen}
            onOpenChange={(open) => setDrawerPath(open ? pathname : null)}
            side="left"
            className="sidebar sidebar-drawer"
            onOpenAutoFocus={(event) => {
              // Focus starts on the current page's link, where the person is.
              const here = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(`.sidebar-link[aria-current="${CURRENT}"]`);
              if (here) {
                event.preventDefault();
                here.focus();
              }
            }}
            onEscapeKeyDown={(event) => {
              // Escape closes what is open in the drawer first (the Usage Meter's card), the drawer after.
              if (event.target instanceof Element && event.target.closest(CLOSES_ON_ESCAPE)) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuButton.current?.focus();
            }}
          >
            <DrawerTitle className="visually-hidden">{t("sidebar.menu")}</DrawerTitle>
            {content(true)}
          </Drawer>
          {/*
            While the drawer is open the page behind is inert and hidden. Radix's
            modal hides everything else with aria-hidden, but it spares live regions
            and their ancestors, and every page's <main> holds one (the Job Search
            notifications): without this, <main> stayed in reach behind the drawer.
          */}
          <div className="workspace" inert={drawerOpen} aria-hidden={drawerOpen || undefined}>
            <header ref={topbar} className="topbar">
              <button ref={menuButton} className={`${buttonClass()} menu-toggle`} type="button" aria-expanded={drawerOpen} onClick={showMenu}>
                <Icons.menu />
                {t("sidebar.menu")}
              </button>
              <div className="topbar-title">
                {/* A Section alone on a phone: the title leads back to the list, behind an arrow, as on iOS. */}
                {typeof title === "string" ? (
                  <>
                    <h1>
                      {back ? (
                        <Link className="topbar-back" href={back.href}>
                          <Icons.back />
                          {title}
                        </Link>
                      ) : (
                        title
                      )}
                    </h1>
                    {crumb}
                  </>
                ) : (
                  <>
                    {back ? (
                      <Link className="topbar-back" href={back.href} aria-label={back.label}>
                        <Icons.back />
                      </Link>
                    ) : null}
                    {title}
                    {crumb}
                  </>
                )}
              </div>
              <AiActivityButton />
              {topBarEnd}
            </header>
            <main id={MAIN_ID} tabIndex={-1} className={wide ? "page page-wide" : "page"}>
              {children}
            </main>
            {beside}
            <AiActivityPane />
          </div>
        </div>
      </SidebarSections.Provider>
    </TopBarBack.Provider>
  );
}
