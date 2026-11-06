import CookieManager from "@preeternal/react-native-cookie-manager";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { WEB_APP_URL } from "../web-app-url";
import { createAppSession, type AuthBrowser, type SessionStorage, type WebViewCookies } from "./app-session";
import { devicePasskeys } from "./device-passkeys";

/** The web app the app signs in to, as it calls it (src/web-app-url.ts). */
export { WEB_APP_URL };

/** The Keychain (iOS) or the Keystore (Android); on iOS, readable once the device is first unlocked, never backed up to another device. */
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const storage: SessionStorage = {
  getItem: (key) => SecureStore.getItem(key, options),
  setItem: (key, value) => SecureStore.setItem(key, value, options),
  getItemAsync: (key) => SecureStore.getItemAsync(key, options),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, options),
};

/**
 * The WebViews' cookie store (#689): WKWebView's own on iOS (the WebKit store, not the one URLSession reads), the one
 * Android shares between its WebViews and native requests. Emptied whole, both iOS stores included: the app's WebViews
 * only ever show the web app.
 */
const webViewCookies: WebViewCookies = {
  clear: async () => void (await CookieManager.clearAllStores()),
};

/**
 * The system's authentication browser (#687): ASWebAuthenticationSession on iOS, which closes itself on the app's
 * scheme, Custom Tabs on Android, which return to the app by its intent filter. Not ephemeral: it shares the browser's
 * sign-ins, so a person already signed in to Google or Apple there only confirms. On Android, a session left open is
 * dismissed first, as the Expo plugin does.
 */
const browser: AuthBrowser = (url, returnUrl) => {
  try {
    WebBrowser.dismissAuthSession();
  } catch {
    // Nothing open, or nothing to dismiss on this platform.
  }
  return WebBrowser.openAuthSessionAsync(url, returnUrl);
};

/** The app's one session, on the web app the app calls (web-app-url.ts), its second step by the device's passkeys, its sign-in through a provider by the system's authentication browser. */
export const appSession = createAppSession({ baseURL: WEB_APP_URL, storage, passkeys: devicePasskeys, webViewCookies, browser });

/**
 * The fetch the app's calls to the API go through (`ApiProvider`, src/api/api.tsx): `expo/fetch`, whose answer streams
 * (the Coach's reply, NDJSON, #690), whatever EXPO_PUBLIC_USE_RN_FETCH says of the global fetch.
 */
export const appFetch: typeof globalThis.fetch = (input, init) =>
  expoFetch(String(input), init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>;
