import CookieManager from "@preeternal/react-native-cookie-manager";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { createApi } from "../api/api";
import { createAppSession, type SessionStorage, type WebViewCookies } from "./app-session";

/**
 * The web app the app signs in to and calls (ADR-0076): Production, or the Beta for TestFlight and Play internal
 * testing, set at build time by EXPO_PUBLIC_WEB_APP_URL (`http://localhost:3000` against `npm run dev`).
 */
export const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL || "https://jobbbox.ai";

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
  set: async (url, cookie) => void (await CookieManager.set(url, cookie, { iosCookieStore: "webKit" })),
  clear: async () => void (await CookieManager.clearAllStores()),
};

/** The app's one session. */
export const appSession = createAppSession({ baseURL: WEB_APP_URL, storage, webViewCookies });

/**
 * The app's calls to the web app's API, with the session's cookie: `expo/fetch`, whose answer streams (the Coach's reply,
 * NDJSON), whatever EXPO_PUBLIC_USE_RN_FETCH says of the global fetch.
 */
export const appApi = createApi({
  baseURL: WEB_APP_URL,
  cookie: () => appSession.cookie(),
  fetch: (input, init) => expoFetch(input, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>,
});
