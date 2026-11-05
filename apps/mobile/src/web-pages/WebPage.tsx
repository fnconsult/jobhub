import CookieManager from "@preeternal/react-native-cookie-manager";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type { AppSession } from "../session/app-session";
import { space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { isOnWebApp } from "../web-app";

/** On iOS, the cookies go to the WebViews' own store (WebKit's); Android has one store for both. */
const WEBVIEWS = { iosCookieStore: "webKit" } as const;

/** The address `url` is, when it is one; null otherwise. */
function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * A page of the web app in the app (ADR-0076), full screen with its title and « Fermer »: what stays on the web, as
 * setting up Two-step verification (#688; Mon compte and the rest in #689). The WebView is given the session's cookies
 * for the web app's host alone, and forgets them once closed; any other address opens in the system browser.
 * `onLeave` when the page goes on to another page of the site (the setup does once it is done), `onClose` on « Fermer ».
 */
export function WebPage({
  session,
  baseURL,
  path,
  title,
  onLeave,
  onClose,
}: {
  session: Pick<AppSession, "webCookies">;
  baseURL: string;
  path: string;
  title: string;
  onLeave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const left = useRef(false);
  const site = new URL(baseURL);

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
      for (const name of given) void CookieManager.clearByName(origin, name, WEBVIEWS).catch(() => undefined);
    };
    // The page's site and session, not each render's copy of the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, site.origin]);

  // The web app's origin rule, the same as every address the app gives the session to (web-app.ts).
  const onSite = (url: string) => isOnWebApp(url, baseURL);

  const allow = ({ url }: { url: string }) => {
    if (onSite(url) || url === "about:blank") return true;
    void Linking.openURL(url).catch(() => undefined);
    return false;
  };

  const navigated = ({ url }: WebViewNavigation) => {
    const address = parsed(url);
    if (left.current || !address || !onSite(url) || address.pathname === path) return;
    left.current = true;
    onLeave();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], paddingHorizontal: space[2], borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ flexShrink: 1, paddingHorizontal: space[2] }}>
          <AppText variant="h2" lines={1}>
            {title}
          </AppText>
        </View>
        <Control label={t("conversationFirst.close")} icon={X} onPress={onClose} />
      </View>
      {ready ? (
        <WebView
          style={{ flex: 1 }}
          source={{ uri: new URL(path, site).toString() }}
          onShouldStartLoadWithRequest={allow}
          onNavigationStateChange={navigated}
          sharedCookiesEnabled
          setSupportMultipleWindows={false}
        />
      ) : null}
    </View>
  );
}
