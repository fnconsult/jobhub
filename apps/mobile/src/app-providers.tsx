import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";
import { ApiProvider } from "./api/api";
import { KeyCommandsProvider, type HardwareKeyboard } from "./keyboard/key-commands";
import { ReadCacheProvider, type DeviceStorage, type Network } from "./offline/read-cache";
import type { AppSession } from "./session/app-session";
import { ThemeProvider } from "./theme/theme";

/**
 * What every screen of the app sits in: the safe areas, the translations, the system's theme, the read cache on `device`,
 * the hardware keyboard's shortcuts (`keyboard`: the native module's unless a test gives its own), the calls to the API,
 * which carry `session`'s cookie and go through `fetch` (the app's, `appFetch`, whose answer streams; without it, the
 * global fetch).
 */
export function AppProviders({
  i18n,
  initialMetrics,
  keyboard,
  device,
  session,
  fetch,
  children,
}: {
  i18n: i18n;
  initialMetrics?: Metrics | null;
  keyboard?: HardwareKeyboard;
  device: { storage: DeviceStorage; network: Network };
  /** The app's session (src/session/instance.ts), whose cookie the calls to the API carry. */
  session?: Pick<AppSession, "cookie">;
  /** The fetch the calls to the API go through (src/session/instance.ts in the app); none, the global fetch. */
  fetch?: typeof globalThis.fetch;
  children: ReactNode;
}) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics ?? null}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ReadCacheProvider device={device}>
            <KeyCommandsProvider keyboard={keyboard}>
              <ApiProvider session={session} {...(fetch ? { fetch } : {})}>{children}</ApiProvider>
            </KeyCommandsProvider>
          </ReadCacheProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
