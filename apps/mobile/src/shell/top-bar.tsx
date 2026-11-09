import { Ellipsis, Square, type LucideIcon } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, ActionSheetIOS, findNodeHandle, Platform, View, useWindowDimensions } from "react-native";
import { space } from "../theme/theme";
import { Control } from "../ui/Control";
import { ContextMenu, type Anchor } from "../ui/ObjectRow";

/**
 * One of the page's actions in the Top Bar (#899, as the web's #897): on the wide bar, a button with its words; in the
 * compact Top Bar, one of them an icon alone, the others under « … » with their words. Each does there what its button
 * does on the wide bar: `run` is the very function that button calls.
 */
export type TopBarAction = {
  id: string;
  /** Which is shown: the lowest rank (TOP_BAR_RANK), unless one is `running`; under « … », in rank order. */
  rank: number;
  /** Its words under « … », and the icon's accessible name unless `accessibleName` says more. */
  label: string;
  /** The icon's accessible name, when it says more than its words (the filter's count and source, #899). */
  accessibleName?: string;
  /** A dot on the icon (a source chosen in the Recherches d'offres filter). */
  badge?: boolean;
  /** Its button's words on the wide bar, when they are not `label` (« Effacer », « Effacer la conversation » under « … »). */
  wideLabel?: string;
  icon: LucideIcon;
  run: () => void;
  /** Its button on the wide bar: outlined (« Fiche », « Activité », « Effacer »), or its icon alone (the pencil). */
  look?: "secondary";
  iconOnly?: boolean;
  /** A toggle's state: its pane open. */
  expanded?: boolean;
  /**
   * An AI action under way (Activité's, #333): this one takes the visible place, named `name` (« Activité IA », then the
   * step), its stop icon before it; back under « … » when it ends.
   */
  running?: { name: string; stop: { label: string; run: () => void } } | null;
};

/** The id of the screen's own main action (useTopBarPrimary). */
const PAGE_ACTION = "page";

/** The page's own action first (the Recherches d'offres filter, #898), then the wide bar's order. */
export const TOP_BAR_RANK = { page: 0, fiche: 10, activity: 20, clear: 30, newConversation: 40 } as const;

/** The action the compact Top Bar shows, and those under « … ». */
export function arrangeTopBar(actions: readonly TopBarAction[]): { shown: TopBarAction | null; menu: TopBarAction[] } {
  const ranked = [...actions].sort((a, b) => a.rank - b.rank);
  const shown = ranked.find((action) => action.running) ?? ranked[0] ?? null;
  return { shown, menu: ranked.filter((action) => action !== shown) };
}

/** A screen's own main action, as it offers it (useTopBarPrimary). */
export type TopBarPrimary = Pick<TopBarAction, "label" | "accessibleName" | "badge" | "icon" | "run" | "expanded">;

/** Offers `action` for the screen `key` (useId), or takes its own back with null. */
type Offer = (key: string, action: TopBarAction | null) => void;

/**
 * What the Shell tells its page of its Top Bar: how a screen offers its main action (`offer`), whether the bar is
 * compact (`compact`: the panes full page, a phone), and `focusPrimary`, which moves VoiceOver's and TalkBack's focus
 * to where the compact bar has the screen's action now: its icon, or « … » while an AI action has its place.
 */
type TopBarHost = { offer: Offer; compact: boolean; focusPrimary: () => void };
const Host = createContext<TopBarHost>({ offer: () => {}, compact: false, focusPrimary: () => {} });

/** Held by the Shell around its page: what its screens offer with useTopBarPrimary, the latest offer first. */
export const TopBarPrimaryProvider = Host.Provider;

/** Whether the page is under the compact Top Bar (#899): its own main action is then an icon in the bar. */
export const useCompactTopBar = () => useContext(Host).compact;

/**
 * Moves the screen reader's focus to the screen's main action in the compact Top Bar (its icon, or « … » while an AI
 * action runs): where it goes back once what that action opened closes, or a notice the screen showed goes (#899).
 */
export const useFocusTopBarPrimary = () => useContext(Host).focusPrimary;

/**
 * The Shell's: the screen's main action, the latest offered (`primary`), how a screen offers one (`offer`), and `place`,
 * which CompactTopBarActions sets to focus where it shows that action.
 */
export function useTopBarPrimaryOffers(): { primary: TopBarAction | null; offer: Offer; place: RefObject<(() => void) | null> } {
  const [offers, setOffers] = useState<readonly { key: string; action: TopBarAction }[]>([]);
  const offer = useCallback<Offer>(
    (key, action) => setOffers((current) => [...current.filter((each) => each.key !== key), ...(action ? [{ key, action }] : [])]),
    [],
  );
  const place = useRef<(() => void) | null>(null);
  return { primary: offers.at(-1)?.action ?? null, offer, place };
}

