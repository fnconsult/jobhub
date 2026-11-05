import type { ReactNode } from "react";
import { ScrollView, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { INTER, radius, space, TARGET, type, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";

/** With the keyboard up, a tap on a button presses it rather than only closing the keyboard. */
export const TAPS_REACH_CONTROLS = "handled";

const CENTRED = { flexGrow: 1, justifyContent: "center", padding: space[4] } as const;

/** A screen of its own, before the shell: the safe areas, a reading width, centred. */
export function GateScreen({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ ...CENTRED, paddingTop: insets.top + space[4], paddingBottom: insets.bottom + space[4] }}
      keyboardShouldPersistTaps={TAPS_REACH_CONTROLS}
    >
      <View style={{ width: "100%", maxWidth: 28 * 16, alignSelf: "center", gap: space[4] }}>
        <AppText variant="h1">{title}</AppText>
        {children}
      </View>
    </ScrollView>
  );
}

/** What went wrong, read out as it appears. */
export function GateError({ message }: { message: string }) {
  return (
    <View role="alert">
      <AppText tone="danger">{message}</AppText>
    </View>
  );
}

/** A field of its own, labelled above, at the size of a button (ADR-0009). */
export function GateField({ label, ...input }: { label: string } & Omit<TextInputProps, "style" | "aria-label">) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <AppText weight="semiBold">{label}</AppText>
      <TextInput
        aria-label={label}
        {...input}
        style={{
          minHeight: TARGET,
          paddingHorizontal: space[3],
          borderWidth: 1,
          borderColor: colors.borderStrong,
          borderRadius: radius.control,
          fontFamily: INTER.regular,
          fontSize: type.fontSize.body,
          color: colors.text,
        }}
      />
    </View>
  );
}
