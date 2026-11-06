import CookieManager from "@preeternal/react-native-cookie-manager";
import { API_VERSION, APP_WEBVIEW_USER_AGENT } from "@jobhub/shared";
import { File, Paths } from "expo-file-system";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type { FileDownloadEvent, ShouldStartLoadRequest, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";
import { useFetchOnWebApp } from "../api/api";
import type { AppSession } from "../session/app-session";
import { space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { isOnWebApp, webAppHeaders } from "../web-app";

/** On iOS, the cookies go to the WebViews' own store (WebKit's); Android has one store for both. */
const WEBVIEWS = { iosCookieStore: "webKit" } as const;

/** The app's WebViews name it in their user agent: the web app then shows the page without its Sidebar, prices or purchase (#689). */
const USER_AGENT = `${APP_WEBVIEW_USER_AGENT}/${API_VERSION}`;

/** Where the web app lands once its session is gone: signed out on the web, or the account deleted (#689). */
const SESSION_ENDED = ["/connexion", "/compte/supprime"];

/** The address `url` is, when it is one; null otherwise. */
function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The name to keep a downloaded file under in the app's cache: the one its answer gives (`attachment; filename="…"`),
 * else its address's last segment, never a path (no `/` or `\\`, no `.` or `..`).
 */
export function downloadedFileName(response: Response, address: URL): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? address.pathname.split("/").pop() ?? "";
  try {
    if (encoded) name = decodeURIComponent(encoded);
  } catch {
    // Not percent-encoded as it says: the plain name, or the address's.
  }
  name = name.trim().replace(/[/\\]/g, "_");
  return name && name !== "." && name !== ".." ? name : "download";
}

/** Opens `url` out of the app: the system's browser, or the app the system gives its scheme to (mailto:, tel:). */
function openOutside(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}

/**
 * A page of the web app in the app (ADR-0076): what stays on the web, as setting up Two-step verification (#688), Mon
 * compte, the subscription, the Withdrawal, the Legal Texts and the Coach space (#689). The WebView is given the
 * session's cookies for the web app's host alone; the page stays on that host, and any other address, or a new window
 * it asks for, opens in the system browser. Its user agent names the app (`JobbboxApp/<API Version>`). A file the page
 * downloads (the Data export) is fetched with the session by the app's own fetch (useFetchOnWebApp), its redirects
 * followed on the web app alone and one to any other host refused, the cookie never sent there (#756); it is written
 * into the app's cache and handed to the share sheet, to save or send (iOS; Android's WebView downloads it itself).
 *
 * With a `title` and « Fermer » (`onClose`), the page is full screen, before the shell, and forgets the cookies it was
 * given once closed; without, it is a page of the shell, whose cookies stay in the WebViews' store until the session
 * ends (AppSession empties it then), another page of the site possibly still open below it.
 * `onLeave` when the page goes on to another page of the site (the setup does once it is done); `onSessionEnded` when
 * it lands on sign-in or the deleted account's page, where the web app sends a session it no longer knows.
 */
export function WebPage({
  session,
  baseURL,
  path,
  title,
  onLeave,
  onClose,
  onSessionEnded,
}: {
  session: Pick<AppSession, "webCookies" | "cookie">;
  baseURL: string;
  path: string;
  title?: string;
  onLeave?: () => void;
  onClose?: () => void;
  onSessionEnded?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const fetchOnWebApp = useFetchOnWebApp();
  const [ready, setReady] = useState(false);
  const left = useRef(false);
  const site = new URL(baseURL);
  const closable = onClose !== undefined;

  useEffect(() => {
    let open = true;
    const given: string[] = [];
    const origin = site.origin;
    void (async () => {
      try {
        // No `domain`: a host-only cookie, for the web app's host alone and not its subdomains (ADR-0076).
        for (const { name, value } of await session.webCookies()) {
          await CookieManager.set(origin, { name, value, path: "/", secure: site.protocol === "https:", httpOnly: true }, WEBVIEWS);
          given.push(name);
        }
      } finally {
        if (open) setReady(true);
      }
    })();
    return () => {
      open = false;
      if (!closable) return;
      for (const name of given) void CookieManager.clearByName(origin, name, WEBVIEWS).catch(() => undefined);
    };
    // The page's site and session, not each render's copy of the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, site.origin, closable]);

  // The web app's origin rule, the same as every address the app gives the session to (web-app.ts).
  const onSite = (url: string) => isOnWebApp(url, baseURL);

  const allow = ({ url, isTopFrame }: ShouldStartLoadRequest) => {
    // A frame inside the page (never sent the session: its cookie is for the web app's host alone) loads where it is.
    if (isTopFrame === false || onSite(url) || url === "about:blank") return true;
    openOutside(url);
    return false;
  };

  const navigated = ({ url }: WebViewNavigation) => {
    const address = parsed(url);
    if (!address || !onSite(url)) return;
    if (onSessionEnded && SESSION_ENDED.some((ended) => address.pathname === ended || address.pathname.startsWith(`${ended}/`))) onSessionEnded();
    if (!onLeave || left.current || address.pathname === path) return;
    left.current = true;
    onLeave();
  };

  const download = async ({ nativeEvent: { downloadUrl } }: FileDownloadEvent): Promise<void> => {
    // The session goes with the web app's own files alone.
    if (!onSite(downloadUrl)) {
      openOutside(downloadUrl);
      return;
    }
    try {
      // The app's fetch, never the system's downloader: that one follows a redirect to any host, the cookie with it.
      const headers = { ...webAppHeaders(), cookie: await session.cookie() };
      const response = await fetchOnWebApp(downloadUrl, { headers, credentials: "omit" }, baseURL);
      if (!response.ok) throw new Error(`The download was answered ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const file = new File(Paths.cache, downloadedFileName(response, new URL(downloadUrl)));
      file.create({ overwrite: true });
      await file.write(bytes);
      await Share.share({ url: file.uri });
    } catch {
      // Offline, refused (a redirect off the web app), or the share sheet closed: the page is still there to try again.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: closable ? insets.top : 0 }}>
      {closable ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], paddingHorizontal: space[2], borderBottomWidth: 1, borderColor: colors.border }}>
          <View style={{ flexShrink: 1, paddingHorizontal: space[2] }}>
            <AppText variant="h2" lines={1}>
              {title}
            </AppText>
          </View>
          <Control label={t("conversationFirst.close")} icon={X} onPress={onClose} />
        </View>
      ) : null}
      {ready ? (
        <WebView
          style={{ flex: 1, backgroundColor: colors.background }}
          source={{ uri: new URL(path, site).toString() }}
          applicationNameForUserAgent={USER_AGENT}
          onShouldStartLoadWithRequest={allow}
          onOpenWindow={({ nativeEvent }: WebViewOpenWindowEvent) => openOutside(nativeEvent.targetUrl)}
          onNavigationStateChange={navigated}
          onFileDownload={(event: FileDownloadEvent): void => void download(event)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          startInLoadingState
        />
      ) : null}
    </View>
  );
}
