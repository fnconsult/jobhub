import { offerBoxView, type OfferBoxFilter, type OfferBoxView } from "@jobhub/shared";
import { Funnel } from "lucide-react-native";
import { createContext, useContext, useEffect, useRef, useState, type ComponentRef, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, View } from "react-native";
import { useOfferBox } from "../api/reads";
import { useKeyCommand } from "../keyboard/key-commands";
import { useCompactTopBar, useFocusTopBarPrimary, useTopBarPrimary } from "../shell/top-bar";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/**
 * The Offer box's source chip and, on a phone, whether its header is open as a panel under the Top Bar (#899, as the
 * web's #898): shared by the box, in the thread, and its filter icon in the compact Top Bar.
 */
type FilterState = {
  filter: OfferBoxFilter;
  setFilter: Dispatch<SetStateAction<OfferBoxFilter>>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

const FilterContext = createContext<FilterState | null>(null);

/**
 * The Offer box's filter: the page's, under OfferBoxFilterArea, its own otherwise. `inTopBar`: its header is behind the
 * compact Top Bar's filter icon (a phone, the box in its page), and not in the box.
 */
export function useOfferBoxFilter(): { filter: OfferBoxFilter; setFilter: (filter: OfferBoxFilter) => void; inTopBar: boolean } {
  const shared = useContext(FilterContext);
  const [own, setOwn] = useState<OfferBoxFilter>("all");
  const compact = useCompactTopBar();
  return shared ? { filter: shared.filter, setFilter: shared.setFilter, inTopBar: compact } : { filter: own, setFilter: setOwn, inTopBar: false };
}

/**
 * Recherches d'offres' page around its conversation (`children`, the Offer box leading its thread): holds the box's
 * filter for the box and for the compact Top Bar, where, on a phone (#899, as the web's #898), the box's header goes
 * behind the filter icon (OfferBoxFilterPanel). With columns the box keeps its header.
 */
export function OfferBoxFilterArea({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const [open, setOpen] = useState(false);
  return (
    <FilterContext.Provider value={{ filter, setFilter, open, setOpen }}>
      <View style={{ flex: 1 }}>
        {children}
        <OfferBoxFilterPanel />
      </View>
    </FilterContext.Provider>
  );
}

/**
 * The compact Top Bar's filter icon and, opened by it, the box's header as a panel pinned under the bar, wherever the
 * thread is scrolled, over a scrim that dims the entries and the conversation's box and closes it when touched. The icon
 * is named by the count and the source (« Filtrer les offres à traiter : 2 à traiter, toutes les sources »), carries a
 * dot while a source is chosen, and looks pressed while the panel is open. The panel opens with the screen reader's
 * focus on the chip chosen; choosing a source filters the box and closes it, as Android's back and Échap do, the focus
 * back on the icon (or on « … », an AI action running in the icon's place). Nothing on a wider window.
 */
function OfferBoxFilterPanel() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const state = useContext(FilterContext)!;
  const compact = useCompactTopBar();
  const focusPrimary = useFocusTopBarPrimary();
  const box = useOfferBox();
  const view = box.data ? offerBoxView(box.data, state.filter) : null;
  const shown = compact && view !== null;
  const open = shown && state.open;
  const chosen = useRef<ComponentRef<typeof View>>(null);

  const source = state.filter === "all" ? t("offerBox.filterAll") : t("offerBox.filterSource", { source: t(`offerBox.sources.${state.filter}`) });
  useTopBarPrimary(
    view && compact
      ? {
          label: t("offerBox.filter"),
          accessibleName: t("offerBox.filterName", { count: view.toHandle, source }),
          badge: state.filter !== "all",
          icon: Funnel,
          expanded: state.open,
          run: () => state.setOpen((was) => !was),
        }
      : null,
  );

  const close = () => {
    state.setOpen(false);
    focusPrimary();
  };
  const choose = (filter: OfferBoxFilter) => {
    state.setFilter(filter);
    close();
  };
  // Échap on a hardware keyboard, Android's back: the panel closes, the focus back on the icon.
  useKeyCommand("closePane", open ? close : null);
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => subscription.remove();
  });
  // Opened, the focus on the chip chosen.
  useEffect(() => {
    if (open && chosen.current) AccessibilityInfo.sendAccessibilityEvent(chosen.current, "focus");
  }, [open]);
  // Back to a wider window, or the box gone: closed, so it does not open again by itself.
  const { setOpen } = state;
  useEffect(() => {
    if (!shown) setOpen(false);
  }, [shown, setOpen]);

  if (!open || !view) return null;
  return (
    <View testID="offer-box-filter-panel" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
      {/* The scrim: a touch closes the panel; the icon, a chip, Échap and Android's back are the ways for everyone. */}
      <Pressable accessible={false} testID="offer-box-scrim" onPress={close} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim }} />
      <View
        onAccessibilityEscape={close}
        style={{
          maxHeight: "100%",
          backgroundColor: colors.background,
          borderBottomLeftRadius: radius.card,
          borderBottomRightRadius: radius.card,
          borderWidth: 1,
          borderTopWidth: 0,
          borderColor: colors.border,
        }}
      >
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: space[3], paddingBottom: space[4] }}>
          <OfferBoxHeader view={view} filter={state.filter} onChoose={choose} chosenRef={chosen} />
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * The Offer box's header: « Offres à traiter », « N à traiter · k traitées », the progress, then the source chips
 * (« Toutes » first), each with how many of its entries are à traiter. In the box with columns, in the filter's panel
 * on a phone. `chosenRef`: the chip chosen, for the focus.
 */
export function OfferBoxHeader({
  view,
  filter,
  onChoose,
  chosenRef,
}: {
  view: OfferBoxView;
  filter: OfferBoxFilter;
  onChoose: (filter: OfferBoxFilter) => void;
  chosenRef?: Ref<ComponentRef<typeof View>>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const done = view.toHandle + view.treated === 0 ? 100 : Math.round((100 * view.treated) / (view.toHandle + view.treated));
  return (
    <View style={{ gap: space[2] }}>
      <AppText variant="h2" heading>
        {t("offerBox.title")}
      </AppText>
      <AppText tone="secondary">{`${view.toHandle} ${t("offerBox.toHandle")} · ${t("offerBox.treated", { count: view.treated })}`}</AppText>
      <View style={{ height: 6, borderRadius: radius.md, backgroundColor: colors.hover, overflow: "hidden" }}>
        <View style={{ height: 6, width: `${done}%`, backgroundColor: colors.success }} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }} aria-label={t("offerBox.chips")}>
        {view.chips.map(({ source, toHandle }) => (
          <Control
            key={source}
            ref={filter === source ? chosenRef : undefined}
            label={`${t(`offerBox.sources.${source}`)} ${toHandle}`}
            accessibleName={t("offerBox.chipCount", { source: t(`offerBox.sources.${source}`), count: toHandle })}
            look="secondary"
            selected={filter === source}
            onPress={() => onChoose(source)}
          />
        ))}
      </View>
    </View>
  );
}
