import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";
import { ApiProvider } from "./api/api";
import { ApiProvider as WebApiProvider } from "./api/api-context";
import type { Api } from "./api/web-api";
import {
  KeyCommandsProvider,
  type HardwareKeyboard,
} from "./keyboard/key-commands";
import {
  ReadCacheProvider,
  type DeviceStorage,
  type Network,
} from "./offline/read-cache";
import { ThemeProvider } from "./theme/theme";

/**
 * What every screen of the app sits in: the safe areas, the translations, the system's theme, the read cache on `device`,
 * the hardware keyboard's shortcuts (`keyboard`: the native module's unless a test gives its own), the calls to the API
 * (the platform's, under the 426 gate, with the session's cookie, `sessionCookie`, AppSession.cookie; and the web app's
 * `api` the Coach calls, when given).
 */
export function AppProviders({
  i18n,
  initialMetrics,
  keyboard,
  device,
  api,
  sessionCookie,
  children,
}: {
  i18n: i18n;
  initialMetrics?: Metrics | null;
  keyboard?: HardwareKeyboard;
  device: { storage: DeviceStorage; network: Network };
  api?: Api;
  sessionCookie?: () => Promise<string>;
  children: ReactNode;
}) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics ?? null}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ReadCacheProvider device={device}>
            <KeyCommandsProvider keyboard={keyboard}>
              <ApiProvider cookie={sessionCookie}>
                {api ? (
                  <WebApiProvider api={api}>{children}</WebApiProvider>
                ) : (
                  children
                )}
              </ApiProvider>
            </KeyCommandsProvider>
          </ReadCacheProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
