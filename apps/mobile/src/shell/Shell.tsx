import { Activity, ChevronLeft, Menu, PanelLeftClose, PanelRight, SquarePen, X } from "lucide-react-native";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Pressable, ScrollView, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OfflineBanner } from "../offline/OfflineBanner";
import { space, radius, TARGET, useTheme } from "../theme/theme";
import { useKeyCommand } from "../keyboard/key-commands";
import { AppText, BAR_MAX_SCALE, CappedTextScale } from "../ui/AppText";
import { Control } from "../ui/Control";
import { usePointerHover } from "../ui/pointer";
import { disposition, type Disposition, type PaneKind, type ShownPane } from "./disposition";
import { CompactTopBarActions, TOP_BAR_RANK, TopBarPrimaryProvider, useTopBarPrimaryOffers, type TopBarAction } from "./top-bar";

/**
 * The page the shell shows: its address (a new one closes what the last page had open), its title, its column, and
 * `up`, the page its title leads back to (an Application's, to Mes candidatures) and what that link says, when it has one.
 */
export type ShellPage = { key: string; title: string; pane: PaneKind | null; up?: { path: string; label: string } };

/**
 * What the Work Pane shows: one item at a time (ADR-0070), a Section, a Result, a Help Article or a form. `fill`: the
 * content takes the pane's whole height and scrolls itself (a web page), rather than scrolling in the pane.
 */
export type WorkPaneItem = { title: string; content: ReactNode; fill?: boolean };

const WorkPaneContext = createContext<{ open: (item: WorkPaneItem) => void; close: () => void }>({ open: () => {}, close: () => {} });

/** Opens an item in the page's Work Pane, in place of the one it shows, or closes it (`close`, as its « Fermer » does). */
export const useWorkPane = () => useContext(WorkPaneContext);

type State = {
  pageKey: string;
  drawerOpen: boolean;
  /** The person's: the Sidebar not hidden, from 64rem. */
  sidebarWanted: boolean;
  /** The page's column open or closed; null until the person uses « Fiche » or « Activité », and then as the window has it. */
  paneOpen: boolean | null;
  workPane: WorkPaneItem | null;
};

/**
 * The app's shell (ADR-0076, variant A of `prototype/mobile-shell`): the Top Bar, the page (its conversation), the
 * Sidebar as a column or a drawer, « Hors ligne » under the Top Bar while there is no network, and the page's panes (its Fiche, or Activité alone, and the Work Pane) as columns
 * beside the conversation or full page over it, as `disposition` decides for the window, again on every change of it.
 *
 * On a wide window an object's Fiche starts open, as on the web; the Top Bar's « Fiche » or « Activité » alone opens
 * and closes the column, and brings the Fiche back when the Work Pane has taken its place. Every full page closes by
 * its « Fermer » (ADR-0009), Android's back too, and leaves the page behind it out of reach while it covers it.
 *
 * Where the panes open full page (below 64rem), the Top Bar is compact (#899, ADR-0101): Menu, the title, one action as
 * an icon and « … » with the others (CompactTopBarActions); with columns, each action is a button with its words.
 */
