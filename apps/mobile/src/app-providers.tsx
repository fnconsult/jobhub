import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";
import { KeyCommandsProvider, type HardwareKeyboard } from "./keyboard/key-commands";
import { ThemeProvider } from "./theme/theme";

/**
 * What every screen of the app sits in: the safe areas, the translations, the system's theme, the hardware keyboard's
 * shortcuts (`keyboard`: the native module's unless a test gives its own).
 */
export function AppProviders({
  i18n,
  initialMetrics,
  keyboard,
  children,
}: {
  i18n: i18n;
  initialMetrics?: Metrics | null;
  keyboard?: HardwareKeyboard;
  children: ReactNode;
}) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics ?? null}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <KeyCommandsProvider keyboard={keyboard}>{children}</KeyCommandsProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
