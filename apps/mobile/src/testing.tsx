import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Dimensions } from "react-native";
import { AppProviders } from "./app-providers";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** Renders `ui` as the app does, in French (the default language). */
export function renderInApp(ui: ReactElement) {
  return render(
    <AppProviders i18n={createI18n(DEFAULT_LOCALE)} initialMetrics={METRICS}>
      {ui}
    </AppProviders>,
  );
}

/** Sets the window's size in points, and the system's text scale, as a rotation, Split View or Dynamic Type would. */
export function setWindow({ width, height, fontScale = 1 }: { width: number; height: number; fontScale?: number }) {
  const window = { width, height, scale: 2, fontScale };
  Dimensions.set({ window, screen: window });
}
