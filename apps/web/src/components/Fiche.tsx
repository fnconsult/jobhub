"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AiActivityContent, useAiActivityUnderWay } from "@/components/AiActivity";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { Icons } from "@/components/icons";
import { CURRENT } from "@/components/SidebarShell";
import { useWorkPane } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { SIDEBAR_CLOSED } from "@/design/sidebar-state";

/** A Section or a Result the Fiche lists: its own address, which opens it in the Work Pane. */
export type FicheLink = { href: string; label: string; detail?: string };

/**
 * What an object's Fiche shows (ADR-0070), from its page: the object's `card` (its properties, changed in place), then
 * its `sections` and its `results`, each opened in the Work Pane at its address.
 */
export type FicheContent = { card: ReactNode; sections: readonly FicheLink[]; results: readonly FicheLink[] };

/** The Fiche's groups, each folded or not. */
export type FicheGroup = "sections" | "activity" | "results";

/** Whether the Fiche is open, and which of its groups are folded. */
export type FicheState = { open: boolean; folded: ReadonlySet<FicheGroup> };

/** « Fiche » opens it, or closes it. */
export const toggleFiche = (state: FicheState): FicheState => ({ ...state, open: !state.open });

/** Its Activity group is shown: the Fiche is open, the group unfolded. « Activité » in the Top Bar says so. */
export const activityShown = (state: FicheState) => state.open && !state.folded.has("activity");

/** Folds `group`, or unfolds it. */
export function toggleGroup(state: FicheState, group: FicheGroup): FicheState {
  const folded = new Set(state.folded);
  if (!folded.delete(group)) folded.add(group);
  return { ...state, folded };
}

/** « Activité » folds the Activity group when it is shown; otherwise opens the Fiche on it, unfolded. */
export function toggleActivity(state: FicheState): FicheState {
  if (activityShown(state)) return toggleGroup(state, "activity");
  const folded = new Set(state.folded);
  folded.delete("activity");
  return { open: true, folded };
}

/** Wide enough for the Fiche beside the conversation: it starts open there (below, it would cover the page). */
const WIDE = "(width >= 64rem)";
/**
 * Wide enough for the Fiche and the Work Pane beside the conversation, the Sidebar open: the Sidebar (16rem), the Fiche
 * (20rem), the Work Pane (32vw, 20 to 32rem) and their gutters leave the conversation 0.68 × the screen − 40rem, which
 * under 28rem no longer reads (its box and suggestions cut, its words wrapping letter by letter).
 */
const ROOM_FOR_BOTH = "(width >= 100rem)";
/** The same, the Sidebar hidden: 0.68 × the screen − 24rem. */
const ROOM_FOR_BOTH_SIDEBAR_HIDDEN = "(width >= 76.5rem)";
const UNFOLDED: ReadonlySet<FicheGroup> = new Set();
const SECTIONS: FicheGroup = "sections";
const ACTIVITY: FicheGroup = "activity";
const RESULTS: FicheGroup = "results";
/** The glyph « Activité » shows while an AI action of the page is under way, before its step is known. */
const UNDER_WAY = "think";

const noSubscription = () => () => {};
/** Whether the screen is wide enough for the Fiche: the server's HTML, and a browser without media queries, say it is. */
const wideScreen = () => typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches;
const wideOnServer = () => true;

/** Whether the screen has room for the Fiche beside the Work Pane, with the Sidebar as the Candidate left it. */
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
  /** As the Candidate left it: open or not, its groups folded or not. */
  state: FicheState;
  /** Open, it has given its place to the Work Pane for want of room (ADR-0070), so is not shown. */
  givenWay: boolean;
  ficheId: string;
  toggleFiche: () => void;
  toggleActivity: () => void;
  toggleGroup: (group: FicheGroup) => void;
  /** Counts « Activité »'s openings: the Fiche scrolls its Activity group into view. */
  activityAsked: number;
};

const FicheControl = createContext<Control | null>(null);

/**
 * The Fiche's state on an object's page (#603, ADR-0070), shared by the Top Bar's « Fiche » and « Activité », which alone
 * open and close it, and by the Fiche itself, whose groups fold. Open, every group unfolded, when the page loads on a wide
 * screen; closed on a narrower one.
 *
 * Without room for both beside the conversation, the Work Pane takes the Fiche's place while it is open, and the Fiche
 * comes back as it was when it closes. « Fiche » and « Activité » then say it is not shown, and bring it back, closing the
 * Work Pane.
 */
export function FicheProvider({ children }: { children: ReactNode }) {
  const wide = useSyncExternalStore(noSubscription, wideScreen, wideOnServer);
  const room = useSyncExternalStore(onRoomChange, roomForBoth, wideOnServer);
  const workPane = useWorkPane();
  const givenWay = !room && workPane?.item != null;
  // Untouched, the Fiche is as the screen has it; once « Fiche », « Activité » or a group is used, as the Candidate left it.
  const [changed, setChanged] = useState<FicheState | null>(null);
  const state = useMemo(() => changed ?? { open: wide, folded: UNFOLDED }, [changed, wide]);
  const [activityAsked, setActivityAsked] = useState(0);
  const ficheId = useId();
  const control = useMemo<Control>(() => {
    // « Fiche » and « Activité » act on what is shown: a Fiche that has given way is brought back, in the Work Pane's place.
    const shown = { ...state, open: state.open && !givenWay };
    const bringBack = () => {
      if (givenWay) workPane?.close();
    };
    return {
      state,
      givenWay,
      ficheId: `${ficheId}-fiche`,
      toggleFiche: () => {
        bringBack();
        setChanged(toggleFiche(shown));
      },
      toggleActivity: () => {
        bringBack();
        setChanged(toggleActivity(shown));
        setActivityAsked((n) => n + 1);
      },
      toggleGroup: (group) => setChanged(toggleGroup(state, group)),
      activityAsked,
    };
  }, [state, givenWay, workPane, ficheId, activityAsked]);
  return <FicheControl.Provider value={control}>{children}</FicheControl.Provider>;
}

