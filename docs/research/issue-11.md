# Research for issue #11: Extension sign-up / sign-in sharing the web session

Scope: only the external facts the issue depends on (ADR-0011: extension shares the web app's Better Auth session cookie). Checked 2026-10-08 against first-party docs, read through a page summariser, so quotes are paraphrased. Product code is out of scope.

## 1. Extension requests and the web app's cookie

Source: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Extension service workers and extension pages may reach other origins when the extension holds host permissions for them. Access is per host and per scheme (http and https declared separately).
- Content scripts are always treated as cross-origin, even with host permissions. Requests to the web app must therefore be made from the background/extension pages, not from content scripts.
- NOT verified: that the page says anything about cookies, `fetch` `credentials`, or SameSite. It does not. The claim in `wxt.config.ts` ("lets the browser send the web app's session cookie") is not backed by this page. Verify empirically (extension fetch with `credentials: "include"` to the web app, in Chrome and Edge) before relying on it.

## 2. SameSite

Source: https://developer.chrome.com/docs/extensions/reference/api/cookies
- Only describes the cookie `sameSite` values (`no_restriction`, `lax`, `strict`, `unspecified`). Nothing found on how SameSite applies to extension-origin requests.
- NOT verified: whether a `SameSite=Lax` session cookie is sent on a `fetch` from the extension origin to the web app. This is the main risk for "sharing the web session". If it is not sent, options are the `cookies` permission (needs a `cookies` entry in `permissions`; `getAll` only works for hosts in host permissions) or `SameSite=None; Secure` (HTTPS only). Test before choosing.

## 3. Better Auth trusted origins and CSRF

Source: https://www.better-auth.com/docs/reference/options
- `trustedOrigins` defaults to the `baseURL` origin; accepts a static array, a function, or wildcards (`*`, `**`, `?`). Custom schemes such as `myapp://` are documented; a host-less scheme entry trusts every host under it.
- `chrome-extension://` is NOT documented. Confirm with a test that a request carrying `Origin: chrome-extension://<id>` passes. Prefer listing the exact extension origin(s) over a bare scheme.
- Cookies are `Secure` by default in production; `advanced.useSecureCookies` forces it everywhere. The SameSite default is not documented on this page.
- CSRF protection uses Origin validation and Fetch Metadata checks; `disableCSRFCheck` turns them off (do not use). How `trustedOrigins` feeds the check is implied, not stated. Test it.
- Local dev is `http://localhost:3000` (no `Secure`), production HTTPS: behaviour may differ between the two.

## 4. Not checked

- Google sign-in launched from the extension (Google OAuth redirect and `chrome.identity`): not researched. ADR-0011 avoids it by signing in on the web app; if the issue needs in-extension Google sign-in, check Google's OAuth policy for embedded/extension flows first.
- Extension ID stability (unpacked vs Chrome Web Store vs Edge Add-ons have different IDs), which affects the trusted-origin list.
- Third-party cookie phase-out and partitioning effects on extension requests.

## Summary for implementation

1. Make web-app calls from the background, not content scripts.
2. Before building, run a spike: extension `fetch` with credentials to the web app with a Better Auth session, in Chrome and Edge, local and HTTPS.
3. Add exact `chrome-extension://<id>` origins to `trustedOrigins` and test them.
4. Keep Guest-to-Candidate migration (CV, Job Offer) as internal logic; no external facts involved.
