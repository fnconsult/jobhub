// The device's side of the app lock, faked for the tests (apps/mobile/__mocks__): its Keychain or Keystore, its Face ID,
// fingerprint or code prompt, and what its app switcher shows. Every test starts from `fakeDevice.reset()`.
import type { LocalAuthenticationOptions, LocalAuthenticationResult } from "expo-local-authentication";

const { SecurityLevel } = jest.requireActual<typeof import("expo-local-authentication")>("expo-local-authentication");

export const fakeDevice = {
  /** What the app stored in the Keychain or Keystore. */
  keychain: new Map<string, string>(),
  /** What the person set up on the device: Face ID or a fingerprint (`BIOMETRIC_STRONG`), a code only, or nothing. */
  enrolledLevel: SecurityLevel.BIOMETRIC_STRONG,
  /** The system's prompt, answered as the person would. */
  authenticate: jest.fn<Promise<LocalAuthenticationResult>, [LocalAuthenticationOptions | undefined]>(),
  /** Whether the app switcher shows the app's content blurred (iOS) or blank (Android), and screenshots are refused. */
  contentProtected: false,
  reset() {
    this.keychain.clear();
    this.enrolledLevel = SecurityLevel.BIOMETRIC_STRONG;
    this.authenticate.mockReset();
    this.authenticate.mockResolvedValue({ success: true });
    this.contentProtected = false;
  },
};
fakeDevice.reset();

/** A cookie as the WebView's store holds it (@preeternal/react-native-cookie-manager). */
export interface WebViewCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

/**
 * The WebViews' side of the device (apps/mobile/__mocks__): the cookies their store holds, and the WebView shown last,
 * whose props a test drives as the page would (a navigation, a link). Every test starts from `fakeWebView.reset()`.
 */
export const fakeWebView = {
  cookies: [] as WebViewCookie[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shown: null as null | Record<string, any>,
  reset() {
    this.cookies = [];
    this.shown = null;
  },
};
