// The app lock's side on the device, the only place it reaches the system: the setting in the Keychain or Keystore, the
// system's Face ID, fingerprint or code prompt, and what the app switcher shows. Nothing here goes to the server: the
// setting is the device's (ADR-0076), and the system answers the prompt with a yes or a no, never a biometric datum.
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SETTING = "app-lock";
const ON = "on";
/** Readable once the device has been unlocked after starting, and never restored from a backup onto another device. */
const STORE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** Whether « Verrouiller l'app » is on for this device; read at once, so the app never shows a page before knowing. */
export function lockSettingIsOn(): boolean {
  try {
    return SecureStore.getItem(SETTING, STORE) === ON;
  } catch {
    // The Keychain unreadable: locked rather than open; with no way to unlock, the prompt turns the lock off (below).
    return true;
  }
}

export async function saveLockSetting(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(SETTING, ON, STORE);
  else await SecureStore.deleteItemAsync(SETTING, STORE);
}

/** Whether the person set up Face ID, a fingerprint or at least a code on the device, without which nothing could unlock. */
export async function deviceCanLock(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** Errors meaning the device has no way left to recognise its owner (Face ID, fingerprint and code all removed). */
const NOTHING_TO_ASK: ReadonlySet<string> = new Set(["not_enrolled", "passcode_not_set", "not_available"]);

export type DeviceOwner = "recognised" | "refused" | "unavailable";

/**
 * The system's prompt: Face ID, Touch ID or a fingerprint, and the device's code after failures or in their place
 * (`disableDeviceFallback` left off). `promptMessage` and `cancelLabel` are the app's words, in its language.
 */
export async function askDeviceOwner(prompt: { promptMessage: string; cancelLabel: string }): Promise<DeviceOwner> {
  try {
    const result = await LocalAuthentication.authenticateAsync(prompt);
    if (result.success) return "recognised";
    return NOTHING_TO_ASK.has(result.error) ? "unavailable" : "refused";
  } catch {
    return "refused";
  }
}

/**
 * Hides the app's content from the app switcher while the lock is on: blurred on iOS, blank on Android, where the same
 * flag (`FLAG_SECURE`) also refuses screenshots and screen recording; the only way the system offers to keep the content
 * out of the recent apps.
 */
export async function protectContent(on: boolean): Promise<void> {
  try {
    if (Platform.OS === "ios") await (on ? ScreenCapture.enableAppSwitcherProtectionAsync(1) : ScreenCapture.disableAppSwitcherProtectionAsync());
    else if (Platform.OS === "android") await (on ? ScreenCapture.preventScreenCaptureAsync(SETTING) : ScreenCapture.allowScreenCaptureAsync(SETTING));
  } catch {
    // Unavailable (an old system, the web): the lock still covers the page once it engages.
  }
}
