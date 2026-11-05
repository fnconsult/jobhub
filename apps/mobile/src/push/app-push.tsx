import { isSupportedLocale, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { useRouter } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { useApi } from "../api/api";
import { deviceStorage } from "../offline/device";
import { deviceNotifications, onNotificationTapped, onTokenRotated, openDeviceSettings } from "./device";
import { createPushDevice } from "./push-device";
import { PushDeviceProvider, PushProvider, usePushDevice, type PushSystem } from "./PushNotifications";

const SYSTEM: PushSystem = { onTapped: onNotificationTapped, onTokenRotated, openSettings: openDeviceSettings };

/**
 * The app's device for Push notifications (#699), inside the API's provider: the system's notifications, the API with
 * the session, the device's storage, its platform, and the app's language. An iOS development build registers with
 * APNs' sandbox.
 */
export function AppPushDevice({ children }: { children: ReactNode }) {
  const api = useApi();
  const { i18n } = useTranslation();
  const device = useMemo(
    () =>
      createPushDevice({
        notifications: deviceNotifications(() => i18n.t("mobile.push.channel")),
        api,
        storage: deviceStorage,
        platform: Platform.OS === "android" ? "android" : "ios",
        environment: __DEV__ ? "development" : "production",
        language: () => (isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE),
      }),
    [api, i18n],
  );
  return <PushDeviceProvider device={device}>{children}</PushDeviceProvider>;
}

/** The signed-in app's Push notifications: a notification tapped opens its page through the router. */
export function AppPush({ children }: { children: ReactNode }) {
  const device = usePushDevice();
  const router = useRouter();
  const navigate = useMemo(() => (path: string) => router.push(path as never), [router]);
  if (!device) return children;
  return (
    <PushProvider device={device} system={SYSTEM} navigate={navigate}>
      {children}
    </PushProvider>
  );
}
