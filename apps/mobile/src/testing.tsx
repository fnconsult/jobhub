import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { act, render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Dimensions } from "react-native";
import { AppProviders } from "./app-providers";
import { fakeHardwareKeyboard } from "./keyboard/fake-hardware-keyboard";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

let keyboard = fakeHardwareKeyboard();

/**
 * The hardware keyboard of the last `renderInApp`: `panel()` is what the ⌘ panel lists (Ctrl on Android), `press("⌘N")`
 * presses a chord.
 */
export const hardwareKeyboard = {
  panel: () => keyboard.panel(),
  press: (chord: string) => act(() => keyboard.press(chord)),
};

/** Renders `ui` as the app does, in French (the default language), a hardware keyboard plugged in. */
export function renderInApp(ui: ReactElement) {
  keyboard = fakeHardwareKeyboard();
  return render(
    <AppProviders i18n={createI18n(DEFAULT_LOCALE)} initialMetrics={METRICS} keyboard={keyboard.keyboard}>
      {ui}
    </AppProviders>,
  );
}

/** Sets the window's size in points, and the system's text scale, as a rotation, Split View or Dynamic Type would. */
export function setWindow({ width, height, fontScale = 1 }: { width: number; height: number; fontScale?: number }) {
  const window = { width, height, scale: 2, fontScale };
  Dimensions.set({ window, screen: window });
}
