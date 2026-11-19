"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { AiActivityButton, AiActivityContent } from "@/components/AiActivity";
import { ActivityColumnControl, type ActivityColumn } from "@/components/activity-column";
import { ContextBar } from "@/components/ContextBar";
import { EnCeMoment } from "@/components/EnCeMoment";
import { Icons } from "@/components/icons";
import { CURRENT } from "@/components/SidebarShell";
import { useActivityTopBarAction } from "@/components/activity-run";
import { TOP_BAR_RANK, useTopBarAction, useTopBarMode } from "@/components/top-bar";
import { useWorkPane } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { FIRST_WELCOME_SPLIT_WIDTH, setPanelWidthProperty, SIDE_PANEL_WIDTH, writePanelWidth, type PanelWidthSpec } from "@/design/panel-width";
import { ProfileBuilding } from "@/components/ProfileBuilding";
import { SIDEBAR_CLOSED } from "@/design/sidebar-state";

/** A Section or a Result the panel lists: its own address, which opens it in the Work Pane. */
export type FicheLink = { href: string; label: string; detail?: string };

/**
 * What an object's side panel shows (ADR-0070, #980), from its page: the object's `card` (its properties, changed in place)
 * and its `sections`, in its « Fiche » view; its `results`, in their own view (« Documents », or « Offres trouvées » for a
 * Job Search or a Job Digest, `resultsLabel`) and, the latest three, in « Activité »; and `offer`, an Application's Job
 * Offer, in « L'offre ». Each Section or Result opens in the Work Pane at its address.
 */
export type FicheContent = {
  card: ReactNode;
  sections: readonly FicheLink[];
  results: readonly FicheLink[];
  offer?: ReactNode;
  resultsLabel?: "documents" | "offers";
  /**
   * A Job Search's or a Job Digest's Job Offers as Recherches d'offres shows them (FoundOffers), in place of the list of
   * `results` in its « Offres trouvées » view; « Activité » still lists the latest three.
   */
  offers?: ReactNode;
};

/**
 * The side panel's views (#980), one per icon of the Top Bar, in this order: Activity (ADR-0086), the object's Fiche, its
 * Job Offer and its Results. A page offers those it has: the home page and the menus, Activity alone.
 */
export const PANEL_VIEWS = ["activity", "fiche", "offer", "results"] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

/** The panel's view, or null while it is closed. */
export type FicheState = { view: PanelView | null };

/** A view's icon: its button in the Top Bar shows it on that view, or closes it when it shows it already. */
export const toggleView = (state: FicheState, view: PanelView): FicheState => ({ view: state.view === view ? null : view });

/** The views a page offers: Activity alone without an object; an object's Fiche and Results, and an Application's offer. */
export function panelViews(content: FicheContent | null): PanelView[] {
  if (!content) return ["activity"];
  return PANEL_VIEWS.filter((view) => view !== "offer" || content.offer !== undefined);
}

/** Wide enough for the panel beside the conversation: it starts open there (below, it would cover the page). */
const WIDE = "(width >= 64rem)";
/**
 * Wide enough for the panel and the Work Pane beside the conversation, the Sidebar open: the Sidebar (16rem), the panel
 * (20rem), the Work Pane (32vw, 20 to 32rem) and their gutters leave the conversation 0.68 × the screen − 40rem, which
 * under 28rem no longer reads (its box and suggestions cut, its words wrapping letter by letter).
 */
const ROOM_FOR_BOTH = "(width >= 100rem)";
/** The same, the Sidebar hidden: 0.68 × the screen − 24rem. */
const ROOM_FOR_BOTH_SIDEBAR_HIDDEN = "(width >= 76.5rem)";
/** The page's `<main>` (SidebarShell): the focus goes there when what opened a column is gone. */
const MAIN_ID = "main";
/** Alt+Shift and a view's letter, read by the key's place (`code`): the same on a Mac and in AZERTY. */
const SHORTCUTS: Record<string, PanelView> = { KeyA: "activity", KeyF: "fiche", KeyO: "offer", KeyD: "results" };
/** « … »'s menu, under it, at its right edge. */
const MENU_ALIGN = "end";
/** How many Results « Activité » lists before « Tout voir ». */
const LATEST_RESULTS = 3;

