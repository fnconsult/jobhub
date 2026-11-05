# Issue #689: WebViews with the session cookie, and native acceptance of Legal Texts

Scope: only what is needed to implement the WebView and cookie restriction, outbound links, and Account deletion reachability. Checked on 2026-11-05. docs.expo.dev and better-auth.com were unreachable from the session (network allowlist), so the Expo and Better Auth points rely on `docs/research/issue-685.md` and the repo, and are marked UNVERIFIED.

## Apple App Store Review Guidelines
Source: https://developer.apple.com/app-store/review/guidelines/
- 5.1.1(v): "If your app supports account creation, you must also offer account deletion within the app." Detail page linked from the guideline: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion . The text does not say the flow must be native, nor how many taps are allowed. The "three gestures" in the issue is our own bar, not Apple's. A deletion flow in a WebView is therefore not excluded by the guideline text (not read: the detail page; verify before submission).
- 3.1.1 / 3.1.3: outside the US storefront, apps "may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase" without an entitlement (3.1.1(a)). The US storefront is exempt. Implication: the subscription WebView must show the Plan and « Gérer mon abonnement sur jobbbox.ai » with no price and no purchase call to action, as the issue says; a link to jobbbox.ai for managing a subscription still risks review under 3.1.1(a)/3.1.3 on non-US storefronts. Confirm with the ADR-0076 decision on the Reader/External Link entitlement; the guideline text alone does not settle whether a "manage" link without price counts as a call to action.
- Only first 100,000 of 114,428 characters were read; later sections (5.2 onward) not checked.

## react-native-webview (props)
Source: https://github.com/react-native-webviews/react-native-webview/blob/master/docs/Reference.md and Guide.md
- `originWhitelist` (iOS, Android, macOS): origins not in the list "will be handled by the OS". Default `["http://*", "https://*"]`. It matches origin only, wildcards allowed. Usable as the host allowlist (`https://jobbbox.ai`, plus `https://staging.jobbbox.ai` on the staging channel). Caveat: it governs user navigations; the docs do not say it covers redirects or iframes, so do not rely on it alone.
- `onShouldStartLoadWithRequest` (iOS, Android, macOS): return `false` to stop a load. "On Android, is not called on the first load." Request fields include `url`, `target`, `navigationType` (iOS), `isTopFrame` (iOS). Use it to check the host (parse the URL, compare host exactly, never `startsWith` on a string prefix such as `https://jobbbox.ai.evil.com`) and call `Linking.openURL` for anything else. The docs' example uses `startsWith`; that is unsafe for our case.
- `sharedCookiesEnabled` (iOS, macOS): default `false`; uses `NSHTTPCookieStorage.shared` for every load request.
- `thirdPartyCookiesEnabled` (Android): default `true`. Set `false` to avoid cookies for embedded third parties.
- `incognito`: clears the cookies it created (the Android profile variant clears that profile's cookies). Not a logout substitute.
- Cookie injection, per Guide.md "Managing Cookies": either set cookies with `@react-native-cookies/cookies` plus `sharedCookiesEnabled`, or send `source.headers.Cookie`. "these cookies will only be sent on the first request unless you use the technique ... for setting custom headers on each page load". So a header-only cookie does not persist across in-page navigations: the cookie must live in the WebView cookie store for a real session.
- Not documented in these sources: clearing WebView cookies on sign-out. Per the Reference, an `incognito`/cache-clearing prop exists but no per-domain cookie delete for the WebView jar; `@react-native-cookies/cookies` (`clearAll`, `clearByName`) is the documented route (its docs were not read: UNVERIFIED).

## Better Auth Expo client (from docs/research/issue-685.md, not re-read)
- The client keeps the cookie in SecureStore and `authClient.getCookie()` returns the header string; it is stored in a custom format, so it must be parsed before being set as a real cookie in the WebView jar (UNVERIFIED).
- Check the cookie name (`cookiePrefix`, `useSecureCookies`, `advanced.cookies`) in `apps/web/src/auth/index.ts` before writing the cookie: it must match exactly, with `Secure`, `HttpOnly` and the host-only domain `jobbbox.ai` (or `staging.jobbbox.ai`). A cookie scoped to a parent domain would reach both hosts; the issue wants the exact channel host only.

## Open points for the implementer
1. Real cookie jar needed on iOS and Android (header injection is first-request only); decide on `@react-native-cookies/cookies` and check Expo SDK 58 compatibility (config plugin / dev client; it is not in Expo Go).
2. Sign-out must clear the WebView jar for the host, tested.
3. Host check must compare parsed hosts, not string prefixes.
4. Subscription screen wording and storefront risk (3.1.1(a)) to be confirmed against ADR-0076 before store review.
