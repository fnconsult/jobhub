# Research for issue #685: App session by magic link (`@better-auth/expo`, universal links, App Links)

Scope: only the external facts needed to implement issue #685. Fetched 2026-11-04. Each claim names its source. Items marked UNVERIFIED could not be confirmed against a primary source in this session and must be checked before relying on them.

## 1. `@better-auth/expo` and version alignment

Sources: https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/integrations/expo.mdx (Better Auth docs source, `main`); https://registry.npmjs.org/@better-auth/expo/latest

- Latest `@better-auth/expo` is 1.7.17 (published 2026-11-04). Its `peerDependencies` pin `better-auth: ^1.7.17` and `@better-auth/core: ^1.7.17`, plus `expo-secure-store >=12.5.0`, `expo-network >=8.0.7`, `expo-linking >=7.0.0`, `expo-constants >=17.0.0`, `expo-web-browser >=14.0.0`.
- The repo has `better-auth ^1.7.7` in `apps/web/package.json` and the lockfile resolves 1.7.7. So "versions aligned" means either bumping `better-auth` to a version that satisfies the Expo plugin's peer range, or installing an older `@better-auth/expo` whose peer range accepts 1.7.7. Decision for the implementer. Check the peer range of the chosen version with `npm view @better-auth/expo@<v> peerDependencies`.
- Server: `plugins: [expo()]` from `@better-auth/expo`. Client: `createAuthClient` from `better-auth/react` with `expoClient({ scheme, storagePrefix, storage: SecureStore })` from `@better-auth/expo/client`. `expo-network` is required on the client.
- The client plugin stores cookies in SecureStore and adds them to the headers of auth requests (docs: "Secure Cookie Management"). For calls outside the auth client (our own API routes), the docs show `authClient.getCookie()` and sending it as the `Cookie` header with `credentials: "omit"`. This matches the issue's "sent as session cookie, no bearer, no jwt": neither plugin is needed.
- Session data is cached in SecureStore by default so the app opens without a spinner. `disableCache: true` turns it off. Relevant to revocation: a cached session can show a signed-in UI until the next request; the AC says the app is logged out "at its next request", so do not rely on the cache for authorization.
- `cookiePrefix` (default `"better-auth"`) tells the client which server cookies to store. If our web config sets a custom cookie prefix, pass the same value to `expoClient` (UNVERIFIED against our config; check `apps/web` auth setup).

## 2. Trusted origins

Source: same Expo doc, "Scheme and Trusted Origins".

- The app scheme (for example `myapp://`) must be in server `trustedOrigins`; `app.json` needs `expo.scheme`. Wildcards (`myapp://*`) are supported. `exp://` patterns are for development only and must not be added in production. This fits the AC "nothing else is added" (gate dev entries on `NODE_ENV`, or leave them out).

## 3. Magic link behaviour

Source: https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/plugins/magic-link.mdx

- `signIn.magicLink({ email, callbackURL, newUserCallbackURL, errorCallbackURL })`. On click, the user is authenticated and redirected to `callbackURL`; on error, to `callbackURL` (or `errorCallbackURL`) with an `error` query parameter.
- Default `expiresIn` is 300 s. The token is consumed atomically on first use: any retry fails with `?error=INVALID_TOKEN`. `allowedAttempts` is deprecated and ignored.
- Consequence for the native flow: the verify URL is on the web origin (`https://jobbbox.ai/api/auth/magic-link/verify?...`). If the OS opens the app via a universal link / App Link, the app must call that verification itself exactly once; if a browser opens it first, the token is spent. Whether the plugin's verify step can be completed from the app (versus the browser completing it and redirecting to the `myapp://` scheme through `callbackURL`) is NOT documented on these pages: UNVERIFIED, to prototype. The Expo doc says a relative `callbackURL` is converted to a deep link by `Linking.createURL` for social sign-in; it does not say the same for `signIn.magicLink`.
- Magic-link sign-in on the Expo client is not documented in the Expo page that was fetched (only email/password and social). Treat the native magic-link round trip as the main implementation risk.

## 4. Android App Links

Source: https://developer.android.com/training/app-links/verify-android-applinks

- Verification applies to intent filters with action `VIEW`, categories `BROWSABLE` and `DEFAULT`, scheme `http`/`https`, and `android:autoVerify="true"` on at least one filter (Android 6.0+).
- For each host, Android fetches `https://<hostname>/.well-known/assetlinks.json`. On Android 11 and lower, the app becomes the default handler only if ALL hosts in the manifest verify; so `jobbbox.ai` and `staging.jobbbox.ai` in one build need both files valid.
- Android 15+ re-verifies periodically, with changes taking up to 7 days to propagate; Android 14 and lower only re-verify at install/update.
- Test with `adb shell pm verify-app-links --re-verify <package>` then `adb shell pm get-app-links <package>` (state `verified`).
- UNVERIFIED (not on the fetched page): the exact JSON shape (`relation: ["delegate_permission/common.handle_all_urls"]`, `target.namespace: "android_app"`, `package_name`, `sha256_cert_fingerprints`) and the Content-Type/redirect rules. Read https://developers.google.com/digital-asset-links/v1/getting-started before writing the file. The fingerprint must be the one of the signing key used for distribution (with Play App Signing, the Play-held key, not the upload key): confirm in the Play Console docs.

## 5. iOS universal links

Source attempted: https://developer.apple.com/documentation/xcode/supporting-associated-domains. The page is client-rendered and the fetch returned no body text, so everything below is UNVERIFIED (recalled, not read from Apple).

- File at `https://<domain>/.well-known/apple-app-site-association`, no extension, `application/json`, HTTPS, no redirects, no signature. Format with `applinks.details[].appIDs` (`<TeamID>.<BundleID>`) and `components`. App entitlement `applinks:<domain>` per domain (both `jobbbox.ai` and `staging.jobbbox.ai`). Apple's CDN caches the file; changes show up on install/update.
- To do before implementing: confirm against Apple's "Supporting associated domains" and the `apple-app-site-association` reference (the `components` path matcher for `/api/auth/magic-link/verify`, and whether query strings need matching).
- Universal links do not fire when the link is typed into Safari's address bar or opened from the same domain in some cases; a magic link from a mail client is the normal case. UNVERIFIED.

## 6. Open items for the implementer

1. Pick the `better-auth` / `@better-auth/expo` version pair (section 1).
2. Prototype the native magic-link round trip (section 3) before building the screen.
3. Obtain Apple Team ID, bundle ID, Android package name and release SHA-256 fingerprint (not in the repo as far as this research checked; ask the owner).
4. Serve both domain-association files from `apps/web` for both hosts, with the right content type and no redirect; verify with the `adb` commands above and on a real iPhone.
5. Privacy register entry: session token stored on device in Keychain/Keystore (already stated in the issue; no external fact needed).
