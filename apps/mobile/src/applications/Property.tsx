import type { ReactNode } from "react";
import { View } from "react-native";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";

/** One property of an object's card or Section: its label, then its value. */
export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[1] }}>
      <AppText variant="meta" tone="secondary">
        {label}
      </AppText>
      <View style={{ alignItems: "flex-start", gap: space[1] }}>{children}</View>
    </View>
  );
}
