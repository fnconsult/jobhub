import type { ReactNode } from "react";
import { KeyboardAvoidingView } from "react-native";

/**
 * The content laid out again in the room left above the keyboard, on both systems: Android draws the app edge to edge
 * (Android 15, React Native's default), under the keyboard, which then no longer resizes the window; on the Android
 * tablet the conversation's box and its « Envoyer » stayed under the keyboard while a message was typed (#705).
 */
const BEHAVIOR = "padding";

/**
 * What stays above the system's keyboard while it is up. The signed-in app's pages (src/app/_layout.tsx) and the screens
 * before them, sign-in and its second step (GateScreen), so a field and the button after it are never under the keyboard.
 */
export function AboveKeyboard({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <KeyboardAvoidingView testID={testID} style={{ flex: 1 }} behavior={BEHAVIOR}>
      {children}
    </KeyboardAvoidingView>
  );
}
