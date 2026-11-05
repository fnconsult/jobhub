# Issue #698: Push notifications (APNs and FCM sent directly by the worker)

Scope: only the provider facts needed to send to APNs and FCM and to prune invalid tokens. Checked 2026-11-04.

**Verification status: NOT verified against primary sources.** The Apple developer pages are JavaScript-rendered and the fetch returned only their titles; the details below come from recall of Apple's documentation and must be re-checked against the pages cited. `firebase.google.com` is not in the session's allowed network domains, so no FCM fact was read at all. To finish this note, allow `firebase.google.com` and `developer.apple.com` rendering (or paste the pages) and confirm each line.

## APNs (unverified recall)
Sources to confirm: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns , https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns , https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
- HTTP/2 `POST /3/device/<token>` on `api.push.apple.com:443` (production) or `api.sandbox.push.apple.com` (development). A token is bound to an environment: a mismatch returns `BadDeviceToken`.
- Token auth: `.p8` key (P-256), JWT signed ES256, header `kid` (Key ID), claims `iss` (Team ID) and `iat`. Reuse a JWT: refresh no more often than every 20 min and before 60 min, else `TooManyProviderTokenUpdates` (429) / `ExpiredProviderToken` (403). The worker must cache the JWT.
- Headers: `authorization: bearer <jwt>`, `apns-topic` (bundle ID), `apns-push-type: alert`, optional `apns-priority`, `apns-expiration`, `apns-collapse-id`.
- Payload limit 4 KB.
- Token to delete: `410 Unregistered`; `400 BadDeviceToken` and `DeviceTokenNotForTopic` mean wrong environment/topic, so log with a Failure Reason and decide before deleting (a config error would otherwise wipe every token).
- Retry with backoff: 500/503, 429 `TooManyRequests`.

## FCM (not read)
Sources to read: https://firebase.google.com/docs/cloud-messaging/send-message , https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
- To confirm: HTTP v1 endpoint `POST https://fcm.googleapis.com/v1/projects/<project>/messages:send`, OAuth2 access token from the service account with the `firebase.messaging` scope, token deletion on `UNREGISTERED` (404), handling of `INVALID_ARGUMENT`, and the payload size limit.
- Legacy FCM API is, to my recollection, shut down: use v1 only. Confirm.

## Implications for the issue
- The `.p8` plus Key ID and Team ID, and the FCM service-account JSON, are Provider Secrets (ADR-0020); the Key ID/Team ID/bundle ID are config, not secrets.
- Store the environment (production vs sandbox) with each iOS token, or the pruning rule will misfire.
- Cache the APNs JWT in the worker; do not sign per send.
- Notification texts must stay generic (acceptance criterion); both providers see the text, so APNs/Apple and Google/FCM are sub-processors for the privacy register.
