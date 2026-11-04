import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { useFonts } from "expo-font";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { AppProviders } from "../app-providers";
import { deviceI18n } from "../i18n";
import { NEW_CONVERSATION, pageFor, paths } from "../navigation/pages";
import { Sidebar } from "../navigation/Sidebar";
import { usePortraitOnPhones } from "../orientation";
import { PanePlaceholder } from "../screens/PanePlaceholder";
import { Shell } from "../shell/Shell";

/** The box stays above the keyboard: iOS lays the page out again, Android resizes the window itself. */
const KEYBOARD = Platform.OS === "ios" ? "padding" : undefined;

/** The app's root: Inter loaded (its three weights alone, bundled with the app), the device's language, the system's theme, then the shell around every page. */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });
  const i18n = useMemo(() => deviceI18n(), []);
  usePortraitOnPhones();
  // Without Inter (it is bundled, so hardly ever), the system font draws the text rather than no app at all.
  if (!fontsLoaded && !fontError) return null;
  return (
    <AppProviders i18n={i18n} initialMetrics={initialWindowMetrics}>
      <StatusBar style="auto" />
      <AppShell />
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