export function Shell({
  page,
  paneContent,
  sidebar,
  onNewConversation,
  onUp,
  actions = [],
  aiRun = null,
  children,
}: {
  page: ShellPage;
  /** Goes to the page `page.up` names, from its title in the Top Bar. */
  onUp?: (path: string) => void;
  paneContent: ReactNode;
  /** The page's own actions in the Top Bar, buttons before « Fiche » or « Activité » on the wide bar (a conversation's « Effacer »). */
  actions?: readonly TopBarAction[];
  /** The AI action under way on the page, if any: its words (the step) and its stop. Activité takes the compact bar's icon meanwhile. */
  aiRun?: { words: string; stopLabel: string; stop: () => void } | null;
  /** The Sidebar's menus; `closeDrawer` for a link that navigates. */
  sidebar: (closeDrawer: () => void) => ReactNode;
  onNewConversation: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [state, setState] = useState<State>({ pageKey: page.key, drawerOpen: false, sidebarWanted: true, paneOpen: null, workPane: null });
  // The screen's own main action (useTopBarPrimary), ahead of the others.
  const { primary, offer } = useTopBarPrimaryOffers();
  // A new page: its own panes, closed, and the drawer that led there closes too.
  if (state.pageKey !== page.key) setState({ ...state, pageKey: page.key, drawerOpen: false, paneOpen: null, workPane: null });

  const wide = disposition(window, { sidebar: state.sidebarWanted, pane: null, workPane: false }).panes === "columns";
  const paneOpen = page.pane !== null && (state.paneOpen ?? (wide && page.pane === "fiche"));
  const layout = disposition(window, { sidebar: state.sidebarWanted, pane: paneOpen ? page.pane : null, workPane: state.workPane !== null });
  const fullPages = layout.panes === "fullPage" ? layout.shown : [];
  const drawerShown = layout.sidebar === "drawer" && state.drawerOpen;
  const pageCovered = fullPages.length > 0 || drawerShown;

  const update = (change: Partial<State>) => setState((current) => ({ ...current, ...change }));
  const closeDrawer = () => update({ drawerOpen: false });
  const close = (pane: ShownPane) => update(pane === "workPane" ? { workPane: null } : { paneOpen: false });
  const givenWay = paneOpen && !layout.shown.includes(page.pane ?? "fiche");
  const togglePane = () => update(givenWay ? { workPane: null } : { paneOpen: !paneOpen });
  const onMenu = () =>
    layout.sidebar === "column" ? update({ sidebarWanted: false }) : layout.sidebar === "hidden" ? update({ sidebarWanted: true }) : update({ drawerOpen: true });

  const top = fullPages.at(-1);
  useBackHandler(drawerShown ? closeDrawer : top ? () => close(top) : null);

  // The hardware keyboard (#700): the Top Bar's buttons, the drawer's and the panes' « Fermer » by their shortcuts.
  const workPaneColumn = layout.panes === "columns" && layout.shown.includes("workPane");
  useKeyCommand("newConversation", onNewConversation);
  useKeyCommand("sidebar", layout.sidebar === "drawer" ? () => update({ drawerOpen: !state.drawerOpen }) : onMenu);
  useKeyCommand("fiche", page.pane === "fiche" ? togglePane : null);
  useKeyCommand("activite", page.pane === "activite" ? togglePane : null);
  useKeyCommand("closeWorkPane", state.workPane ? () => close("workPane") : null);
  // Échap closes what is on top: the drawer, a full page, the Work Pane's column; the Fiche's column stays the Top Bar's.
  useKeyCommand("closePane", drawerShown ? closeDrawer : top ? () => close(top) : workPaneColumn ? () => close("workPane") : null);

  const workPane = useMemo(
    () => ({ open: (item: WorkPaneItem) => setState((current) => ({ ...current, workPane: item })), close: () => setState((current) => ({ ...current, workPane: null })) }),
    [],
  );
  const paneTitle = (pane: ShownPane) => (pane === "workPane" ? (state.workPane?.title ?? "") : t(pane === "fiche" ? "fiche.label" : "fiche.activity"));
  const paneBody = (pane: ShownPane) => (pane === "workPane" ? state.workPane?.content : paneContent);
  const fills = (pane: ShownPane) => pane === "workPane" && state.workPane?.fill === true;

  const paneAction: TopBarAction | null = page.pane
    ? {
        id: page.pane,
        rank: page.pane === "fiche" ? TOP_BAR_RANK.fiche : TOP_BAR_RANK.activity,
        label: t(page.pane === "fiche" ? "fiche.label" : "fiche.activity"),
        icon: page.pane === "fiche" ? PanelRight : Activity,
        look: "secondary",
        expanded: paneOpen && !givenWay,
        run: togglePane,
        running:
          page.pane === "activite" && aiRun ? { name: `${t("aiActivity.label")} · ${aiRun.words}`, stop: { label: aiRun.stopLabel, run: aiRun.stop } } : null,
      }
    : null;
  const newConversation: TopBarAction = {
    id: "newConversation",
    rank: TOP_BAR_RANK.newConversation,
    label: t("conversationFirst.newConversation"),
    icon: SquarePen,
    iconOnly: true,
    run: onNewConversation,
  };
  // The wide bar's order: the screen's action, the page's (« Effacer »), « Fiche » or « Activité », the pencil.
  const topBarActions = [primary, ...actions, paneAction, newConversation].filter((action): action is TopBarAction => action !== null);
  const compact = layout.panes === "fullPage";

  return (
    <WorkPaneContext.Provider value={workPane}>
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
        {layout.sidebar === "column" ? (
          <View aria-hidden={pageCovered} style={{ width: layout.size.sidebar, backgroundColor: colors.nav }}>
            <ScrollView contentContainerStyle={{ padding: space[3] }}>{sidebar(closeDrawer)}</ScrollView>
          </View>
        ) : null}
        <View aria-hidden={pageCovered} style={{ flex: 1 }}>
          <TopBar
            title={page.title}
            up={page.up && onUp ? { label: page.up.label, go: () => onUp(page.up!.path) } : null}
            compact={compact}
            menu={
              <Control
                label={t(layout.sidebar === "column" ? "sidebar.collapse" : "sidebar.menu")}
                icon={layout.sidebar === "column" ? PanelLeftClose : Menu}
                iconOnly={compact}
                onPress={onMenu}
              />
            }
            end={
              compact ? (
                <CompactTopBarActions actions={topBarActions} />
              ) : (
                topBarActions.map((action) => (
                  <Control
                    key={action.id}
                    label={action.wideLabel ?? action.label}
                    icon={action.icon}
                    iconOnly={action.iconOnly}
                    look={action.look}
                    expanded={action.expanded}
                    onPress={action.run}
                  />
                ))
              )
            }
          />
          <OfflineBanner />
          <View style={{ flex: 1, flexDirection: "row", paddingBottom: insets.bottom }}>
            <View style={{ flex: 1, marginHorizontal: layout.size.gutter }}>
              <TopBarPrimaryProvider value={offer}>{children}</TopBarPrimaryProvider>
            </View>
            {layout.panes === "columns"
              ? // The Work Pane beside the conversation, the Fiche after it (as on the web).
                [...layout.shown].reverse().map((pane) => (
                  <Column key={pane} layout={layout} pane={pane} title={paneTitle(pane)} fill={fills(pane)} onClose={pane === "workPane" ? () => close(pane) : null}>
                    {paneBody(pane)}
                  </Column>
                ))
              : null}
          </View>
        </View>
        {fullPages.map((pane) => (
          <FullPage key={pane} title={paneTitle(pane)} covered={pane !== top} fill={fills(pane)} onClose={() => close(pane)}>
            {paneBody(pane)}
          </FullPage>
        ))}
        {drawerShown ? (
          <Drawer width={Math.min(window.width * 0.86, layout.size.sidebar + 2 * layout.size.gutter)} onClose={closeDrawer}>
            {sidebar(closeDrawer)}
          </Drawer>
        ) : null}
      </View>
    </WorkPaneContext.Provider>
  );
}

/** The room a page's title needs beside the Top Bar's buttons, in rem (16 pt times the system text scale). */
const TITLE_MIN_REM = 10;

/**
 * The Top Bar: the menu, the page's title (with `up`, a link back to the page above it, an arrow before it, as on iOS),
 * its buttons. Where the buttons, their words beside their icons, leave the title less than `TITLE_MIN_REM` (a phone, a
 * folded foldable, a larger system text), the title goes on its own line under them, the whole width, rather than break
 * inside its words (« Mes candida / tures ») or take one letter a line and most of the screen. Buttons that do not fit
 * on one line beside the menu (« Effacer », « Activité » and the pencil, at the largest text size) wrap to the next. Its
 * words grow with the system's text size up to twice their size (`BAR_MAX_SCALE`): the page keeps its room under it.
 * `compact` (#899): the menu and the actions are icons, and the title holds one line, all of it at a large text size.
 */
function TopBar(props: TopBarProps) {
  return (
    <CappedTextScale scale={BAR_MAX_SCALE}>
      <TopBarContent {...props} />
    </CappedTextScale>
  );
}

type TopBarProps = { title: string; up: { label: string; go: () => void } | null; compact: boolean; menu: ReactNode; end: ReactNode };

function TopBarContent({ title, up, compact, menu, end }: TopBarProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const { hovered, hoverProps } = usePointerHover();
  const [widths, setWidths] = useState({ bar: 0, menu: 0, end: 0 });
  const measure = (part: keyof typeof widths) => (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setWidths((current) => (current[part] === width ? current : { ...current, [part]: width }));
  };
  const [onBar, onMenu, onEnd] = (["bar", "menu", "end"] as const).map(measure);
  // The bar's padding on each side, and a gap on each side of the title.
  const room = widths.bar - 4 * space[2] - widths.menu - widths.end;
  const ownLine = widths.bar > 0 && room < TITLE_MIN_REM * 16 * Math.min(fontScale, BAR_MAX_SCALE);
  const beside = ownLine ? null : { flex: 1 };
  const text = (
    <AppText variant="lead" weight="semiBold" lines={compact ? 1 : 2}>
      {title}
    </AppText>
  );
  const heading = up ? (
    <Pressable
      role="link"
      aria-label={title}
      accessibilityHint={up.label}
      onPress={up.go}
      {...hoverProps}
      style={({ pressed }) => ({
        ...beside,
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[1],
        borderRadius: radius.control,
        backgroundColor: pressed || hovered ? colors.hover : "transparent",
      })}
    >
      <ChevronLeft color={colors.accent} size={22} aria-hidden />
      <View style={{ flex: 1 }}>{text}</View>
    </Pressable>
  ) : (
    <View style={beside}>{text}</View>
  );
  return (
    <View role="toolbar" testID="top-bar" onLayout={onBar} style={{ gap: space[1], paddingHorizontal: space[2], paddingVertical: space[1] }}>
      <View testID="top-bar-row" style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <View testID="top-bar-menu" onLayout={onMenu}>
          {menu}
        </View>
        {ownLine ? <View style={{ flex: 1 }} /> : heading}
        <View
          testID="top-bar-end"
          onLayout={onEnd}
          style={{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: space[2] }}
        >
          {end}
        </View>
      </View>
      {ownLine ? heading : null}
    </View>
  );
}

function PaneHeader({ title, onClose }: { title: string; onClose: (() => void) | null }) {
  const { t } = useTranslation();
  // A bar, as the Top Bar: its words grow up to twice their size, the pane's content keeping its room under it.
  return (
    <CappedTextScale scale={BAR_MAX_SCALE}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: space[4], paddingRight: space[2], paddingVertical: space[1] }}>
        <View style={{ flex: 1 }}>
          <AppText variant="h3" lines={2}>
            {title}
          </AppText>
        </View>
        {onClose ? <Control label={t("conversationFirst.close")} icon={X} onPress={onClose} /> : null}
      </View>
    </CappedTextScale>
  );
}

