"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";

/**
 * One of the page's actions in the Top Bar (#897): on a phone, the compact Top Bar shows one of them as an icon alone,
 * the others under « … » with their words. Each does there what its button does on a wider screen: `run` is the very
 * function that button calls.
 */
export type TopBarAction = {
  id: string;
  /** Which is shown: the lowest rank (TOP_BAR_RANK), unless one is `running`; under « … », in rank order. */
  rank: number;
  /** Its words in « … », and the icon's name and tooltip. */
  label: string;
  /** The icon's tooltip when it is not its words (« Activité IA », as on AI Activity's button, #809). */
  tooltip?: string;
  icon: ComponentType;
  /** Drawn in the icon's place while it is the one shown (Activité's live glyph while an AI action runs, #333). */
  glyph?: ReactNode;
  run: () => void;
  /** The icon's name when it is not its words: « Activité IA », and the page's summary or the step under way (#369, #809). */
  name?: ReactNode;
  /** Shown before the icon while it is the one shown (Activité's stop icon, #369). */
  beside?: ReactNode;
  /** A toggle's state, and what it opens. */
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  /** Takes the visible place while true (Activité while an AI action runs), the page's action going under « … ». */
  running?: boolean;
};

/** The page's own action first (a filter, #898), then the wide bar's order: « Fiche », « Activité », « Effacer », « Aide ». */
export const TOP_BAR_RANK = { page: 0, fiche: 10, activity: 20, clear: 30, help: 40 } as const;

/** The action the compact Top Bar shows, and those under « … ». */
export function arrangeTopBar(actions: readonly TopBarAction[]): { shown: TopBarAction | null; menu: TopBarAction[] } {
  const ranked = [...actions].sort((a, b) => a.rank - b.rank);
  const shown = ranked.find((action) => action.running) ?? ranked[0] ?? null;
  return { shown, menu: ranked.filter((action) => action !== shown) };
}

/** The phone's width, as app.css has it: below it the Top Bar is compact. */
const NARROW = "(width < 40rem)";

type Store = {
  set: (id: string, action: TopBarAction | null) => void;
  get: (id: string) => TopBarAction | undefined;
  subscribe: (listener: () => void) => () => void;
  snapshot: () => readonly TopBarAction[];
};

function createStore(): Store {
  const actions = new Map<string, TopBarAction>();
  const listeners = new Set<() => void>();
  let snapshot: readonly TopBarAction[] = [];
  return {
    set(id, action) {
      if (action) {
        const before = actions.get(id);
        // Offered again as it was (each render of its button): nothing changes, nobody is told.
        if (before && sameAction(before, action)) return;
        actions.set(id, action);
      } else if (!actions.delete(id)) return;
      snapshot = [...actions.values()];
      for (const listener of listeners) listener();
    },
    get: (id) => actions.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
  };
}

