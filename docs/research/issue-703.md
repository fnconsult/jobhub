# Issue #703: crash reports in the EU, no personal data (research)

Scope: only the external facts needed to implement #703 (Sentry EU region, React Native SDK scrubbing, dev disable, ATT). No product code.

## 1. EU hosting (Sentry SaaS)
- Region is chosen when creating the organization ("Data Storage Location" = EU, stored at rest in Frankfurt). It cannot be changed later; switching means a new org with no data migration. Source: https://docs.sentry.io/organization/data-storage-location/
- In the EU region: error events, transactions, replays, releases, source maps, backups. In the US regardless of region: user accounts, org settings, DSN keys, project metadata, audit logs, access tokens. Same source. Consequence: the privacy-policy registry entry should mention that account/admin metadata is in the US while crash data is in the EU.
- The page does not state the DSN ingest host; read it from the project DSN (an EU org's DSN is expected to be an `ingest.de.sentry.io` host, unverified here). DSN must come from config (`dsn` option; if absent the SDK sends nothing). Source: https://docs.sentry.io/platforms/react-native/configuration/options/
- GlitchTip self-hosting is the alternative named in the issue; not researched (the SaaS EU route satisfies the criterion).

## 2. SDK and Expo setup
- Package `@sentry/react-native` (Expo SDK 50+), install with `npx expo install`; config plugin `@sentry/react-native/expo`; Metro config `getSentryExpoConfig`. Source maps upload during release builds needing `SENTRY_AUTH_TOKEN` (EAS secret), disable with `SENTRY_DISABLE_AUTO_UPLOAD=true`. Source: https://docs.sentry.io/platforms/react-native/manual-setup/expo/
- The Expo page's example uses `sendDefaultPii: true`; do NOT copy it.

## 3. What is collected by default and how to clean it
Source: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
- `sendDefaultPii` defaults to false; leave it false (no headers, cookies, user info).
- Not covered by that flag: request URL, referer and query string are always sent and may hold PII; console logs are sent as breadcrumbs; IP is inferred server-side (set `setUser({ip_address: '0.0.0.0'})` or disable in project settings, the latter not verified here).
- Screenshots / view hierarchy / replay are off by default; keep `attachScreenshot` false.
- `beforeSend(event)` can modify or drop the event; `beforeBreadcrumb(breadcrumb, hint)` drops a breadcrumb when it returns null. Source: options page above. Use `beforeSend` to strip `event.user`, `event.request.data`/`cookies`/`headers`, and credentials/query from URLs; this is the unit-testable function the acceptance criterion asks for.
- Breadcrumbs: touch (`ui.click`) breadcrumbs come from wrapping the root with `Sentry.wrap`; navigation from a navigation integration; HTTP by default. Drop `ui.click` and sanitise `http`/`fetch` URLs and `console` in `beforeBreadcrumb`. Example for dropping clicks is in the docs: https://docs.sentry.io/platforms/react-native/enriching-events/breadcrumbs/
- Gap: docs do not say whether touch breadcrumbs include input text. Safest: drop `ui.*` categories. Needs a check against the SDK source at implementation time.

## 4. Disabled in development
- `enabled` option (default true) controls sending, but docs say instrumentation overhead remains; to fully disable, call `Sentry.init` conditionally (e.g. skip when `__DEV__`). Source: options page.

## 5. No ATT prompt
- Apple's ATT prompt appears only when an app calls `ATTrackingManager.requestTrackingAuthorization`; `NSUserTrackingUsageDescription` is needed only for that. (Apple's page returned only a title via fetch; this is from general knowledge, verify at https://developer.apple.com/documentation/apptrackingtransparency.) Sentry's docs do not mention ATT, and nothing found suggests the SDK calls it. Implementation: do not add the usage-description key or any ATT/ads/analytics package; verify the built Info.plist lacks it.
- Sentry asks apps to include Apple's privacy manifest (the SDK ships one); declare crash data as not linked to the user and not used for tracking in App Store privacy labels.

## Open items to verify while implementing
1. Exact EU DSN host from the created project.
2. Whether the installed SDK version adds request bodies or input text to any breadcrumb (read SDK source/changelog).
3. IP-address handling server-side (project "prevent storing IP" setting).
