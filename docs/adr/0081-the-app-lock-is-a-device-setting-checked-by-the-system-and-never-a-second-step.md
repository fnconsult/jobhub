# The app lock is a device setting, checked by the system, and never a second step

_Builds on ADR-0076 (native app, same API and session) and ADR-0075 (Two-step verification)._

The Jobbbox app has an **App lock** (« Verrouiller l'app »), off by default, in the **App settings** (« Réglages de l'app », `/reglages`), a page that exists only in the app.

- **Device only.** The setting is kept in the Keychain or Keystore (`expo-secure-store`), never restored onto another device, never sent to the server. The system (`expo-local-authentication`) checks Face ID, the fingerprint or the device's code; the app only receives a yes or a no, so Jobbbox processes no biometric data.
- **Not a second step.** It does not touch the session or Two-step verification (ADR-0075).
- **When it locks.** When the app starts and when it returns after 5 minutes or more in the background, also if the clock was put back meanwhile. `inactive` alone never locks, so the system's own prompt cannot re-lock the app.
- **No lock-out.** The device's code is the fallback. If the device no longer has Face ID, a fingerprint or a code, the lock turns itself off.
- **App switcher.** While the lock is on, the content is hidden: blurred on iOS, `FLAG_SECURE` on Android, which also blocks screenshots and screen recording inside the app.

## Considered Options

- **Hiding only when the app goes to the background**: unreliable, the snapshot can be taken before the handler runs. Hiding for as long as the lock is on costs Android screenshots in the app, which the Help Article says.
- **Lock only on return from the background**: the app would open unlocked after being closed.
- **Tie the lock to the account (a server setting)**: it would follow the person to a device that did not ask for it, and send a security choice to the server for nothing.

## Consequences

- Turning the lock on needs a new development build: three native modules, and `NSFaceIDUsageDescription` (French only for now, `app.json` has no per-language strings).
- Saying it in the app's privacy policy is a Legal Text Version, opened as a « Légal : » issue.
