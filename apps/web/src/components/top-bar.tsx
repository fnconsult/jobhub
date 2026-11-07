"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
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
  /** Its words in « … », and the icon's name. */
  label: string;
  icon: ComponentType;
  run: () => void;
  /** The icon's name when it says more than its words (Activité with the step under way). */
  name?: string;
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
      if (action) actions.set(id, action);
      else if (!actions.delete(id)) return;
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

const NO_ACTIONS: readonly TopBarAction[] = [];
/** « … »'s menu, under it, at the screen's right edge. */
const MENU_ALIGN = "end";
const TopBarStore = createContext<Store | null>(null);
const Compact = createContext(false);

function onNarrowChange(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(NARROW) : null;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
const narrowScreen = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
const wideOnServer = () => false;

/** The Top Bar's actions and whether it is compact, held by the layout (SidebarShell). */
export type TopBarState = { store: Store; compact: boolean };

/**
 * `compactLayout`: the layout has a compact Top Bar (the Candidate's pages, not the Back Office's), which it is on a
 * phone, below 40rem. The server's HTML has the wide one.
 */
export function useTopBarState(compactLayout: boolean): TopBarState {
  const [store] = useState(createStore);
  const narrow = useSyncExternalStore(onNarrowChange, narrowScreen, wideOnServer);
  return { store, compact: compactLayout && narrow };
}

/** Gives the page's buttons the Top Bar's state: they offer it their actions (useTopBarAction). */
export function TopBarActionsProvider({ state, children }: { state: TopBarState; children: ReactNode }) {
  return (
    <TopBarStore.Provider value={state.store}>
      <Compact.Provider value={state.compact}>{children}</Compact.Provider>
    </TopBarStore.Provider>
  );
}

/** Whether the Top Bar is compact: its buttons then render nothing, the compact Top Bar showing their actions. */
export function useCompactTopBar(): boolean {
  return useContext(Compact);
}

/** Offers `action` to the compact Top Bar, as it is at each render; null offers none. */
export function useTopBarAction(action: TopBarAction | null): void {
  const store = useContext(TopBarStore);
  const id = action?.id;
  useLayoutEffect(() => {
    if (store && action) store.set(action.id, action);
  });
  useLayoutEffect(() => {
    if (!store || !id) return;
    return () => store.set(id, null);
  }, [store, id]);
}

/**
 * A page's own main action (#897), shown in the compact Top Bar ahead of « Fiche » and « Activité »: Recherches
 * d'offres' filter (#898). On a wider screen the page shows it itself (useCompactTopBar).
 */
export function useTopBarPrimary(action: Omit<TopBarAction, "rank"> | null): void {
  useTopBarAction(action ? { ...action, rank: TOP_BAR_RANK.page } : null);
}

/**
 * The compact Top Bar's actions (#897): the one shown, an icon alone named by its words (its `aria-label` and tooltip),
 * then « … », a menu (arrows, Escape, the focus back on « … ») listing the others with their words. A chosen one runs
 * once the menu has closed and given the focus back to « … », so what it opens returns the focus there.
 */
export function CompactTopBarActions() {
  const { t } = useTranslation();
  const store = useContext(TopBarStore);
  const actions = useSyncExternalStore(store?.subscribe ?? noSubscription, store?.snapshot ?? noActions, store?.snapshot ?? noActions);
  const more = useRef<HTMLButtonElement>(null);
  const chosen = useRef<string | null>(null);
  const { shown, menu } = arrangeTopBar(actions);
  const moreLabel = t("sidebar.moreActions");
  return (
    <div className="topbar-compact-actions">
      {shown?.beside}
      {shown ? (
        // One button whatever it shows: when Activité goes back under « … », the focus stays where it was.
        <button
          className="topbar-icon"
          type="button"
          aria-label={shown.name ?? shown.label}
          title={shown.label}
          aria-expanded={shown.expanded}
          aria-controls={shown.controls}
          disabled={shown.disabled}
          onClick={shown.run}
        >
          <shown.icon />
        </button>
      ) : null}
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

const noSubscription = () => () => {};
const noActions = () => NO_ACTIONS;