/** Calls `onChange` when the screen crosses 64rem: below it, the panel opens over the conversation, full screen (#608). */
function onWideChange(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(WIDE) : null;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
/** Whether the screen is wide enough for the panel: the server's HTML, and a browser without media queries, say it is. */
const wideScreen = () => typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches;
const wideOnServer = () => true;

/** Whether the screen has room for the panel beside the Work Pane, with the Sidebar as the Candidate left it. */
function roomForBoth() {
  if (typeof window.matchMedia !== "function") return true;
  const sidebarHidden = document.documentElement.dataset.sidebar === SIDEBAR_CLOSED;
  return window.matchMedia(sidebarHidden ? ROOM_FOR_BOTH_SIDEBAR_HIDDEN : ROOM_FOR_BOTH).matches;
}

/** Calls `onChange` when the screen crosses either width, or the Sidebar is hidden or shown (<html data-sidebar>). */
function onRoomChange(onChange: () => void) {
  const queries = typeof window.matchMedia === "function" ? [ROOM_FOR_BOTH, ROOM_FOR_BOTH_SIDEBAR_HIDDEN].map((query) => window.matchMedia(query)) : [];
  for (const query of queries) query.addEventListener?.("change", onChange);
  const sidebar = new MutationObserver(onChange);
  sidebar.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => {
    for (const query of queries) query.removeEventListener?.("change", onChange);
    sidebar.disconnect();
  };
}

type Control = {
  /** An object's page; otherwise the home page's or a menu's, whose panel has Activity alone (#607). */
  object: boolean;
  /** The views the page offers, in the Top Bar's order. */
  views: readonly PanelView[];
  /** As the Candidate left it: its view, or closed. */
  state: FicheState;
  /** Open, it has given its place to the Work Pane for want of room (ADR-0070), so is not shown. */
  givenWay: boolean;
  /** The view shown: none while closed or given way. */
  shown: PanelView | null;
  ficheId: string;
  /** A view's icon: shows the panel on it, bringing it back if it gave way, or closes it when it shows it already. */
  toggle: (view: PanelView) => void;
  /** Shows the panel on a view (« Tout voir », « Dans l'activité »); nothing when it shows it already. */
  open: (view: PanelView) => void;
  /** Wide enough for the panel beside the conversation; below 64rem it opens over it, full screen, with a ✕ (#608). */
  wide: boolean;
  /**
   * The first welcome's split (#1051): open on « Activité » as the page loads on a wide screen, half of the room by
   * default, its width remembered apart, the Profile in construction at its top.
   */
  split: boolean;
  /** The width its handle sets and remembers: the side panel's, or the first welcome's split's. */
  widthSpec: PanelWidthSpec;
  /** Its ✕ (and Escape on a phone): closes it, the focus back on the Top Bar's icon that opened it. */
  close: () => void;
  /** « Largeur du volet par défaut »: counted, so the handle goes back to the default width each time. */
  resetWidth: () => void;
  widthReset: number;
};

const FicheControl = createContext<Control | null>(null);

/**
 * The side panel's state (#980, ADR-0070), shared by the Top Bar's icons, which open it on their view and close it, and by
 * the panel itself. On an object's page it opens on the Fiche when the page loads on a wide screen, and is closed on a
 * narrower one; on the home page and the menus (`object={false}`, #607) it has Activity alone, closed when the page loads.
 *
 * Without room for both beside the conversation, the Work Pane takes the panel's place while it is open, and the panel
 * comes back as it was when it closes. Its icons then say it is not shown, and bring it back, closing the Work Pane.
 * Alt+Shift and a view's letter (A, F, O, D) do what its icon does.
 *
 * `split`: the first welcome on `/profils/nouveau` (#1051), a Candidate without any finished Profile. On a wide screen
 * it opens on « Activité » as the page loads, the conversation on one side and Activity on the other, resized by the same
 * handle with its own remembered width (FIRST_WELCOME_SPLIT_WIDTH); on a phone it stays closed, as elsewhere.
 */
export function FicheProvider({
  object = true,
  split = false,
  views: offered,
  children,
}: {
  object?: boolean;
  split?: boolean;
  views?: readonly PanelView[];
  children: ReactNode;
}) {
  // The same views, the same array: the panel's control is made again only when they change.
  const viewsKey = (offered ?? (object ? ["activity", "fiche", "results"] : ["activity"])).join(" ");
  const views = useMemo(() => viewsKey.split(" ") as PanelView[], [viewsKey]);
  const wide = useSyncExternalStore(onWideChange, wideScreen, wideOnServer);
  const room = useSyncExternalStore(onRoomChange, roomForBoth, wideOnServer);
  const workPane = useWorkPane();
  const givenWay = !room && workPane?.item != null;
  // Untouched, the panel is as the screen has it; once an icon is used, as the Candidate left it.
  const [changed, setChanged] = useState<FicheState | null>(null);
  const state = useMemo<FicheState>(() => changed ?? { view: !wide ? null : object ? "fiche" : split ? "activity" : null }, [changed, object, split, wide]);
  const widthSpec = split ? FIRST_WELCOME_SPLIT_WIDTH : SIDE_PANEL_WIDTH;
  const [widthReset, setWidthReset] = useState(0);
  const ficheId = `${useId()}-panel`;
  // What opened the panel: the focus goes back to it when its ✕ closes it (#608).
  const opener = useRef<HTMLElement | null>(null);
  const focusBack = useRef(false);
  useEffect(() => {
    if (state.view !== null || !focusBack.current) return;
    focusBack.current = false;
    const back = opener.current?.isConnected ? opener.current : document.getElementById(MAIN_ID);
    opener.current = null;
    back?.focus();
  }, [state.view]);
  // The icons act on what is shown: a panel that has given way is brought back, in the Work Pane's place.
  const shownView = givenWay ? null : state.view;
  const control = useMemo<Control>(() => {
    const shownState: FicheState = { view: shownView };
    const remember = () => {
      if (document.activeElement instanceof HTMLElement && !document.getElementById(ficheId)?.contains(document.activeElement)) opener.current = document.activeElement;
    };
    return {
      object,
      views,
      state,
      givenWay,
      shown: shownState.view,
      ficheId,
      toggle: (view) => {
        if (!views.includes(view)) return;
        if (givenWay) workPane?.close();
        remember();
        setChanged(toggleView(shownState, view));
      },
      open: (view) => {
        if (!views.includes(view) || shownState.view === view) return;
        if (givenWay) workPane?.close();
        remember();
        setChanged({ view });
      },
      wide,
      split,
      widthSpec,
      close: () => {
        focusBack.current = true;
        setChanged({ view: null });
      },
      resetWidth: () => {
        setPanelWidthProperty(widthSpec, null);
        writePanelWidth(widthSpec, null);
        setWidthReset((n) => n + 1);
      },
      widthReset,
    };
  }, [object, views, state, givenWay, shownView, workPane, ficheId, wide, split, widthSpec, widthReset]);
  // Alt+Shift and a view's letter: what its icon does, wherever the focus is, the message box included.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      const view = SHORTCUTS[event.code];
      if (!view || !control.views.includes(view)) return;
      event.preventDefault();
      control.toggle(view);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [control]);
  // AI Activity's icon shows Activity or hides it (#809); « Dans l'activité » opens it; « Voir dans la conversation »
  // closes it where it covers the conversation (#808).
  const { toggle, open } = control;
  const column = useMemo<ActivityColumn>(
    () => ({
      shown: shownView === "activity",
      toggle: () => toggle("activity"),
      controls: shownView !== null ? ficheId : undefined,
      open: () => open("activity"),
      closeOverConversation: () => {
        if (wide || shownView === null) return;
        setChanged({ view: null });
      },
      wide,
    }),
    [shownView, toggle, open, ficheId, wide],
  );
  return (
    <FicheControl.Provider value={control}>
      <ActivityColumnControl.Provider value={column}>{children}</ActivityColumnControl.Provider>
    </FicheControl.Provider>
  );
}