/** A drag in a pane closes the keyboard (the ScrollView's own setting, not words). */
const KEYBOARD_CLOSES_ON_DRAG = "on-drag";

/** A pane's content: scrolling in the pane, or filling it (`fill`) when it scrolls itself. */
function PaneBody({ fill, children }: { fill: boolean; children: ReactNode }) {
  if (fill) return <View style={{ flex: 1, padding: space[4], paddingTop: 0 }}>{children}</View>;
  // Its id, for the Maestro flows to scroll the pane until an element starts within it (apps/mobile/maestro/subflows).
  // A drag closes the keyboard: on an iPhone the keyboard may cover the field typed in and its label, and the number
  // keyboards have no key that closes them.
  return (
    <ScrollView testID="pane-body" keyboardDismissMode={KEYBOARD_CLOSES_ON_DRAG} contentContainerStyle={{ padding: space[4], paddingTop: 0 }}>
      {children}
    </ScrollView>
  );
}

/** A pane beside the conversation, from 64rem. */
function Column({
  layout,
  pane,
  title,
  fill,
  onClose,
  children,
}: {
  layout: Disposition;
  pane: ShownPane;
  title: string;
  fill: boolean;
  onClose: (() => void) | null;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: pane === "workPane" ? layout.size.workPane : layout.size.fiche,
        marginRight: layout.size.gutter,
        marginBottom: layout.size.gutter,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
      }}
    >
      <PaneHeader title={title} onClose={onClose} />
      <PaneBody fill={fill}>{children}</PaneBody>
    </View>
  );
}

