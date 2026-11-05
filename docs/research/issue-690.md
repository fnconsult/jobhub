# Research for issue #690: native Coach Conversation (NDJSON stream, Stop, screen-reader announcement)

Scope: only the external facts needed for #690. Fetched 2026-11-05. The `/api/coach` contract itself is internal (ADR-0035/0036/0070) and out of scope. Items marked UNVERIFIED must be checked on a device before relying on them.

## 1. Streaming a response body in the Expo app

Source: https://raw.githubusercontent.com/expo/expo/main/docs/pages/versions/unversioned/sdk/expo.mdx (Expo docs source, `main`).

- `expo/fetch` is a WinterCG-compliant Fetch that supports streaming: the doc example does `const reader = resp.body.getReader()` and loops on `reader.read()` with `{ done, value }` (Uint8Array chunks), passing `headers: { Accept: ... }`. So `Accept: application/x-ndjson` and incremental reading are supported.
- On Android and iOS `expo/fetch` is also the global `fetch`, unless `EXPO_PUBLIC_USE_RN_FETCH=1` is set. Import `fetch` from `expo/fetch` explicitly to be independent of that flag.
- `TextDecoderStream`, `ReadableStream`, `TransformStream` are available globally on native, so `pipeThrough(new TextDecoderStream())` is possible.
- Implementation consequence: NDJSON framing is ours. Chunks are arbitrary byte slices, so buffer text and split on `\n`, keeping the trailing partial line for the next read (this is what the "partial events" test must cover). Decode with a streaming decoder (`new TextDecoder().decode(v, { stream: true })`) so multi-byte characters split across chunks are not corrupted.
- UNVERIFIED: the doc does not state the `signal` (AbortController) behaviour of `expo/fetch`. "Arrêter" in the issue sends a Stop to the server (web behaviour); whether to also abort the local request, and that `abort()` rejects `reader.read()` cleanly on iOS and Android, must be tested on both. Also not documented: the cookie header handling; per #685 research, send the session cookie manually with `credentials: "omit"`.

## 2. Screen-reader announcement once the reply is finished

Sources: https://raw.githubusercontent.com/facebook/react-native-website/main/docs/accessibilityinfo.md and https://raw.githubusercontent.com/facebook/react-native-website/main/docs/accessibility.md (React Native docs source, `main`).

- `AccessibilityInfo.announceForAccessibility(announcement: string)` posts a string to be announced by the screen reader (iOS VoiceOver and Android TalkBack). `announceForAccessibilityWithOptions(announcement, { queue?, priority? })`: by default an announcement interrupts current speech; `queue` and `priority` (`low|default|high`) are iOS only.
- `accessibilityLiveRegion` (`none|polite|assertive`, Android) / `aria-live` make TalkBack read a view when it changes. Putting it on the streaming text would announce every update, the opposite of the AC.
- Implementation consequence: do not mark the streaming bubble as a live region. Render it without live-region props while streaming, and call `announceForAccessibility(finalText)` once on the terminal event (or announce a short "réponse reçue" and let the user read the bubble). Check `AccessibilityInfo.isScreenReaderEnabled()` before announcing.
- UNVERIFIED: how long text is handled by VoiceOver/TalkBack (truncation, interruption by focus changes); test on devices.

## 3. Not needed

`@jobhub/help` is an internal workspace module; Work Pane, Context bar and Plan Quota are internal. No third-party API, provider or regulation beyond the above affects this issue.
