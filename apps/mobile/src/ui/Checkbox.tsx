import { Square, SquareCheck } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "./AppText";

/** A box the person ticks, its label beside it (the label is its accessible name), 44 pt high at least; `hint` below. */
export function Checkbox({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <Pressable
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onPress={() => onChange(!checked)}
        style={{ minHeight: TARGET, flexDirection: "row", alignItems: "center", gap: space[3] }}
      >
        {checked ? <SquareCheck color={colors.accent} /> : <Square color={colors.text} />}
        <View style={{ flex: 1 }}>
          <AppText>{label}</AppText>
        </View>
      </Pressable>
      {hint ? (
        <AppText variant="meta" tone="secondary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
