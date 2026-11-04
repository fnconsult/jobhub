import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";
import { ThemeProvider } from "./theme/theme";

/** What every screen of the app sits in: the safe areas, the translations, the system's theme. */
export function AppProviders({ i18n, initialMetrics, children }: { i18n: i18n; initialMetrics?: Metrics | null; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics ?? null}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>{children}</ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
