# Issue #700: Tablets, hardware keyboard shortcuts, pointer and context menus, multitasking

Scope: only the platform facts needed to implement #700 in `apps/mobile` (Expo, React Native). Checked 2026-11-04. Network in the research session blocked docs.expo.dev and reactnative.dev (DNS failure; both must be allowed in the session's network settings to finish). "Not verified" means no primary source could be read; confirm before coding.

## Verified in this repo
Sources: `apps/mobile/app.json`, `apps/mobile/package.json`, `docs/adr/0076*`
- Expo ~58, React Native 0.88.1, Expo Router. `ios.supportsTablet: true`, no `UIRequiresFullScreen` set (good: the AC asks for no `requiresFullScreen`).
- `ios.infoPlist.UISupportedInterfaceOrientations` is Portrait only. ADR-0076 wants every orientation on tablets and portrait only on phones, so this must change (iPad needs all four orientations for multitasking; per-device split is via `UISupportedInterfaceOrientations~ipad`, not verified here). `"orientation": "default"` is set. `expo-screen-orientation` is already a dependency.
- No keyboard-shortcut, context-menu or pointer library is installed.

## Android hardware keyboard (primary source read)
Source: https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/commands
- Key events come from `KeyEvent.Callback` on `Activity`/`View` (`onKeyDown`/`onKeyUp`); use `onKeyUp` to get one event per press. Expect events only from a hardware keyboard.
- Modifiers are read from the `KeyEvent` (`isCtrlPressed()`, `isShiftPressed()`, `getModifiers()`), so Ctrl+key shortcuts are plain key events.
- The system "Keyboard Shortcuts Helper" lets users search the shortcuts an app offers (page linked from the source above; its registration API was not read).

## Not verified (needs docs.expo.dev, reactnative.dev, developer.apple.com reachable)
- iPad: whether React Native 0.88 / Expo 58 exposes `UIKeyCommand` (the ⌘-hold overlay with French `discoverabilityTitle`s) natively. Apple's page fetch returned only a model summary, not the page text, so these are unconfirmed: `UIKeyCommand` `discoverabilityTitle` is what the overlay shows; `wantsPriorityOverSystemBehavior` exists from iOS 15. Likely needs a local Expo module (matches the issue's "module de commandes clavier"); check for an existing Expo/RN API first.
- Context menus (long press / right click) and hover: whether a maintained Expo-compatible library exists for iOS `UIContextMenuInteraction` and Android, and RN `Pressable` hover support. Not checked.
- Multitasking: Split View / Slide Over / Stage Manager behaviour with `UIRequiresFullScreen` absent, and `useWindowDimensions` updating on window resize. Not checked.
- Foldables: Android `resizeableActivity` / `configChanges` for fold/unfold keeping state. Not checked.

## Implications for the issue
- Android Ctrl shortcuts can be handled with ordinary key events; iPad shortcuts with labels in the ⌘ panel are the unresolved risk and probably need native code.
- Drop the Portrait-only `UISupportedInterfaceOrientations` on iPad.
- Verify the open items above before implementation starts.
