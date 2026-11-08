import { Ellipsis, Square, type LucideIcon } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentRef } from "react";
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
  /** Its words under « … », and the icon's accessible name. */
  label: string;
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

/** The page's own action first (the Recherches d'offres filter, #898), then the wide bar's order. */
export const TOP_BAR_RANK = { page: 0, fiche: 10, activity: 20, clear: 30, newConversation: 40 } as const;

/** The action the compact Top Bar shows, and those under « … ». */
export function arrangeTopBar(actions: readonly TopBarAction[]): { shown: TopBarAction | null; menu: TopBarAction[] } {
  const ranked = [...actions].sort((a, b) => a.rank - b.rank);
  const shown = ranked.find((action) => action.running) ?? ranked[0] ?? null;
  return { shown, menu: ranked.filter((action) => action !== shown) };
}

/** A screen's own main action, as it offers it (useTopBarPrimary). */
export type TopBarPrimary = Pick<TopBarAction, "label" | "icon" | "run" | "expanded">;

/** Offers `action` for the screen `key` (useId), or takes its own back with null. */
type Offer = (key: string, action: TopBarAction | null) => void;
const OfferPrimary = createContext<Offer>(() => {});

/** Held by the Shell around its page: what its screens offer with useTopBarPrimary, the latest offer first. */
export const TopBarPrimaryProvider = OfferPrimary.Provider;

/** The Shell's: the screen's main action, the latest offered (`primary`), and how a screen offers one (`offer`). */
export function useTopBarPrimaryOffers(): { primary: TopBarAction | null; offer: Offer } {
  const [offers, setOffers] = useState<readonly { key: string; action: TopBarAction }[]>([]);
  const offer = useCallback<Offer>(
    (key, action) => setOffers((current) => [...current.filter((each) => each.key !== key), ...(action ? [{ key, action }] : [])]),
    [],
  );
  return { primary: offers.at(-1)?.action ?? null, offer };
}

/**
 * A screen's own main action (#899, for the Recherches d'offres filter of #898): the compact Top Bar shows it, ahead of
 * « Fiche » and « Activité », which go under « … »; on the wide bar, its button first. Taken back when the screen goes,
 * or with `null`. The latest `run` is called, so the action is offered again only when its label, icon or state change.
 * A screen that stays mounted under the one shown (a Stack's) offers it only while it is focused (`null` otherwise).
 */
export function useTopBarPrimary(action: TopBarPrimary | null) {
  const offer = useContext(OfferPrimary);
  const key = useId();
  const run = useRef(action?.run);
  useLayoutEffect(() => {
    run.current = action?.run;
  });
  const offered = action !== null;
  const label = action?.label;
  const icon = action?.icon;
  const expanded = action?.expanded;
  useEffect(() => {
    if (!offered || label === undefined || icon === undefined) return;
    offer(key, { id: "page", rank: TOP_BAR_RANK.page, label, icon, expanded, run: () => run.current?.() });
    return () => offer(key, null);
  }, [offer, key, offered, label, icon, expanded]);
}

/**
 * The compact Top Bar's actions (#899): the one shown, an icon alone named by its words (Activité while an AI action
 * runs, named « Activité IA » and the step, its stop icon before it), then « … » (« Autres actions »), which opens the
 * system's action sheet on iOS, and on Android a menu under it, as Android's overflow menus open: the others, each with
 * its words. When the run ends after its stop icon was pressed, which then goes, VoiceOver's and TalkBack's focus moves
 * to « … », where Activité is again.
 */
export function CompactTopBarActions({ actions }: { actions: readonly TopBarAction[] }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const more = useRef<ComponentRef<typeof View>>(null);
  const [menuAt, setMenuAt] = useState<Anchor | null>(null);
  const { shown, menu } = arrangeTopBar(actions);
  const running = shown?.running ?? null;

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
      {shown ? <Control label={shown.label} accessibleName={running?.name} icon={shown.icon} iconOnly expanded={shown.expanded} onPress={shown.run} /> : null}
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
