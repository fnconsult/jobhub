# The app's magic link points at a web page the app claims, and the app verifies the token itself

_Builds on ADR-0076 (the native app on Expo, same session) and ADR-0011 (Candidate accounts on Better Auth)._

Better Auth's verify address uses up the magic-link token in whatever opens it. If that were a browser handing the person back to the app by a redirect, the browser would hold the session and the app would get nothing. So the email asked from the app carries `https://<host>/connexion/app?token=…` instead, an **App sign-in link**.

- **The app claims `/connexion/app` only**, by universal link (iOS) and App Link (Android) for `jobbbox.ai` and `staging.jobbbox.ai`. The Domain association files are served by the web from each environment's `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256`; empty, they answer 404 and the link opens the web.
- **Opened in the app, the app verifies the token itself, once**, and `@better-auth/expo` keeps the session cookie in the Keychain or Keystore. Opened in a browser, `/connexion/app` redirects to the normal verify and signs in on the web. The web's own magic link is unchanged.
- **`jobbbox://` is the only origin added** to the trusted ones; no bearer or JWT plugin. A session pending its second step (ADR-0075) can still reach the association files and `/connexion/app`.

## Considered Options

- **Better Auth's verify address with a redirect back into the app**: the token is spent in the browser, and the system browser's cookies are not the app's.
- **A custom-scheme link only (`jobbbox://`)**: any app can claim a scheme, and the link does nothing when the app is not installed.
- **The 6-digit code only**: kept for a person reading their email on a computer (ADR-0076), too slow as the only path on a phone.
