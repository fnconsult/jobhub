import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { KeyboardAvoidingView, View, type LayoutChangeEvent } from "react-native";

/**
 * The content laid out again in the room left above the keyboard, on both systems: Android draws the app edge to edge
 * (Android 15, React Native's default), under the keyboard, which then no longer resizes the window; on the Android
 * tablet the conversation's box and its « Envoyer » stayed under the keyboard while a message was typed (#705).
 */
const BEHAVIOR = "padding";

/**
 * What stays above the system's keyboard while it is up. The signed-in app's pages (src/app/_layout.tsx) and the screens
 * before them, sign-in and its second step (GateScreen), so a field and the button after it are never under the keyboard.
 *
 * React Native's KeyboardAvoidingView reckons the keyboard's overlap from its own frame, relative to what holds it, and
 * the keyboard's top, in the window: the pages sit under the Top Bar, and it left the keyboard as much of them as the
 * bar is high (an iPhone SE's conversation box went half under the keyboard). Its offset is where it sits in the window.
 */
export function AboveKeyboard({ testID, children }: { testID?: string; children: ReactNode }) {
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [offset, setOffset] = useState(0);
  const placed = (event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout;
    frame.current?.measureInWindow((_x, top) => setOffset((current) => (current === top - y ? current : top - y)));
  };
  return (
    <View ref={frame} style={{ flex: 1 }}>
      <KeyboardAvoidingView testID={testID} style={{ flex: 1 }} behavior={BEHAVIOR} keyboardVerticalOffset={offset} onLayout={placed}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
