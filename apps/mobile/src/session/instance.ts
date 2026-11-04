import * as SecureStore from "expo-secure-store";
import { createAppSession, type SessionStorage } from "./app-session";
import { devicePasskeys } from "./device-passkeys";

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

/** The app's one session. */
export const appSession = createAppSession({ baseURL: WEB_APP_URL, storage, passkeys: devicePasskeys });