/**
 * « Fiche » and « Activité » in the Top Bar of an object's page (#603): they alone open and close the Fiche, « Activité »
 * on its Activity group, its glyph live while an AI action of the page is under way. Nothing outside a FicheProvider.
 */
export function FicheButtons() {
  const { t } = useTranslation();
  const control = useContext(FicheControl);
  const underWay = useAiActivityUnderWay();
  if (!control) return null;
  const { ficheId } = control;
  // What is shown: a Fiche that has given way to the Work Pane is not.
  const state = { ...control.state, open: control.state.open && !control.givenWay };
  const activity = activityShown(state);
  return (
    <>
      <button
        className={`${buttonClass()} topbar-fiche`}
        type="button"
        aria-expanded={state.open}
        aria-controls={state.open ? ficheId : undefined}
        onClick={control.toggleFiche}
      >
        <Icons.fiche />
        {t("fiche.label")}
      </button>
      <button
        className={`${buttonClass()} topbar-activity`}
        type="button"
        aria-expanded={activity}
        aria-controls={state.open ? ficheId : undefined}
        onClick={control.toggleActivity}
      >
        {underWay ? <ActivityGlyph activity={UNDER_WAY} live /> : <Icons.aiActivity />}
        {t("fiche.activity")}
      </button>
    </>
  );
}

/**
 * The Fiche (#603, ADR-0070): the column beside an object's conversation, never over it, with no heading nor ✕ of its
 * own (the Top Bar's « Fiche » closes it). The object's card, then three groups the Candidate folds: its Sections, its
 * Activity (the page's AI Activity) and its Results; a Section or a Result opens in the Work Pane at its address, the one
 * shown marked as the current page. Nothing while it is closed, or outside a FicheProvider; hidden while it has given
 * way to the Work Pane, still there for the link that opened it to get the focus back when the pane closes.
 */
export function Fiche({ content }: { content: FicheContent }) {
  const { t } = useTranslation();
  const control = useContext(FicheControl);
  const pathname = usePathname();
  const activity = useRef<HTMLDivElement>(null);
  const asked = control?.activityAsked ?? 0;
  const open = control?.state.open ?? false;
  const visible = open && !control?.givenWay;

  // « Activité » brings the Activity group into view.
  useEffect(() => {
    if (asked > 0 && visible) activity.current?.scrollIntoView?.({ block: "nearest" });
  }, [asked, visible]);

  // The address shown, with its query (a Result's).
  const query = useSearchParams()?.toString() ?? "";
  const shown = query ? `${pathname}?${query}` : pathname;

  if (!control || !open) return null;
  const { state, ficheId } = control;
  const links = (items: readonly FicheLink[]) => (
    <ul className="fiche-links">
      {items.map((item) => (
        <li key={item.href}>
          <Link href={item.href} aria-current={item.href === shown ? CURRENT : undefined} scroll={false}>
            <span className="fiche-link-label">{item.label}</span>
            {item.detail ? <span className="fiche-link-detail">{item.detail}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <aside id={ficheId} className="fiche" aria-label={t("fiche.label")} hidden={control.givenWay}>
      <div className="fiche-card">{content.card}</div>
      <Group group={SECTIONS} label={t("fiche.groups.sections")} state={state} toggle={control.toggleGroup}>
        {links(content.sections)}
      </Group>
      <Group group={ACTIVITY} label={t("fiche.groups.activity")} state={state} toggle={control.toggleGroup} anchor={activity}>
        <AiActivityContent />
      </Group>
      <Group group={RESULTS} label={t("fiche.groups.results")} state={state} toggle={control.toggleGroup}>
        {content.results.length > 0 ? links(content.results) : <p className="hint">{t("fiche.noResults")}</p>}
      </Group>
    </aside>
  );
}

/** One of the Fiche's groups: its heading is the button that folds it. */
function Group({
  group,
  label,
  state,
  toggle,
  anchor,
  children,
}: {
  group: FicheGroup;
  label: string;
  state: FicheState;
  toggle: (group: FicheGroup) => void;
  anchor?: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const id = useId();
  const unfolded = !state.folded.has(group);
  return (
    <div ref={anchor} className="fiche-group" data-group={group}>
      <h3 className="fiche-group-head">
        <button type="button" aria-expanded={unfolded} aria-controls={`${id}-body`} onClick={() => toggle(group)}>
          <Icons.chevron />
          {label}
        </button>
      </h3>
      {unfolded ? (
        <div id={`${id}-body`} className="fiche-group-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
