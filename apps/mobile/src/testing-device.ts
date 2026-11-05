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
