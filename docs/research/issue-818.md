# Issue #818: app icon badge (Offres à traiter counter)

Scope: only the platform facts needed for the app-icon badge. Checked 2026-11-06. The app is Expo SDK 58 with `expo-notifications ~58.1.8` (`apps/mobile/package.json`); push is sent by the worker via APNs/FCM (#698, #699).

**Verification status:** the `expo-notifications` facts were read from its source on GitHub (primary). The Apple and Firebase pages could not be read (Apple's pages are JS-rendered and return only a shell; `firebase.google.com` is blocked by the session proxy), so the APNs `badge` and FCM lines are unverified recall to re-check.

## Verified (expo/expo, `packages/expo-notifications`)
Source: `src/setBadgeCountAsync.ts`, `android/.../notifications/badge/BadgeHelper.kt`, `CHANGELOG.md`.
- `setBadgeCountAsync(n)` sets the icon badge; `0` clears it. Resolves to a boolean (success).
- iOS: returns `false` and does nothing unless the user granted the `allowBadge` permission via `requestPermissionsAsync`. The app must request badge permission, and a user who refuses alerts-only keeps no badge.
- Android: not every launcher supports badges; unsupported launchers resolve `false`. Implementation uses ShortcutBadger.
- Android gotcha: `setBadgeCountAsync(0)` calls `NotificationManager.cancelAll()`, so clearing the badge also dismisses every delivered notification of the app. When N reaches 0, do not call it blindly while the user may have other notifications in the tray.
- iOS gotcha (fixed in changelog, PR #39009): `setBadgeCountAsync(0)` used to clear delivered notifications too; check the installed version has the fix.
- The Android payload `badge` field sets the "notification number" only (changelog, PR #17171); it is not a reliable launcher badge.
- Web: the module accepts `web` options through `badgin`; not needed here (web uses the Sidebar).

## Unverified recall (re-check before relying)
- APNs: the `aps.badge` key in the push payload sets the icon badge to that absolute number (0 removes it). Source to read: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- FCM v1: no cross-launcher absolute badge field on Android; `notification.notification_count` exists but launcher support varies. iOS via `apns.payload.aps.badge`. Source: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages
- Silent/background pushes cannot be assumed to update the badge on iOS when the app is not running; to be checked.

## Implications for the issue
- "Mise à jour à l'ouverture": call `setBadgeCountAsync(N)` on app open/foreground with the shared counter; guard on the boolean result and never throw.
- "Avec les push déjà envoyées": the worker must add `aps.badge = N` (absolute count, computed server-side per Candidate) to the existing #698/#699 payloads; no new push. N must stay the same shared counter as the Sidebar.
- Request badge permission with the existing notification permission flow (`allowBadge`).
- Avoid `setBadgeCountAsync(0)` side effects on Android (see above); prefer an approach that does not wipe the tray, or accept and document it.
- No new sub-processor: APNs and FCM are already in the privacy register for #698.