/** A pane over the page and its Top Bar, below 64rem: its title and « Fermer » (ADR-0070). */
function FullPage({ title, covered, fill, onClose, children }: { title: string; covered: boolean; fill: boolean; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      aria-modal={!covered}
      aria-hidden={covered}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <PaneHeader title={title} onClose={onClose} />
      <PaneBody fill={fill}>{children}</PaneBody>
    </View>
  );
}

/** The Sidebar over the page, below 64rem or wherever the conversation would keep less than 28rem beside it. */
function Drawer({ width, onClose, children }: { width: number; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row" }}>
      <View aria-modal style={{ width, backgroundColor: colors.nav, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left }}>
        <View style={{ alignItems: "flex-start", padding: space[2] }}>
          <Control label={t("sidebar.close")} icon={X} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space[3], paddingTop: 0 }}>{children}</ScrollView>
      </View>
      {/* The scrim: a tap closes the drawer too, for sighted people; « Fermer le menu » is the way for everyone. */}
      <Pressable accessible={false} onPress={onClose} style={{ flex: 1, backgroundColor: colors.scrim }} />
    </View>
  );
}

/** Android's back button closes what covers the page, while something does. */
function useBackHandler(onBack: (() => void) | null) {
  useEffect(() => {
    if (!onBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);
}
