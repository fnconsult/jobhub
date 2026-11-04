import { Linking } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { isOnWebApp, webAppAddress, webAppHeaders } from "../web-app";

/** Whether the WebView follows a link: one on the web app stays in it, any other opens in the system browser (ADR-0076). */
function followsInWebView({ url }: Pick<WebViewNavigation, "url">): boolean {
  if (isOnWebApp(url)) return true;
  void Linking.openURL(url);
  return false;
}

/**
 * A page of the web app in a WebView, for what the app leaves to the web (ADR-0076): editing a Profile, Mon compte…
 * It fills the pane it is in, and scrolls itself. The session cookie reaches it for jobbbox.ai only (#685, #689).
 */
export function WebPage({ path, title }: { path: string; title: string }) {
  return (
    <WebView
      source={{ uri: webAppAddress(path), headers: webAppHeaders() }}
      accessibilityLabel={title}
      sharedCookiesEnabled
      // A link that would open a new window opens here, under the rule above.
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={followsInWebView}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
}
