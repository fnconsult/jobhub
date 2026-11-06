import { Circle, CircleDot } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "./AppText";
import { usePointerHover } from "./pointer";

/**
 * One choice among a few, each a radio button 44 pt high at least, its label beside it (its accessible name), the one
 * chosen checked; the group named by `label`. Choosing one calls `onChange`; `disabled` while it cannot be changed.
 */
export function RadioList<T extends string>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <View role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <Radio key={option.value} label={option.label} checked={option.value === value} disabled={disabled} onPress={() => onChange(option.value)} />
      ))}
    </View>
  );
}

function Radio({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  const Icon = checked ? CircleDot : Circle;
  return (
    <Pressable
      role="radio"
      aria-label={label}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[2],
        backgroundColor: pressed || hovered ? colors.hover : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Icon color={checked ? colors.accent : colors.text} size={22} aria-hidden />
      <View style={{ flex: 1 }}>
        <AppText>{label}</AppText>
      </View>
    </Pressable>
  );
}
