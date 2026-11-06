# Issue #694: Mes coachs humains in the app (Stripe Checkout in the in-app browser)

Scope: only what implementing #694 needs. Checked on 2026-11-05. docs.expo.dev and docs.stripe.com were unreachable from the session (network allowlist), so Expo and Stripe points are UNVERIFIED and must be checked before coding.

## Apple App Store Review Guidelines (verified)
Source: https://developer.apple.com/app-store/review/guidelines/
- 3.1.3(d) Person-to-Person Services, verbatim: "If your app enables the purchase of real-time person-to-person services between two individuals (for example tutoring students, medical consultations, real estate tours, or fitness training), you may use purchase methods other than in-app purchase to collect those payments. One-to-few and one-to-many real-time services must use in-app purchase."
- Implication: a Coaching Session is exempt from IAP only while it stays real-time, one human coach to one candidate. Any group or recorded format would need IAP. The guideline does not say the payment page must open in an in-app browser rather than Safari; the issue's choice (`expo-web-browser`) is ours, not Apple's. The "Légal : stores" issue must confirm this reading before submission.
- 3.1.1(a): outside the US storefront, apps "may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase". That prohibition concerns digital goods and services; 3.1.3(d) is the carve-out for this service. This is why the app must show no Plan price and no Plan purchase (acceptance criterion): Plan subscriptions are not covered by 3.1.3(d).
- Only the first 100,000 of 114,428 characters were read; later sections not checked. The 3.1.3(d) detail page was not read.

## Stripe Checkout (UNVERIFIED here; from ADR-0016 and ADR-0074 in the repo)
- Repo decision (ADR-0016): the Coaching Session is recorded only from the signed webhook (`checkout.session.completed`, or `async_payment_succeeded`), never on the redirect. So the app's return to a universal link proves nothing: after return it must poll or refresh the list until the webhook has created the session, and show a waiting state meanwhile (matches the last acceptance test).
- To verify at https://docs.stripe.com/payments/checkout/custom-success-page : that `success_url` accepts an https universal-link URL on our domain, and the `{CHECKOUT_SESSION_ID}` template variable.
- To verify: Checkout Session expiry (default 24h) for an abandoned in-app browser; delayed payment methods may leave the session paid later than the return.

## expo-web-browser and universal links (UNVERIFIED here)
- Repo only: `@better-auth/expo` lists `expo-web-browser` as a peer dependency (docs/research/issue-685.md), so it is probably already installed.
- To verify at https://docs.expo.dev/versions/latest/sdk/webbrowser/ : `openBrowserAsync` resolves with `{type: 'cancel' | 'dismiss' | 'opened'}` and does not carry the final URL; `openAuthSessionAsync` returns the redirect URL but is built for custom-scheme or https redirects through ASWebAuthenticationSession (iOS) / Custom Tabs (Android). Decide which one fits: a universal link tapped from SFSafariViewController may or may not hand off to the app; do not assume it does.
- Universal link setup (AASA file, Android assetlinks) is covered by docs/research/issue-688.md. The return route must be in the paths that file declares.
- Safe design regardless of the answers: treat browser dismissal as "maybe paid", always refresh from the API, and never trust the return URL query string.

## Cal.com (not needed)
The Human Coach's Cal.com booking link is a stored URL shown after the session exists; no Cal.com API is called by this issue. Open it with `Linking.openURL` / the in-app browser.

## Open points for the implementer
1. Confirm in the "Légal : stores" issue that 3.1.3(d) applies (one-to-one, real time) before submission.
2. Verify the three UNVERIFIED Expo/Stripe points above once docs.expo.dev and docs.stripe.com are allowed in the session network settings.
3. Choose `openBrowserAsync` plus polling vs `openAuthSessionAsync`; test the return on a real iOS device and an Android device.
4. Withdrawal WebView reuses the cookie rules in docs/research/issue-689.md.