/**
 * A screen's own main action (#899, for the Recherches d'offres filter of #898): the compact Top Bar shows it, ahead of
 * « Fiche » and « Activité », which go under « … »; on the wide bar, its button first. Taken back when the screen goes,
 * or with `null`. The latest `run` is called, so the action is offered again only when its label, icon or state change.
 * A screen that stays mounted under the one shown (a Stack's) offers it only while it is focused (`null` otherwise).
 */
export function useTopBarPrimary(action: TopBarPrimary | null) {
  const { offer } = useContext(Host);
  const key = useId();
  const run = useRef(action?.run);
  useLayoutEffect(() => {
    run.current = action?.run;
  });
  const offered = action !== null;
  const label = action?.label;
  const icon = action?.icon;
  const expanded = action?.expanded;
  const accessibleName = action?.accessibleName;
  const badge = action?.badge;
  useEffect(() => {
    if (!offered || label === undefined || icon === undefined) return;
    offer(key, { id: PAGE_ACTION, rank: TOP_BAR_RANK.page, label, accessibleName, badge, icon, expanded, run: () => run.current?.() });
    return () => offer(key, null);
  }, [offer, key, offered, label, accessibleName, badge, icon, expanded]);
}

/**
 * The compact Top Bar's actions (#899): the one shown, an icon alone named by its words (Activité while an AI action
 * runs, named « Activité IA » and the step, its stop icon before it), then « … » (« Autres actions »), which opens the
 * system's action sheet on iOS, and on Android a menu under it, as Android's overflow menus open: the others, each with
 * its words. When the run ends after its stop icon was pressed, which then goes, VoiceOver's and TalkBack's focus moves
 * to « … », where Activité is again. `placeRef`: set to move that focus to the screen's own action, its icon or « … »
 * (useFocusTopBarPrimary). An icon whose pane or panel is open is drawn pressed, as the web's.
 */
export function CompactTopBarActions({ actions, placeRef }: { actions: readonly TopBarAction[]; placeRef?: RefObject<(() => void) | null> }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const more = useRef<ComponentRef<typeof View>>(null);
  const [menuAt, setMenuAt] = useState<Anchor | null>(null);
  const { shown, menu } = arrangeTopBar(actions);
  const running = shown?.running ?? null;
  const shownIcon = useRef<ComponentRef<typeof View>>(null);
  const primaryShown = shown?.id === PAGE_ACTION;
  useLayoutEffect(() => {
    if (!placeRef) return;
    placeRef.current = () => {
      const target = primaryShown ? shownIcon.current : more.current;
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
    };
  });

  const stopped = useRef(false);
  useEffect(() => {
    if (running || !stopped.current) return;
    stopped.current = false;
    if (more.current) AccessibilityInfo.sendAccessibilityEvent(more.current, "focus");
  }, [running]);

  const moreLabel = t("sidebar.moreActions");
  const openMore = () => {
    if (Platform.OS === "ios") {
      const options = [...menu.map((action) => action.label), t("coachPanel.cancel")];
      const handle = more.current ? findNodeHandle(more.current) : null;
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: menu.length, anchor: handle ?? undefined }, (index) => menu[index]?.run());
      return;
    }
    // Under « … », at the window's right edge, as soon as it opens; then exactly under it once it is measured.
    setMenuAt({ x: width, y: 0 });
    more.current?.measureInWindow((x, y, _width, height) => setMenuAt({ x, y: y + height }));
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
      {running ? (
        <Control
          label={running.stop.label}
          icon={Square}
          iconOnly
          onPress={() => {
            stopped.current = true;
            running.stop.run();
          }}
        />
      ) : null}
      {shown ? (
        <Control
          ref={shownIcon}
          label={shown.label}
          accessibleName={running?.name ?? shown.accessibleName}
          icon={shown.icon}
          iconOnly
          expanded={shown.expanded}
          toggled={shown.expanded}
          badge={shown.badge}
          onPress={shown.run}
        />
      ) : null}
      {menu.length > 0 ? <Control ref={more} label={moreLabel} icon={Ellipsis} iconOnly testID="top-bar-more" onPress={openMore} /> : null}
      {menuAt ? (
        <ContextMenu
          name={moreLabel}
          anchor={menuAt}
          actions={menu.map((action) => ({ label: action.label, icon: action.icon, onPress: action.run }))}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </View>
  );
}