const VIEW_ICONS: Record<Exclude<PanelView, "activity">, ComponentType> = { fiche: Icons.fiche, offer: Icons.offer, results: Icons.results };
const VIEW_RANKS: Record<Exclude<PanelView, "activity">, number> = { fiche: TOP_BAR_RANK.fiche, offer: TOP_BAR_RANK.offer, results: TOP_BAR_RANK.results };

/** A view's name, as its icon and the panel's head say it. */
function useViewLabel(): (view: PanelView, object: FicheContent | null | undefined) => string {
  const { t } = useTranslation();
  return (view, content) => (view === "results" ? t(content?.resultsLabel === "offers" ? "fiche.views.offers" : "fiche.views.documents") : t(`fiche.views.${view}`));
}

/**
 * The side panel's icons in the Top Bar (#980), in place of « Fiche », « Activité » and « Effacer »: Activité (AI Activity's
 * icon, #809), Fiche, L'offre and Documents, those the page offers, each a toggle named by its view, with its tooltip; then
 * « … » (« Largeur du volet par défaut », « Fermer le volet ») while the panel is open beside the conversation. ← and → go
 * from one icon to the next. On a phone, nothing: they offer their toggles to the compact Top Bar (#897).
 */
export function FicheButtons({ content }: { content?: FicheContent | null }) {
  const { t } = useTranslation();
  const control = useContext(FicheControl);
  const mode = useTopBarMode();
  const label = useViewLabel();
  const activityIcon = useActivityTopBarAction();
  const viewIcons = (["fiche", "offer", "results"] as const).map((view) => ({ view, action: control?.views.includes(view) ? viewAction(control, view, label(view, content)) : null }));
  // One hook per view, in a fixed order.
  const ficheIcon = useTopBarAction(viewIcons[0]!.action);
  const offerIcon = useTopBarAction(viewIcons[1]!.action);
  const resultsIcon = useTopBarAction(viewIcons[2]!.action);
  if (!control || mode === "compact") return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".topbar-view")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[(at + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };
  return (
    <>
      <div className="topbar-views" role="group" aria-label={t("fiche.panel")} onKeyDown={onKeyDown}>
        <AiActivityButton />
        {viewIcons.map(({ view, action }) =>
          action ? (
            <button
              key={view}
              className="topbar-view"
              type="button"
              aria-label={action.label}
              title={action.label}
              aria-expanded={control.shown === view}
              aria-controls={control.shown === view ? control.ficheId : undefined}
              onClick={action.run}
            >
              <action.icon />
            </button>
          ) : null,
        )}
        <PanelMenu />
      </div>
      {/* Before the page knows its width, app.css shows the first on a phone: « Fiche » ranks first (TOP_BAR_RANK). */}
      {ficheIcon}
      {activityIcon}
      {offerIcon}
      {resultsIcon}
    </>
  );
}

