# Research for issue #697: Share capture

Scope: only the external facts needed to implement issue #697. Fetched 2026-11-05. Items marked UNVERIFIED could not be checked against a primary source in this session (hosts outside the session's allowed network: www.linkedin.com, www.indeed.com, docs.expo.dev, so they must be allowed to finish the check).

## 1. Android: receiving a share

Source: https://developer.android.com/training/sharing/receive

- Declare an `<intent-filter>` on the activity with action `android.intent.action.SEND`, category `DEFAULT`, and `<data android:mimeType="text/plain"/>`. A URL shared from a browser or app arrives as `text/plain`.
- The URL and/or text is read from `Intent.EXTRA_TEXT`. A shared page's title may come separately (subject extra); a shared text can contain both a sentence and a URL, so the app must extract the URL from `EXTRA_TEXT` itself. (Last part is implementation inference.)
- Google says to let the user confirm and edit shared text before the app uses it: matches the issue's capture screen.
- Check incoming data defensively (wrong MIME type possible). Avoid `*/*`.
- The Sharesheet uses the icon and label from the `application` tag (API 29+), not from the intent filter.

## 2. iOS: share extension

Source: https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html (archive page)

- A share extension receives the user's text and attachments (links, images, videos) through `extensionContext` (`NSExtensionContext`).
- Supported types are declared in the extension's `Info.plist`. The page does not list the keys. UNVERIFIED against the "Declaring Supported Data Types" page: `NSExtensionActivationRule` with `NSExtensionActivationSupportsWebURLWithMaxCount` and `NSExtensionActivationSupportsText`. Check before implementing.
- A share extension is a separate target, so hand-off to the main app (App Group or deep link) must be designed; the extension should not call our API with the session itself unless the Keychain is shared. UNVERIFIED, implementation question.

## 3. Expo support

UNVERIFIED (docs.expo.dev unreachable). `expo-sharing` is documented for sending. Receiving a share on Expo needs a config plugin or a third-party library (and EAS builds, not Expo Go); the choice must be checked against current Expo docs and the SDK 56 pin in ADR-0076.

## 4. LinkedIn and Indeed refusal

UNVERIFIED (robots.txt and terms unreachable). The issue and ADR-0002/0076 already assume they refuse server reads; the design (text fallback) holds either way, since the server applies ADR-0002 rules at runtime rather than hard-coding hosts. Do not hard-code the refusal list from memory.

## 5. Implications for the plan

- Both platforms deliver URL and/or text; parse a URL out of mixed text.
- The "read the URL" path is entirely server-side under ADR-0002; nothing external is required beyond the existing job discovery rules.
- Open items before coding: iOS activation-rule keys, Expo receiving mechanism, extension-to-app hand-off.