/** The same action, field by field. */
function sameAction(a: TopBarAction, b: TopBarAction): boolean {
  const keys = Object.keys(a) as Array<keyof TopBarAction>;
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

const NO_ACTIONS: readonly TopBarAction[] = [];
/** « … »'s menu, under it, at the screen's right edge. */
const MENU_ALIGN = "end";

/**
 * How the Top Bar's buttons draw themselves (#897). `wide`: each its own button with its words. `compact` (a phone):
 * none, the compact Top Bar showing their actions (CompactTopBarActions). `both`, while the width is not known (the
 * server's HTML, and hydration): each its button and its action's icon, app.css showing the one for the screen's width
 * (`width < 40rem`) and hiding the other (`display: none`, out of the accessibility tree and the tab order), so the first
 * paint is the right bar at every width, before or without JavaScript.
 */
export type TopBarMode = "wide" | "compact" | "both";

const TopBarStore = createContext<Store | null>(null);
const Mode = createContext<TopBarMode>("wide");

function onNarrowChange(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(NARROW) : null;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
/** Below 40rem: a phone, where the Candidate's Top Bar is compact. */
export const narrowScreen = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
/** The server does not know the screen's width. */
const unknownOnServer = () => null;

/** The Top Bar's actions and how its buttons draw themselves, held by the layout (SidebarShell). */
export type TopBarState = { store: Store; mode: TopBarMode };

/**
 * `compactLayout`: the layout has a compact Top Bar (the Candidate's pages, not the Back Office's), which it is on a
 * phone, below 40rem. The server's HTML has both bars' buttons, app.css showing one (`both`).
 */
export function useTopBarState(compactLayout: boolean): TopBarState {
  const [store] = useState(createStore);
  const narrow = useSyncExternalStore<boolean | null>(onNarrowChange, narrowScreen, unknownOnServer);
  const mode: TopBarMode = !compactLayout || narrow === false ? "wide" : narrow ? "compact" : "both";
  return { store, mode };
}

/** Gives the page's buttons the Top Bar's state: they offer it their actions (useTopBarAction). */
export function TopBarActionsProvider({ state, children }: { state: TopBarState; children: ReactNode }) {
  return (
    <TopBarStore.Provider value={state.store}>
      <Mode.Provider value={state.mode}>{children}</Mode.Provider>
    </TopBarStore.Provider>
  );
}

/** How the Top Bar's buttons draw themselves: `compact`, they render nothing, the compact Top Bar showing their actions. */
export function useTopBarMode(): TopBarMode {
  return useContext(Mode);
}

/**
 * Offers `action` to the compact Top Bar, as it is at each render; null offers none. Returns what its button renders
 * beside itself: while the width is not known (`both`), the action's icon, which app.css shows on a phone in the
 * compact Top Bar's place; otherwise nothing.
 */
export function useTopBarAction(action: TopBarAction | null): ReactNode {
  const store = useContext(TopBarStore);
  const mode = useContext(Mode);
  const id = action?.id;
  useLayoutEffect(() => {
    if (store && action) store.set(action.id, action);
  });
  useLayoutEffect(() => {
    if (!store || !id) return;
    return () => store.set(id, null);
  }, [store, id]);
  return mode === "both" && action ? <ActionIcon action={action} className="topbar-icon topbar-first-paint" beforeHydration /> : null;
}

/**
 * A page's own main action (#897), shown in the compact Top Bar ahead of « Fiche » and « Activité »: Recherches
 * d'offres' filter (#898). On a wider screen the page shows it itself (useTopBarMode). Returns, as useTopBarAction does,
 * its icon while the width is not known, for its caller to render in the Top Bar, in the page's title
 * (OfferBoxTopBarTitle): app.css shows it on a phone in the compact Top Bar's place and hides the page's buttons' icons
 * for it, so the first paint is the bar hydration leaves.
 */
export function useTopBarPrimary(action: Omit<TopBarAction, "rank"> | null): ReactNode {
  return useTopBarAction(action ? { ...action, rank: TOP_BAR_RANK.page } : null);
}

/**
 * Where the compact Top Bar has, now, the action that controls `controls` (#898): its icon while it is the one shown;
 * « … » while it is under it, an AI action running having taken its place (ADR-0101). Null when there is no compact Top
 * Bar (a wider screen) or before the page knows its width. The focus goes back there when what the action opened closes.
 */
export function compactTopBarPlaceOf(controls: string): HTMLElement | null {
  const bar = document.querySelector<HTMLElement>(".topbar-compact-actions:not(.topbar-first-paint)");
  if (!bar) return null;
  return bar.querySelector<HTMLElement>(`button[aria-controls="${controls}"]`) ?? bar.querySelector<HTMLElement>(".topbar-more");
}

/**
 * An action as an icon alone, named by its words (its `aria-label` and tooltip), or by its `name` when it has one (its
 * `aria-labelledby`). `beforeHydration`: drawn before the page knows its width, when a click would do nothing, so it says
 * it is unavailable (#446) while looking as it will.
 */
function ActionIcon({ action, className, beforeHydration = false }: { action: TopBarAction; className: string; beforeHydration?: boolean }) {
  const nameId = useId();
  const named = action.name !== undefined && action.name !== null;
  return (
    <>
      {/* Its name, outside it: the icon alone shows no words. */}
      {named ? (
        <span id={nameId} hidden>
          {action.name}
        </span>
      ) : null}
      <button
        className={className}
        type="button"
        aria-label={named ? undefined : action.label}
        aria-labelledby={named ? nameId : undefined}
        title={action.tooltip ?? action.label}
        aria-expanded={action.expanded}
        aria-controls={action.controls}
        aria-disabled={beforeHydration || undefined}
        disabled={action.disabled}
        onClick={action.run}
      >
        {action.glyph ?? <action.icon />}
      </button>
    </>
  );
}

/**
 * The compact Top Bar's actions (#897): the one shown, an icon alone named by its words (its `aria-label` and tooltip),
 * then « … », a menu (arrows, Escape, the focus back on « … ») listing the others with their words. A chosen one runs
 * once the menu has closed and given the focus back to « … », so what it opens returns the focus there. While the width
 * is not known (`both`), « … » alone, which app.css shows on a phone after the icon its button drew (useTopBarAction).
 */
export function CompactTopBarActions() {
  const { t } = useTranslation();
  const store = useContext(TopBarStore);
  const mode = useContext(Mode);
  const actions = useSyncExternalStore(store?.subscribe ?? noSubscription, store?.snapshot ?? noActions, store?.snapshot ?? noActions);
  const more = useRef<HTMLButtonElement>(null);
  const chosen = useRef<string | null>(null);
  // The focus was on the stop icon when the action ended, which took it away: « … », where Activité now is, takes it.
  const focusMore = useRef(false);
  useLayoutEffect(() => {
    if (!focusMore.current) return;
    focusMore.current = false;
    more.current?.focus();
  });
  const { shown, menu } = arrangeTopBar(actions);
  const moreLabel = t("sidebar.moreActions");
  if (mode === "both")
    return (
      <div className="topbar-compact-actions topbar-first-paint">
        <button className="topbar-icon topbar-more" type="button" aria-label={moreLabel} title={moreLabel} aria-haspopup="menu" aria-disabled>
          <Icons.more />
        </button>
      </div>
    );
  return (
    <div className="topbar-compact-actions">
      {shown?.beside ? <Beside onFocusTakenAway={() => (focusMore.current = true)}>{shown.beside}</Beside> : null}
      {/* One button whatever it shows: when Activité goes back under « … », the focus stays where it was. */}
      {shown ? <ActionIcon action={shown} className="topbar-icon" /> : null}
      {menu.length > 0 ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger ref={more} className="topbar-icon topbar-more" aria-label={moreLabel} title={moreLabel}>
            <Icons.more />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="menu topbar-menu"
              align={MENU_ALIGN}
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                const id = chosen.current;
                chosen.current = null;
                if (!id) return;
                event.preventDefault();
                more.current?.focus();
                store?.get(id)?.run();
              }}
            >
              {menu.map((action) => (
                <DropdownMenu.Item key={action.id} className="menu-item" disabled={action.disabled} onSelect={() => (chosen.current = action.id)}>
                  <action.icon />
                  {action.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </div>
  );
}

/**
 * What is shown before the action's icon (Activité's stop icon, #369). Told, as it goes, whether it had the focus: its
 * cleanup runs before React takes it out of the page, while `document.activeElement` still says so.
 */
function Beside({ onFocusTakenAway, children }: { onFocusTakenAway: () => void; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const taken = useRef(onFocusTakenAway);
  useLayoutEffect(() => {
    taken.current = onFocusTakenAway;
  });
  useLayoutEffect(() => {
    const element = box.current;
    return () => {
      if (element?.contains(document.activeElement)) taken.current();
    };
  }, []);
  return (
    <span ref={box} className="topbar-beside">
      {children}
    </span>
  );
}

const noSubscription = () => () => {};
const noActions = () => NO_ACTIONS;
