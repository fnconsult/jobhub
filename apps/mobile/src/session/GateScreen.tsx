import type { ReactNode } from "react";
import { ScrollView, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AboveKeyboard } from "../keyboard/above-keyboard";
import { INTER, radius, space, TARGET, type, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";

/** With the keyboard up, a tap on a button presses it rather than only closing the keyboard. */
export const TAPS_REACH_CONTROLS = "handled";

/**
 * A drag closes the keyboard, as in the shell's panes: iOS's number keyboard has no key that closes it, and on an iPad in
 * portrait at the largest text size a tap beside the code's field left it up, over « Me connecter avec ce code » (#705).
 */
export const KEYBOARD_CLOSES_ON_DRAG = "on-drag";

const CENTRED = { flexGrow: 1, justifyContent: "center", padding: space[4] } as const;

/**
 * A screen of its own, before the shell: the safe areas, a reading width, centred, and above the keyboard while it is up
 * (the shell's own keeps only the signed-in pages there), scrolling to what it covers.
 */
export function GateScreen({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <AboveKeyboard testID="gate-screen">
      <ScrollView
        testID="gate-scroll"
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ ...CENTRED, paddingTop: insets.top + space[4], paddingBottom: insets.bottom + space[4] }}
        keyboardShouldPersistTaps={TAPS_REACH_CONTROLS}
        keyboardDismissMode={KEYBOARD_CLOSES_ON_DRAG}
      >
        <View style={{ width: "100%", maxWidth: 28 * 16, alignSelf: "center", gap: space[4] }}>
          <AppText variant="h1">{title}</AppText>
          {children}
        </View>
      </ScrollView>
    </AboveKeyboard>
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
