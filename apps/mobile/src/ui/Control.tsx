import type { LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "./AppText";
import { usePointerHover } from "./pointer";

type Look = "primary" | "secondary" | "quiet";

/**
 * A button: 44 pt at least each way (ADR-0009), its label in words beside its Lucide icon. `label` alone, with `icon`,
 * draws the icon only, for the few functions ADR-0009 lets go without words; the label is then its accessible name.
 * Highlighted under a pointer as when pressed (#700).
 */
export function Control({
  label,
  icon: Icon,
  iconOnly = false,
  look = "quiet",
  expanded,
  selected,
  onPress,
}: {
  label: string;
  icon?: LucideIcon;
  iconOnly?: boolean;
  look?: Look;
  expanded?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  const foreground = look === "primary" ? colors.onAccent : selected ? colors.accent : colors.text;
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-selected={selected}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        minWidth: TARGET,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: iconOnly ? "center" : "flex-start",
        gap: space[2],
        paddingHorizontal: iconOnly ? 0 : space[3],
        borderRadius: radius.control,
        borderWidth: look === "secondary" ? 1 : 0,
        borderColor: colors.borderStrong,
        backgroundColor: look === "primary" ? (pressed || hovered ? colors.accentHover : colors.accent) : pressed || hovered || selected ? colors.hover : "transparent",
      })}
    >
      {Icon ? <Icon color={foreground} size={22} aria-hidden /> : null}
      {iconOnly ? null : (
        <View>
          <AppText weight="semiBold" tone={look === "primary" ? "onAccent" : selected ? "accent" : "text"}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}
