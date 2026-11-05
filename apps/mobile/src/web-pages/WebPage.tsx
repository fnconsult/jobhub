import { API_VERSION, APP_WEBVIEW_USER_AGENT } from "@jobhub/shared";
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Share, View } from "react-native";
import { WebView } from "react-native-webview";
import type { FileDownloadEvent, ShouldStartLoadRequest, WebViewNavigation, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";
import { useSession } from "../session/SessionGate";
import { useTheme } from "../theme/theme";

/** The app's WebViews name it in their user agent: the web app then shows the page without its Sidebar, prices or purchase. */
const USER_AGENT = `${APP_WEBVIEW_USER_AGENT}/${API_VERSION}`;

/** Where the web app lands once its session is gone: signed out on the web, or the account deleted. */
const SESSION_ENDED = ["/connexion", "/compte/supprime"];

/** Whether `url` is the web app's own (the same origin: scheme, host and port, never a look-alike or a parent domain). */
function webApps(url: string, webAppUrl: string): boolean {
  try {
    return new URL(url).origin === webAppUrl;
  } catch {
    return false;
  }
}

/** Opens `url` out of the app: the system's browser, or the app the system gives its scheme to (mailto:, tel:). */
function openOutside(url: string): void {
  Linking.openURL(url).catch(() => {});
}

/**
 * A page of the web app shown inside the app (#689, ADR-0076): Mon compte, the subscription, the Withdrawal, the Legal
 * Texts, the Coach space. The session's cookie is lent to the WebViews for the web app's host alone before the page
 * loads (`shareWithWebViews`); the page stays on that host, and any other address, or a new window it asks for, opens
 * in the system's browser. Landing on sign-in or the deleted account's page reads the session again, which signs the
 * app out once the web app no longer knows it. A file the page downloads (the Data export) is fetched with the session
 * into the app's cache and handed to the share sheet, to save or send (iOS; Android's WebView downloads it itself).
 */
export function WebPage({ path }: { path: string }) {
  const { webPages, recheck } = useSession();
  const { colors } = useTheme();
  const [lent, setLent] = useState(false);

  useEffect(() => {
    let current = true;
    void webPages
      .shareWithWebViews()
      .catch(() => {})
      .then(() => current && setLent(true));
    return () => {
      current = false;
    };
  }, [webPages]);

  if (!lent) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  const shouldStart = ({ url, isTopFrame }: ShouldStartLoadRequest) => {
    // A frame inside the page (never sent the session: its cookie is for the web app's host alone) loads where it is.
    if (isTopFrame === false || url === "about:blank" || webApps(url, webPages.webAppUrl)) return true;
    openOutside(url);
    return false;
  };
  const download = async ({ nativeEvent: { downloadUrl } }: FileDownloadEvent): Promise<void> => {
    // The session goes with the web app's own files alone.
    if (!webApps(downloadUrl, webPages.webAppUrl)) {
      openOutside(downloadUrl);
      return;
    }
    try {
      const file = await File.downloadFileAsync(downloadUrl, Paths.cache, { headers: { cookie: await webPages.cookie() }, idempotent: true });
      await Share.share({ url: file.uri });
    } catch {
      // Offline, or the share sheet closed: the page is still there to try again.
    }
  };
  const changed = ({ url }: WebViewNavigation) => {
    if (!webApps(url, webPages.webAppUrl)) return;
    const { pathname } = new URL(url);
    if (SESSION_ENDED.some((ended) => pathname === ended || pathname.startsWith(`${ended}/`))) void recheck();
  };

  return (
    <WebView
      source={{ uri: `${webPages.webAppUrl}${path}` }}
      style={{ flex: 1, backgroundColor: colors.background }}
      applicationNameForUserAgent={USER_AGENT}
      onShouldStartLoadWithRequest={shouldStart}
      onOpenWindow={({ nativeEvent }: WebViewOpenWindowEvent) => openOutside(nativeEvent.targetUrl)}
      onNavigationStateChange={changed}
      onFileDownload={(event: FileDownloadEvent): void => void download(event)}
      thirdPartyCookiesEnabled={false}
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
      startInLoadingState
    />
  );
}
