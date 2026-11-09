import type { LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, View, useWindowDimensions, type AccessibilityActionEvent, type GestureResponderEvent, type PointerEvent } from "react-native";
import { useKeyCommand } from "../keyboard/key-commands";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText, CappedTextScale, ROW_MAX_SCALE } from "./AppText";
import { CountBadge } from "./CountBadge";
import { isSecondaryClick, usePointerHover } from "./pointer";

/** One of a row's actions, in its context menu and its accessibility actions. */
export type RowAction = { label: string; icon?: LucideIcon; onPress: () => void };

/** Where the menu opens: under the pointer, or under the finger of a long press (or under the button that opens it). */
export type Anchor = { x: number; y: number };

/** The menu's width, in rem. */
const MENU_REM = 16;
/** The row's accessibility actions are named by their place among `actions`. */
const actionName = (index: number) => `action-${index}`;
const actionIndex = (name: string) => Number(name.slice(actionName(0).length - 1));
/** The menu opens in whatever orientation the device is in (a tablet rotates freely). */
const ORIENTATIONS = ["portrait", "landscape"] as const;

/**
 * A row of a list that names an object (an Application, a Job Offer, a Free conversation; #700): pressed, it opens it;
 * highlighted under a pointer; a long press or a right click opens its context menu with `actions`, which VoiceOver and
 * TalkBack also find among the row's actions. The menu closes on a choice, Échap, « Fermer », a tap beside it, or
 * Android's back. Without `actions` (a Sidebar's menu), a link highlighted under the pointer, and no menu. `count`: a
 * compact badge at the row's end (Recherches d'offres' offers à traiter, #818, #939), « 99+ » over 99, its `label` said
 * after the row's to a screen reader with the exact number; none at 0. The label keeps two lines at most as a fallback.
 */
export function ObjectRow({
  label,
  icon: Icon,
  current = false,
  onPress,
  actions,
  count,
}: {
  label: string;
  icon?: LucideIcon;
  /** The row of the page shown (the Sidebar's). */
  current?: boolean;
  onPress: () => void;
  actions: readonly RowAction[];
  count?: { value: number; label: string } | undefined;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  const [menuAt, setMenuAt] = useState<Anchor | null>(null);
  const openMenu = ({ pageX, pageY }: { pageX: number; pageY: number }) => (actions.length ? setMenuAt({ x: pageX, y: pageY }) : undefined);

  return (
    <>
      <Pressable
        role="link"
        aria-label={count && count.value > 0 ? `${label}, ${count.label}` : label}
        aria-selected={current}
        onPress={onPress}
        onLongPress={(event: GestureResponderEvent) => openMenu(event.nativeEvent)}
        onPointerDown={(event: PointerEvent) => (isSecondaryClick(event) ? openMenu(event.nativeEvent) : undefined)}
        accessibilityActions={actions.map((action, index) => ({ name: actionName(index), label: action.label }))}
        onAccessibilityAction={({ nativeEvent }: AccessibilityActionEvent) => actions[actionIndex(nativeEvent.actionName)]?.onPress()}
        {...hoverProps}
        style={({ pressed }) => ({
          minHeight: TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space[3],
          paddingHorizontal: space[3],
          borderRadius: radius.md,
          backgroundColor: current || pressed || hovered || menuAt ? colors.hover : "transparent",
        })}
      >
        {Icon ? <Icon color={current ? colors.accent : colors.secondary} size={20} aria-hidden /> : null}
        <View style={{ flex: 1 }}>
          <CappedTextScale scale={ROW_MAX_SCALE}>
            <AppText weight={current ? "semiBold" : "regular"} lines={2}>
              {label}
            </AppText>
          </CappedTextScale>
        </View>
        {count && count.value > 0 ? <CountBadge count={count.value} /> : null}
      </Pressable>
      {menuAt ? <ContextMenu name={t("conversationFirst.actions", { title: label })} anchor={menuAt} actions={actions} onClose={() => setMenuAt(null)} /> : null}
    </>
  );
}

/**
 * A menu of actions over the page, its top left at `anchor`, kept inside the window: a row's context menu, or the
 * Top Bar's « … » on Android (#899). `name` is its accessible name.
 */
export function ContextMenu({ name, anchor, actions, onClose }: { name: string; anchor: Anchor; actions: readonly RowAction[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const window = useWindowDimensions();
  const [height, setHeight] = useState(0);
  useKeyCommand("closePane", onClose);
  const width = Math.min(MENU_REM * 16 * window.fontScale, window.width - 2 * space[4]);
  // Kept inside the window, as near the anchor as it fits.
  const left = Math.max(space[4], Math.min(anchor.x, window.width - width - space[4]));
  const top = Math.max(space[4], Math.min(anchor.y, window.height - height - space[4]));
  const choose = (action: RowAction) => {
    onClose();
    action.onPress();
  };

  return (
    <Modal transparent visible supportedOrientations={[...ORIENTATIONS]} onRequestClose={onClose}>
      {/* The scrim: a tap beside the menu closes it; « Fermer », in the menu, is the way for everyone. */}
      <Pressable accessible={false} onPress={onClose} style={{ flex: 1 }} />
      <View
        role="menu"
        aria-label={name}
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={{
          position: "absolute",
          left,
          top,
          width,
          padding: space[1],
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
        }}
      >
        {actions.map((action) => (
          <MenuItem key={action.label} role="menuitem" label={action.label} icon={action.icon} onPress={() => choose(action)} />
        ))}
        <View style={{ height: 1, marginVertical: space[1], backgroundColor: colors.border }} />
        <MenuItem role="button" label={t("conversationFirst.close")} onPress={onClose} />
      </View>
    </Modal>
  );
}

function MenuItem({ role, label, icon: Icon, onPress }: { role: "menuitem" | "button"; label: string; icon?: LucideIcon; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  return (
    <Pressable
      role={role}
      aria-label={label}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        backgroundColor: pressed || hovered ? colors.hover : "transparent",
      })}
    >
      {Icon ? <Icon color={colors.secondary} size={20} aria-hidden /> : null}
      <AppText>{label}</AppText>
    </Pressable>
  );
}
