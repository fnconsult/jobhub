import * as SecureStore from "expo-secure-store";
import { WEB_APP_URL } from "../web-app-url";
import { createAppSession, type SessionStorage } from "./app-session";

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

/** The app's one session, on the web app the app calls (web-app-url.ts). */
export const appSession = createAppSession({ baseURL: WEB_APP_URL, storage });
