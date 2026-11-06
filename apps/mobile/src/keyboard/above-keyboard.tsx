import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

/** iOS lays the content out again above the keyboard; Android resizes the window itself. */
const BEHAVIOR = Platform.OS === "ios" ? "padding" : undefined;

/**
 * What stays above the system's keyboard while it is up: on iOS the content is laid out again in the room left above it;
 * Android resizes the window itself. The signed-in app's pages (src/app/_layout.tsx) and the screens before them, sign-in
 * and its second step (GateScreen), so a field and the button after it are never under the keyboard.
 */
export function AboveKeyboard({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <KeyboardAvoidingView testID={testID} style={{ flex: 1 }} behavior={BEHAVIOR}>
      {children}
    </KeyboardAvoidingView>
  );
}
