# Research for issue #699: Push notification events and in-context permission (app mobile)

Scope: only the external facts needed to implement #699 (client side in `apps/mobile`; the server is #698). Sources are first-party docs, fetched 2026-11-05.

Limits of this pass: `docs.expo.dev` is not reachable from the session network, so Expo facts come from the Expo repo's own docs source (raw.githubusercontent.com/expo/expo, `docs/pages/versions/unversioned/sdk/notifications.mdx`, `main`, i.e. unversioned, not pinned to SDK 58). The Apple page fetch returned only its title; the Apple points below are therefore marked unverified. Both need a re-check by the implementer.

## 1. Android 13+ permission (verified)

Source: https://developer.android.com/develop/ui/views/notifications/notification-permission

- From API 33, `POST_NOTIFICATIONS` is a runtime permission; a fresh install has notifications off until granted.
- If the app targets 33+, the app controls when the dialog appears. Google recommends asking after a user action (e.g. an "alert bell" tap) and showing an explanation screen only when `shouldShowRequestPermissionRationale()` is true. This fits the issue: ask on Job Search launch or Interview add, after our explanation screen.
- Swiping the dialog away leaves the state unchanged (so it is not a refusal to record). "Don't allow" blocks all channels. Targeting 12L or lower, one denial is permanent until reinstall; target 33+ avoids that.
- Check `areNotificationsEnabled()` before sending; users can revoke at any time. So the app must re-read permission state on foreground and call `DELETE /api/account/push-devices` when it is no longer granted (as #698's entry point says).

## 2. Expo notifications (partly verified, from Expo docs source, unversioned)

Source: https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/notifications.mdx

- On Android 13+, the permission prompt does not appear until at least one notification channel exists: `setNotificationChannelAsync` must run before `getDevicePushTokenAsync` / `getExpoPushTokenAsync`. Create a default channel before asking.
- From SDK 53, remote push does not work in Expo Go on Android; a development build is required. Local notifications still work in Expo Go. The repo already uses `expo-dev-client`, so e2e must use a dev build.
- Config plugin `expo-notifications` goes in `app.json`/`app.config.ts`; options (`icon`, `color`, `defaultChannel`, iOS `enableRemoteNotifications`, ...) take effect only in a new native binary. Adding the dependency and plugin means a new build (EAS), not an OTA update.
- iOS: the docs say to rely on the `ios.status` field rather than the root `status` of the permission result.
- Deep links: tap handling uses `addNotificationResponseReceivedListener` (runtime) and `getLastNotificationResponse()` (cold start); custom payload is in `notification.request.content.data` and the docs advise validating the URL/value before navigating. For #699, the payload carries the object id alone (per #698), so the app must map event type + id to a route itself and ignore unknown values.
- Android push needs FCM credentials in the build (linked credentials guide on Expo docs). Not verified here; not part of #699 code but a prerequisite for manual testing.

Not verified (page does not cover them; check the versioned SDK 58 API reference before coding): `canAskAgain` and `granted` fields of the permission result, `getDevicePushTokenAsync` return shape (native APNs/FCM token, which #698 expects rather than an Expo token), `addPushTokenListener` for token rotation.

## 3. iOS permission rules (UNVERIFIED: fetch returned page title only)

Source to confirm: https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications

Believed, from general knowledge only: the system prompt is shown once; after a denial the app cannot re-prompt and can only send the user to Settings (open via `Linking.openSettings()` in React Native/Expo); Apple advises asking when the user understands the value. This matches the issue's "un refus est retenu, Rappels explique comment l'activer dans les Réglages". Confirm before relying on it.

## Implications for the implementer

1. Order on Android: create channel, then explanation screen, then request permission.
2. A refusal (explicit denial, `canAskAgain` false) is stored locally; do not re-ask, show the Settings instruction in Rappels. A dismissed Android dialog is not a refusal.
3. Re-check permission on app foreground; deregister the device when revoked.
4. Use native device tokens, and handle token rotation by re-POSTing.
5. Validate the deep-link payload against known event types before navigating.
6. Dev build and a new native build are needed; no remote push in Expo Go on Android.
