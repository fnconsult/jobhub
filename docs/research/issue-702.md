# Research for issue #702: App lock with Face ID / fingerprint

Scope: only the external facts needed to implement issue #702. Sources are the first-party Expo docs and source (github.com/expo/expo, `main`), read 2026-11-04. Direct access to docs.expo.dev was blocked in this session, so the docs page was read from its MDX source in the Expo repo, which is the same file. Apple and Android platform docs were not fetched; points that rely on them are marked.

## 1. `expo-local-authentication`

Sources:
- https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/local-authentication.mdx
- https://github.com/expo/expo/blob/main/packages/expo-local-authentication/src/LocalAuthentication.ts
- https://github.com/expo/expo/blob/main/packages/expo-local-authentication/src/LocalAuthentication.types.ts

- Not yet a dependency. `apps/mobile` is on `expo ~58.0.23`; install with `npx expo install expo-local-authentication` so the SDK-matched version is picked.
- Face ID is not supported in Expo Go. Testing needs a development build.
- Config plugin: add `"expo-local-authentication"` to `plugins` in `apps/mobile/app.json` (currently only `expo-localization` is there). Option `faceIDPermission` sets `NSFaceIDUsageDescription` (default `"Allow $(PRODUCT_NAME) to use Face ID"`); `false` omits it. Use a French/English-appropriate string; this text is shown by iOS.
- Critical: without `NSFaceIDUsageDescription`, on a Face ID iPhone the module authenticates with the device passcode instead of Face ID (JSDoc of `authenticateAsync`). The plugin adds it by default, so keep the plugin and do not pass `false`.
- Android permissions `USE_BIOMETRIC` and `USE_FINGERPRINT` are added automatically by the library manifest.
- API useful here: `hasHardwareAsync()`, `isEnrolledAsync()`, `getEnrolledLevelAsync()` (`NONE=0`, `SECRET=1` PIN/pattern, `BIOMETRIC_WEAK=2`, `BIOMETRIC_STRONG=3`), `authenticateAsync(options)`.
- Result: `{ success: true }` or `{ success: false, error, warning? }`. Error values: `not_enrolled`, `user_cancel`, `app_cancel`, `not_available`, `lockout`, `no_space`, `timeout`, `unable_to_process`, `unknown`, `system_cancel`, `user_fallback`, `invalid_context`, `passcode_not_set`, `authentication_failed`.

### Fallback to the device code (acceptance criterion 1)
- `disableDeviceFallback` defaults to `false`: after several failed biometric attempts the system falls back to the device passcode (iOS policy `LAPolicyDeviceOwnerAuthentication`). Leave it default to satisfy "repli sur le code de l'appareil". Setting `true` switches to biometrics-only.
- iOS: the fallback button shows after several failures, label default `Use Passcode`, customizable with `fallbackLabel`; empty string hides it.
- Android: `biometricsSecurityLevel` defaults to `'weak'` (Class 2 + Class 3). On Android 9 and 10 only, with `strong` and fallback enabled, a `fallbackLabel` button opens the screen-lock confirmation. Keep the default `weak` to get a single prompt that offers the device credential on all versions (inference from the option docs).
- Edge case: a device with no biometric and no passcode returns `not_enrolled` / `passcode_not_set`. The toggle must handle this: check `getEnrolledLevelAsync() !== NONE` before letting the user enable the lock, and show a message otherwise. Otherwise the user could lock themselves out of nothing, or the toggle could be on with no way to unlock.
- Prompt text (`promptMessage`, `cancelLabel`, `fallbackLabel`) is app-provided, so it must go through the app's FR/EN i18n.

## 2. Hiding content in the app switcher (acceptance criterion 2)

Sources:
- https://github.com/expo/expo/blob/main/packages/expo-screen-capture/src/ScreenCapture.ts
- https://github.com/expo/expo/blob/main/packages/expo-screen-capture/android/src/main/java/expo/modules/screencapture/ScreenCaptureModule.kt
- https://github.com/expo/expo/blob/main/packages/expo-screen-capture/CHANGELOG.md

- Candidate: `expo-screen-capture` (not yet a dependency).
- Android: `preventScreenCaptureAsync()` sets `FLAG_SECURE` on the activity window, which shows a blank preview in recents. Side effect: it also blocks screenshots and screen recording while active, so enable it only while the lock setting is on (or only while backgrounded) and call `allowScreenCaptureAsync()` otherwise. Whether screenshots should be blocked while the lock is on is a product choice.
- iOS: `enableAppSwitcherProtectionAsync(blurIntensity = 0.5)` adds a blur overlay for the app switcher; `disableAppSwitcherProtectionAsync()` removes it. Blur intensity 1.0 is the maximum, not necessarily unreadable; use 1 for "masqué". The Expo changelog shows recent fixes to this overlay (native tabs, reload, rapid state changes), so use a current SDK 58 patch version and test on a device.
- Alternative with no extra dependency: render an opaque cover view when `AppState` becomes `inactive`/`background`. On iOS the snapshot is taken as the app leaves the foreground, so this is racy; the native overlay is the more reliable option (inference, not verified against Apple docs).

## 3. Timing and state (acceptance criteria 2 and 4)

- No external fact beyond React Native's `AppState` (`active` / `inactive` / `background`). Record a timestamp when the state leaves `active` for `background`, and on return to `active` lock if `now - timestamp >= 5 min`. Use a monotonic-safe source where possible; a wall clock can be changed by the user. Note: the biometric prompt itself makes iOS emit `inactive`, so do not start the timer on `inactive` alone, or the prompt re-locks itself.
- Tests: mock `expo-local-authentication`, `AppState` and the clock; the 4:59 vs 5:00 boundary is deterministic.
- Do not rely on JS timers running in the background; they are suspended. Compare timestamps on return instead.

## 4. Storage and privacy (criterion 3, Registre)

- The setting is a device-local boolean (e.g. `expo-secure-store` or AsyncStorage, to be chosen from what #683 already uses). Nothing is sent to the server.
- Biometric data never reaches the app: `authenticateAsync` returns only success or an error code. This supports the register statement "aucune donnée biométrique traitée par Jobbbox". This is a reading of the API surface above, not legal advice; the « Légal : » issue should confirm the wording (GDPR art. 9 is not engaged if Jobbbox never receives or stores biometric templates).

## 5. Open points for the implementer

1. Install `expo-local-authentication` (and `expo-screen-capture` if chosen) through `npx expo install`; add the plugin entries to `app.json`; a new dev build is required (native change).
2. Keep `disableDeviceFallback` at its default `false`.
3. Gate the toggle on `getEnrolledLevelAsync()`.
4. Decide whether Android `FLAG_SECURE` should only be set while backgrounded, to avoid blocking user screenshots in normal use.