function viewAction(control: Control, view: Exclude<PanelView, "activity">, label: string) {
  return {
    id: `view-${view}`,
    rank: VIEW_RANKS[view],
    label,
    icon: VIEW_ICONS[view],
    run: () => control.toggle(view),
    expanded: control.shown === view,
    controls: control.shown === view ? control.ficheId : undefined,
  };
}

/** « … » beside the icons, while the panel is open beside the conversation: its default width again, or close it. */
function PanelMenu() {
  const { t } = useTranslation();
  const control = useContext(FicheControl);
  if (!control || control.shown === null || !control.wide) return null;
  const label = t("fiche.more");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="topbar-view topbar-view-more" aria-label={label} title={label}>
        <Icons.more />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu topbar-menu" align={MENU_ALIGN} sideOffset={4}>
          <DropdownMenu.Item className="menu-item" onSelect={control.resetWidth}>
            {t("fiche.resetWidth")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={control.close}>
            <Icons.close />
            {t("fiche.close")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The side panel (#980, ADR-0070): one column beside the conversation, never over it, showing one view at a time, the one
 * its Top Bar icon chose. Its head names the view and has ✕ « Fermer le volet »; on a phone it opens over the
 * conversation, full screen, its name taking the focus (#608). Nothing while it is closed, or outside a FicheProvider;
 * hidden while it has given way to the Work Pane, still there for the link that opened it to get the focus back.
 *
 * - « Activité » (ADR-0086): the Context bar, « En ce moment », the history, then the latest Results with « Tout voir ».
 * - « Fiche »: the object's card and its Sections, each opened in the Work Pane, the one shown marked.
 * - « L'offre »: an Application's Job Offer.
 * - « Documents » (« Offres trouvées »): its Results.
 */
export function Fiche({ content }: { content: FicheContent | null }) {
  const { t } = useTranslation();
  const control = useContext(FicheControl);
  const label = useViewLabel();

  if (!control || control.state.view === null) return null;
  const view = control.state.view;
  const name = label(view, content);
  const links = (items: readonly FicheLink[]) => <PanelLinks items={items} />;
  const results = content?.results ?? [];
  return (
    <aside
      id={control.ficheId}
      className={`fiche side-panel${content ? "" : " activity-column"}${control.split ? " first-welcome-split" : ""}`}
      data-view={view}
      aria-label={name}
      hidden={control.givenWay}
      onKeyDown={closeOnEscape(control)}
    >
      {/* « Largeur du volet par défaut » forgets the width remembered and draws the handle afresh, at the default. */}
      {control.wide ? <PanelResizeHandle key={control.widthReset} spec={control.widthSpec} label={t("fiche.resize")} /> : null}
      <PanelHead key={view} label={name} close={control.close} focus={!control.wide} />
      <div className="fiche-body">
        {view === "activity" ? (
          <>
            {/* The first welcome (#1051): the Profile in construction first, until the offered Job Search starts. */}
            {control.split ? <ProfileBuilding /> : null}
            <ContextBar />
            <EnCeMoment />
            <AiActivityContent>
              {content ? (
                <section className="panel-section panel-results" aria-labelledby={`${control.ficheId}-latest`}>
                  <h3 id={`${control.ficheId}-latest`} className="panel-section-title">
                    {t("fiche.groups.results")}
                    {results.length > LATEST_RESULTS ? (
                      <button className="panel-section-action" type="button" onClick={() => control.open("results")}>
                        {t("fiche.allResults")}
                      </button>
                    ) : null}
                  </h3>
                  {results.length > 0 ? links(results.slice(0, LATEST_RESULTS)) : <p className="hint">{t("fiche.noResults")}</p>}
                </section>
              ) : null}
            </AiActivityContent>
          </>
        ) : null}
        {view === "fiche" && content ? (
          <>
            <div className="fiche-card">{content.card}</div>
            {content.sections.length > 0 ? (
              <section className="panel-section" aria-labelledby={`${control.ficheId}-sections`}>
                <h3 id={`${control.ficheId}-sections`} className="panel-section-title">
                  {t("fiche.groups.sections")}
                </h3>
                {links(content.sections)}
              </section>
            ) : null}
          </>
        ) : null}
        {view === "offer" && content?.offer ? <div className="panel-offer">{content.offer}</div> : null}
        {view === "results" && content ? (content.offers ?? (results.length > 0 ? links(results) : <p className="hint">{t("fiche.noResults")}</p>)) : null}
      </div>
    </aside>
  );
}

/** Sections or Results, each opened in the Work Pane at its address, the one shown marked as the current page. */
function PanelLinks({ items }: { items: readonly FicheLink[] }) {
  const pathname = usePathname();
  // The address shown, with its query (a Result's).
  const query = useSearchParams()?.toString() ?? "";
  const shownAddress = query ? `${pathname}?${query}` : pathname;
  return (
    <ul className="fiche-links">
      {items.map((item) => (
        <li key={item.href + item.label}>
          <Link href={item.href} aria-current={item.href === shownAddress ? CURRENT : undefined} scroll={false}>
            <span className="fiche-link-label">{item.label}</span>
            {item.detail ? <span className="fiche-link-detail">{item.detail}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** On a phone, Escape closes the panel open over the conversation, as its ✕ does; beside it, the Top Bar's icons. */
const closeOnEscape = (control: Control) => (event: KeyboardEvent<HTMLElement>) => {
  if (control.wide || event.key !== "Escape" || event.defaultPrevented) return;
  event.stopPropagation();
  control.close();
};

/**
 * The panel's head (#980): the view's name and ✕ « Fermer le volet ». On a phone, open over the conversation, full screen
 * (#608), the name takes the focus as it opens, so it is read out.
 */
function PanelHead({ label, close, focus }: { label: string; close: () => void; focus: boolean }) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  return (
    <div className="fiche-head">
      <h2 ref={heading} tabIndex={-1}>
        {label}
      </h2>
      <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" aria-label={t("fiche.close")} title={t("fiche.close")} onClick={close}>
        <Icons.close />
      </button>
    </div>
  );
}

/**
 * Whether a column covers the conversation: on a phone, the Work Pane or the side panel open over it, full screen (#608).
 * The page behind is then out of reach (SidebarShell's `pageInert`), as behind a dialog.
 */
export function useColumnOverPage(): boolean {
  const control = useContext(FicheControl);
  const workPane = useWorkPane();
  if (!control || control.wide) return false;
  return workPane?.item != null || control.state.view !== null;
}
