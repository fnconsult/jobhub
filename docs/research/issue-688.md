# Research for issue #688: native second step (app code, passkey, backup code)

Scope: only the external facts needed to implement #688. Fetched 2026-11-04. Each claim names its source. UNVERIFIED means not confirmed against a primary source in this session.

## 1. Android passkeys (Credential Manager + Digital Asset Links)

Sources: https://developer.android.com/identity/credential-manager/prerequisites ; https://developer.android.com/identity/passkeys/create-passkeys

- Digital Asset Links are required for passkeys. `assetlinks.json` must carry BOTH relations for the app: `delegate_permission/common.handle_all_urls` (App Links, already served by #685) and `delegate_permission/common.get_login_creds` (credential sharing). Today `apps/web/src/native-app/domain-association.ts` emits only `handle_all_urls`: add `get_login_creds` to the same entry.
- Served at `https://<domain>/.well-known/assetlinks.json`, HTTP 200, `Content-Type: application/json`, no 301/302 redirect. `robots.txt` must allow `/.well-known/`.
- Each host that signs in (`jobbbox.ai`, `staging.jobbbox.ai`) needs its own file with the fingerprints of the signing cert; debug and release builds need their own entries (distinct package name or fingerprint).
- The manifest needs `<meta-data android:name="asset_statements" android:resource="@string/asset_statements" />`, required by the doc for passwords; the doc's passkey path only lists the `assetlinks.json` file. Whether passkeys alone need the `asset_statements` include: UNVERIFIED. Adding it is harmless.
- Target Android 9 (API 28)+. Use `androidx.credentials:credentials` and `credentials-play-services-auth` (doc shows 1.7.0-alpha03; "use the latest"); versions below 1.2 crash on Android 14.
- Assertion (sign in) is `credentialManager.getCredential()` with `GetPublicKeyCredentialOption(requestJson)`; the response is a `PublicKeyCredential` JSON to send to the server. Page fetched covered creation; the sign-in page (https://developer.android.com/identity/passkeys/sign-in-with-passkeys) was NOT read: UNVERIFIED for the exact request shape.
- Server-side origin: on Android the WebAuthn client-data origin is `android:apk-key-hash:<base64url(sha256 cert fingerprint)>`, not `https://jobbbox.ai`. The server must allow-list it, one per signing cert (debug, release, Play App Signing key). The RP ID stays the web host (`rp.id`).

## 2. iOS passkeys (associated domains `webcredentials`)

Sources attempted: https://developer.apple.com/documentation/xcode/supporting-associated-domains and https://developer.apple.com/documentation/authenticationservices/supporting-passkeys. Both pages are client-rendered; the fetch returned no body. Everything below is UNVERIFIED (recalled, not read from Apple) and must be checked on the live pages or in a browser.

- Entitlement `com.apple.developer.associated-domains` with `webcredentials:jobbbox.ai` (and `webcredentials:staging.jobbbox.ai` for the Beta build). `?mode=developer` bypasses Apple's CDN for development only; remove for release.
- File `https://<domain>/.well-known/apple-app-site-association`, HTTPS, no redirect, `application/json`, content `{"webcredentials":{"apps":["<TeamID>.<BundleID>"]}}`. The existing file from #685 only has `applinks`: add the `webcredentials` key to the same JSON. Apple's CDN caches it; changes arrive on install/update.
- Passkeys through AuthenticationServices need iOS 16+ (UNVERIFIED). Assertion via `ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier:)` + `createCredentialAssertionRequest(challenge:)`.
- In Expo the entitlement goes in `app.json` `ios.associatedDomains`. A native module is needed for the call itself (no first-party Expo passkey API was checked): choice of library UNVERIFIED, to pick by checking the maintained options and their Expo config plugin support.

## 3. Better Auth server side (what the web already uses)

Sources: https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/plugins/passkey.mdx ; .../plugins/2fa.mdx

- Passkey plugin `origin` option: "The origin, or list of origins, where passkey registration and authentication run". Defaults to the `baseURL` origin. A native assertion carries an `android:apk-key-hash:...` origin, so it is rejected unless added to `origin`. On iOS the origin is the RP's `https://` origin (UNVERIFIED). Our repo verifies with a single `expectedOrigin` (`apps/web/src/two-step-verification/passkeys.ts` lines 9-18, 57): that needs to accept a list for the Android origin.
- Passkey + Expo: challenge cookie `better-auth-passkey` starts with `better-auth`, so the default `expoClient` cookie handling stores it; only a custom `webAuthnChallengeCookie` requires matching `cookiePrefix`. The app must send the challenge cookie back with the verify call (the Expo client does so for auth-client calls).
- 2FA: sign-in answers `twoFactorRedirect: true` and `twoFactorMethods` (e.g. `["totp","otp"]`) to choose the UI. TOTP default period 30 s. The repo's own gate (ADR-0075) may differ from the plugin's flow: read the code before assuming plugin endpoints.
- Stock plugin docs do not state attempt limits: the AC "same limits as web" is a matter of calling the same endpoints (nothing to research externally).

## 4. Open items for the implementer

1. Read Apple's two pages in a real browser and confirm section 2; pick an iOS/Android passkey module for Expo and check its Expo config plugin and minimum OS.
2. Extend `domain-association.ts` (both files) and add `get_login_creds`; keep no-redirect and JSON content type; update its tests.
3. Make the passkey verify accept the Android `apk-key-hash` origin(s) derived from `ANDROID_CERT_SHA256` and keep the pending-session ownership check (key must belong to the pending account).
4. Needs from the owner: Apple Team ID, bundle ID, release and Play App Signing SHA-256 (same as #685).
5. Real-device test on iOS and Android: simulators and emulators cannot confirm the association files.
