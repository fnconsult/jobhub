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
import { useProfile } from "../api/reads";
import { AppLock } from "../app-lock/AppLock";
import { AppProviders } from "../app-providers";
import { startCrashReports } from "../crash-reports";
import { createDocumentReader } from "../documents/document-reader";
import { forgetDocuments, systemDocuments } from "../documents/system-documents";
import { deviceI18n } from "../i18n";
import { LegalSteps } from "../legal/LegalSteps";
import { deviceNetwork, deviceStorage } from "../offline/device";
import { NEW_CONVERSATION, pageFor, paths, profileIdOf } from "../navigation/pages";
import { useIsHumanCoach } from "../navigation/human-coach";
import { Sidebar } from "../navigation/Sidebar";
import { useFreeConversations } from "../navigation/FreeConversations";
import { ActivityPane } from "../coach/ActivityPane";
import { ClearConversation } from "../coach/ClearConversation";
import { PageConversationProvider } from "../coach/page-conversation";
import { usePortraitOnPhones } from "../orientation";
import { appFetch, appSession } from "../session/instance";
import { AppPush, AppPushDevice } from "../push/app-push";
import { showNotificationsInForeground } from "../push/device";
import { SessionGate } from "../session/SessionGate";
import { PaneContent } from "../screens/PaneContent";
import { Shell } from "../shell/Shell";
import { useHoldShareFrom, useResumeShare } from "../share/pending-share";

const DEVICE = { storage: deviceStorage, network: deviceNetwork };

// Crash reports start before anything else draws, in release builds whose configuration carries the DSN (#703).
startCrashReports({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, development: __DEV__ });
// A Push notification arriving while the app is open shows as a banner (#699).
showNotificationsInForeground();

/** The box stays above the keyboard: iOS lays the page out again, Android resizes the window itself. */
const KEYBOARD = Platform.OS === "ios" ? "padding" : undefined;

/**
 * The app's root: Inter loaded (its three weights alone, bundled with the app), the device's language, the system's
 * theme, the session (signed out, the sign-in screen; #685), the read cache kept on the device, the optional app lock over
 * the signed-in app (#702), the legal steps after sign-in (the CGU to accept, the privacy policy's change, the EU AI
 * Consent; #689), the Push notifications (the device registered, forgotten at sign-out, a notification tapped opening
 * its page, asked for in context; #699), then the shell around every page.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });
  const i18n = useMemo(() => deviceI18n(), []);
  // The address the app was opened with, a universal link or an App Link: a magic link signs in.
  const link = useLinkingURL();
  // A share link (Share capture, #697) is held at once, signed in or not: the capture screen opens on it once signed in.
  useHoldShareFrom(link);
  usePortraitOnPhones();
  // Without Inter (it is bundled, so hardly ever), the system font draws the text rather than no app at all.
  if (!fontsLoaded && !fontError) return null;
  return (
    <AppProviders i18n={i18n} initialMetrics={initialWindowMetrics} device={DEVICE} session={appSession} fetch={appFetch}>
      <StatusBar style="auto" />
      <AppPushDevice>
        <SessionGate session={appSession} link={link} forgetOnDevice={forgetDocuments}>
          <AppLock>
            <LegalSteps>
              <AppPush>
                <AppShell />
              </AppPush>
            </LegalSteps>
          </AppLock>
        </SessionGate>
      </AppPushDevice>
    </AppProviders>
  );
}

function AppShell() {
  return (
    <PageConversationProvider>
      <PagesInShell />
    </PageConversationProvider>
  );
}

/** Each page in the shell: its title (a Free conversation's, as the drawer lists it), its pane, « Effacer » on a conversation saved. */
function PagesInShell() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  // A Profile's page is titled with its name, from the read its Fiche shows (#695); a Free conversation's with its title, as the drawer lists it.
  const profile = useProfile(profileIdOf(pathname)).data;
  const free = useFreeConversations().data?.conversations;
  const page = pageFor(pathname, t, { profile, conversationTitle: (id) => free?.find((conversation) => conversation.id === id)?.title });
  const isHumanCoach = useIsHumanCoach();
  // What another app shared while signed out, or while another page was shown: the capture screen opens on it.
  useResumeShare(pathname, (path) => router.navigate(path));
  // The app's one reader of Tailored Documents: a file it downloaded is not downloaded again while it runs.
  const reader = useMemo(() => createDocumentReader(systemDocuments), []);
  return (
    <Shell
      page={page}
      paneContent={page.pane === "activite" ? <ActivityPane /> : <PaneContent pathname={pathname} page={page} reader={reader} />}
      sidebar={(closeDrawer) => <Sidebar isHumanCoach={isHumanCoach} onNavigate={closeDrawer} />}
      onNewConversation={() => router.navigate(paths.conversation(NEW_CONVERSATION))}
      actions={<ClearConversation />}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD}>
        <Stack screenOptions={{ headerShown: false }} />
      </KeyboardAvoidingView>
    </Shell>
  );
}
