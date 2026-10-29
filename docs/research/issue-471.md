# Research for #471: Extension in the browser's Side Panel

Checked 2026-10-28, only what implementation needs. Scope: `chrome.sidePanel` on Chrome and Edge (Firefox is out of scope).

## 1. Manifest
Source: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Add `"sidePanel"` to `permissions`. Declare `"side_panel": { "default_path": "sidepanel.html" }` (relative path inside the extension) to show the same panel on every site.
- Minimum: Chrome 114, MV3. Edge's guide shows the same two manifest keys (https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/sidebar), so one MV3 build serves both.
- WXT (https://wxt.dev/guide/essentials/entrypoints.html): `entrypoints/sidepanel/index.html` is the Side Panel entrypoint; "In Chrome, side panels use the `side_panel` API, while Firefox uses the `sidebar_action` API." The doc does not say whether WXT adds the `sidePanel` permission or emits `side_panel.default_path`. Verify in the built manifest; add `sidePanel` to `permissions` in `wxt.config.ts` if missing.
- Removing `entrypoints/popup` removes `action.default_popup` (WXT's Popup entrypoint is what generates it). Keep an `action` key (Edge's guide declares `action` with `default_title` for the toolbar-icon flow).

## 2. Opening the panel
Sources: Chrome sidePanel reference above; Edge sidebar guide above.
- Toolbar icon: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. Default is `false`; the call is an upsert. Call it from the service worker (Edge's sample does so at top level with a `.catch`).
- Badge click: the badge is a content script, so it must message the background, which calls `chrome.sidePanel.open({ tabId })` or `{ windowId }`. `open()` (Chrome 116+) "may only be called in response to a user action"; valid triggers include a user gesture on an extension page or content script. At least one of `tabId`/`windowId` is required. `windowId` opens a global panel; `tabId` opens for that tab and overrides the active panel there.
- Open question: the docs do not say whether a user gesture in a content script survives a `runtime.sendMessage` hop to the service worker. Test it in the extension tests and in a real browser; the fallback is to open the panel from the content script's gesture only if the browser allows it, otherwise the badge is a prompt and the toolbar icon opens the panel.
- With a popup set, `action.onClicked` never fires (https://developer.chrome.com/docs/extensions/reference/api/action: "This event will not fire if the action has a popup."). Another reason `default_popup` must go.

## 3. Staying open and following the tab
- The panel stays open across tab switches when it is a global panel (default `path`, `enabled` true). If the user lands on a tab where it is disabled, it hides, and returns on a tab where it was open. A navigation to a disabled site closes it.
- The panel page is one extension page; it does not reload per tab. It must itself follow the posting in view: listen to `tabs.onActivated`, `tabs.onUpdated` (and `windows.onFocusChanged`) from the panel or relay from the background, then re-read the active tab. The docs give no event telling a panel that the active tab changed; this is on us.
- Edge known issue: the sidebar "is not automatically displayed again when the user switches to a tab in which the sidebar was previously open" (https://github.com/microsoft/MicrosoftEdge-Extensions/issues/142, cited by the Edge guide). Do not rely on re-show; the panel state must be recoverable from the active tab on open.
- A 2023 Microsoft Q&A thread reports "API Unavailable" on Edge 115 (unverified lead, old). Target current Edge and test there.

## 4. Events and extras (version-gated, optional)
- `sidePanel.onOpened` (Chrome 141+), `onClosed` (142+), `close()` (141+), `getLayout()` (140+; side left/right is the user's choice). Do not depend on them: Edge support is not documented. Edge's guide says all Edge-supported extension APIs are available in the panel, and defers to Chrome's reference for method details without version numbers.
- Chrome 148 documents a standardized `browser.*` namespace; this repo uses `chrome.*` (WXT). No change needed.

## 5. Implications for implementation
1. Manifest: `side_panel` via the WXT `sidepanel` entrypoint, `sidePanel` permission, no `default_popup`. Test on the built manifest.
2. Background: `setPanelBehavior({ openPanelOnActionClick: true })` at startup; a message handler for the badge calling `sidePanel.open`.
3. The panel reads the active tab's posting on load and on tab events; it does not assume one panel per tab.
4. Guest state lives in `storage.session` (already so); the panel is a longer-lived page than a popup, so keep reading from storage rather than panel memory.
5. Test seams: fake `chrome.sidePanel` (`open`, `setPanelBehavior`) in extension tests; real Chrome and Edge smoke check for the badge gesture question in section 2.

## Not verified
Edge-specific minimum versions; gesture propagation from content script through the background; how WXT emits the manifest keys.
