import type { LucideIcon } from "lucide-react-native";
import type { ComponentRef, Ref } from "react";
import { Pressable, View } from "react-native";
import { space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "./AppText";
import { usePointerHover } from "./pointer";

type Look = "primary" | "secondary" | "quiet";

/**
 * Rounded as a 44 pt button's ends, a pill on one line: the Design System's pill radius (radius.control, 999) made a
 * circle of a button whose words wrap at a large text size, its words' ends outside it, white on the page's white
 * (« Me connecter avec ce code » on an iPhone SE at iOS's largest, #705).
 */
export const PILL = TARGET / 2;

/**
 * A button: 44 pt at least each way (ADR-0009), its label in words beside its Lucide icon. `label` alone, with `icon`,
 * draws the icon only, for the few functions ADR-0009 lets go without words; the label is then its accessible name.
 * Highlighted under a pointer as when pressed (#700). Never wider than what holds it: its words wrap, at a large text
 * size, rather than run past its edge.
 */
export function Control({
  label,
  accessibleName,
  icon: Icon,
  iconOnly = false,
  look = "quiet",
  expanded,
  selected,
  disabled = false,
  onPress,
  testID,
  ref,
}: {
  label: string;
  /** Its accessible name when the label alone does not say which, among several alike: the label otherwise. */
  accessibleName?: string;
  icon?: LucideIcon;
  iconOnly?: boolean;
  look?: Look;
  expanded?: boolean;
  selected?: boolean;
  /** Not usable for now (« Hors ligne »): its caller says why beside it. */
  disabled?: boolean;
  onPress: () => void;
  /** Its id for the e2e flows, where its label is not the only one of its name on screen (apps/mobile/maestro). */
  testID?: string;
  /** The button itself: to measure it, or move VoiceOver's and TalkBack's focus to it. */
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  const foreground = look === "primary" ? colors.onAccent : selected ? colors.accent : colors.text;
  return (
    <Pressable
      ref={ref}
      role="button"
      aria-label={accessibleName ?? label}
      aria-expanded={expanded}
      aria-selected={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        minWidth: TARGET,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: iconOnly ? "center" : "flex-start",
        gap: space[2],
        paddingHorizontal: iconOnly ? 0 : space[3],
        borderRadius: PILL,
        borderWidth: look === "secondary" ? 1 : 0,
        borderColor: colors.borderStrong,
        backgroundColor: look === "primary" ? (pressed || hovered ? colors.accentHover : colors.accent) : pressed || hovered || selected ? colors.hover : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {Icon ? <Icon color={foreground} size={22} aria-hidden /> : null}
      {iconOnly ? null : (
        <View style={{ flexShrink: 1 }}>
          <AppText weight="semiBold" tone={look === "primary" ? "onAccent" : selected ? "accent" : "text"}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}
