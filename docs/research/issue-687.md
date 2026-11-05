# Research: issue #687 (app OAuth sign-in, Sign in with Apple)

Scope: only the external facts needed to implement #687. Product code is out of scope.
Verification legend: **[verified]** read on the owner's page in this session; **[unverified]** came back from a summarising fetch that did not return the page text, or could not be fetched. Re-check the unverified items before shipping.

## 1. App Store rule 4.8 (why Apple is required) [verified]
Source: https://developer.apple.com/app-store/review/guidelines/ (4.8 Login Services).
- An app that uses a third-party or social login (Google Sign-In named) to set up or authenticate the user's primary account must also offer an equivalent login service that (a) limits data collection to name and email, (b) lets the user keep the email private, (c) does not collect app interactions for advertising without consent.
- Exemptions exist (own account system only, enterprise or education sign-in, etc.). None fits Jobbbox: Google and Microsoft are offered, so Apple is required.
- Implication: Apple must be shown wherever Google is shown on iOS. Note the Apple page text can change; re-read at submission time.

## 2. ASWebAuthenticationSession (iOS) [unverified: page body not returned]
Source to check: https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession
- Callback by custom URL scheme (`callbackURLScheme`). HTTPS callback (`Callback.https(host:path:)`) reported as iOS 17.4+ and requiring Associated Domains plus an apple-app-site-association file. The ADR allows "app scheme or universal link"; confirm the minimum iOS target before choosing the universal link.
- `prefersEphemeralWebBrowserSession` defaults to false (shares Safari cookies); decide deliberately.
- User dismissal yields `ASWebAuthenticationSessionError.canceledLogin` (code 1): map to the "cancelled" error state, not a failure.

## 3. Android Custom Tabs [partly verified]
Source: https://developer.android.com/develop/ui/views/layout/webapps/overview-of-android-custom-tabs [verified]
- Custom Tabs run in the user's preferred browser and share its cookie jar and state; the user returns to the app with the back button.
- The page says nothing about completing an OAuth redirect or detecting cancellation. Return is by intent filter (app scheme or App Link) on the app side, and closing the tab gives no callback by itself. [unverified, from general knowledge] Cancellation must be inferred (app resumes without a deep link), which the app UX has to treat as "cancelled".

## 4. Sign in with Apple REST/web flow [unverified: authorization page returned 404]
Source to check: Apple "Sign in with Apple REST API" > Request an authorization; Generate and validate tokens (page body not returned, summary only).
- Client secret is an ES256 JWT: iss = Team ID, sub = Services ID, aud = `https://appleid.apple.com`, kid = Key ID, `exp` at most 15,777,000 s (6 months) after `iat`. This matches the issue's "secret JWT already renewed by the worker"; the web flow needs a Services ID (not the bundle ID).
- Token endpoint: `https://appleid.apple.com/auth/token`.
- Commonly documented, to confirm on Apple's page: requesting `name` or `email` scopes forces `response_mode=form_post`, so Apple POSTs to the callback (the Better Auth callback must accept POST; cookies set `SameSite=Lax` are not sent on that cross-site POST, so state handling must not rely on them); the user's name is sent only on the first authorization; the redirect URI must be HTTPS on a registered domain and the Services ID must list that domain and exact return URL (no localhost, so staging needs its own registered URL).
- Apple's "Hide My Email" relay addresses are unverified-by-provider for linking purposes: check that the ADR-0011 trustedProviders decision for Apple matches (relay email will not match an existing account's email, so no automatic link).

## 5. Better Auth / Expo [not fetched]
better-auth.com was blocked by the session network policy (host must be allowed to verify). Not checked: `@better-auth/expo` social flow (it opens the web OAuth URL via expo-web-browser and returns by scheme), `trustedOrigins` needing the app scheme, and whether `idToken` sign-in is refused by configuration. The repo's own code and ADR-0011/0076 govern these; the refusal test is repo-internal.

## Summary of open checks before coding
1. Minimum iOS version vs HTTPS callback (universal link) support.
2. Apple form_post and SameSite behaviour with the existing callback route.
3. Apple Services ID return URLs for staging and prod.
4. Better Auth Expo docs once the host is allowed.
