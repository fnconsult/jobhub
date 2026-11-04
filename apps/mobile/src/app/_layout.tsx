import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { useFonts } from "expo-font";
import { useLinkingURL } from "expo-linking";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { AppLock } from "../app-lock/AppLock";
import { AppProviders } from "../app-providers";
import { startCrashReports } from "../crash-reports";
import { deviceI18n } from "../i18n";
import { deviceNetwork, deviceStorage } from "../offline/device";
import { NEW_CONVERSATION, pageFor, paths } from "../navigation/pages";
import { Sidebar } from "../navigation/Sidebar";
import { usePortraitOnPhones } from "../orientation";
import { PanePlaceholder } from "../screens/PanePlaceholder";
import { appSession } from "../session/instance";
import { SessionGate } from "../session/SessionGate";
import { Shell } from "../shell/Shell";

const DEVICE = { storage: deviceStorage, network: deviceNetwork };

// Crash reports start before anything else draws, in release builds whose configuration carries the DSN (#703).
startCrashReports({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, development: __DEV__ });

/** The box stays above the keyboard: iOS lays the page out again, Android resizes the window itself. */
const KEYBOARD = Platform.OS === "ios" ? "padding" : undefined;

/**
 * The app's root: Inter loaded (its three weights alone, bundled with the app), the device's language, the system's
 * theme, the session (signed out, the sign-in screen; #685), the read cache kept on the device, the optional app lock over
 * the signed-in app (#702), then the shell around every page.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });
  const i18n = useMemo(() => deviceI18n(), []);
  // The address the app was opened with, a universal link or an App Link: a magic link signs in.
  const link = useLinkingURL();
  usePortraitOnPhones();
  // Without Inter (it is bundled, so hardly ever), the system font draws the text rather than no app at all.
  if (!fontsLoaded && !fontError) return null;
  return (
    <AppProviders i18n={i18n} initialMetrics={initialWindowMetrics} device={DEVICE}>
      <StatusBar style="auto" />
      <SessionGate session={appSession} link={link}>
        <AppLock>
          <AppShell />
        </AppLock>
      </SessionGate>
    </AppProviders>
  );
}

function AppShell() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const page = pageFor(pathname, t);
  return (
    <Shell
      page={page}
      paneContent={<PanePlaceholder pane={page.pane} />}
      sidebar={(closeDrawer) => <Sidebar onNavigate={closeDrawer} />}
      onNewConversation={() => router.navigate(paths.conversation(NEW_CONVERSATION))}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD}>
        <Stack screenOptions={{ headerShown: false }} />
      </KeyboardAvoidingView>
    </Shell>
  );
}
