# Hardware shortcuts come from a local Expo module and the context menus are drawn in JavaScript

Status: accepted (#700, PR #737). Builds on ADR-0076.

The Jobbbox app on a tablet answers a connected keyboard and a pointer. The system lists shortcuts itself (the iPad ⌘ panel, Android's Keyboard Shortcuts Helper) only if they are registered natively, with a title, so a JS key listener is not enough.

- **A local Expo module, `apps/mobile/modules/key-commands`.** On iOS one `UIKeyCommand` per shortcut on the root view controller, with its title; on Android the activity's window callback takes the keys first and fills the helper. No third-party library: none we found lets a screen withdraw a shortcut, and a dependency on the root view controller is ours to keep working across Expo upgrades.
- **A screen offers a shortcut only while it can carry it out** (`useKeyCommand(id, run | null)`); only offered ones are registered, so the panel shows what the page can do now. When two screens offer the same one, the last wins and the earlier gets it back when it withdraws.
- **Titles are in the shared catalogues** (`mobile.shortcuts.*`, FR and EN), like every label.
- **The context menus are drawn in JS**, one component for the rows, with the same actions offered as accessibility actions. Pointer hover uses React Native's W3C pointer events.
- **Échap leaves the Fiche column open**: only the Top Bar's « Fiche » (and ⌘I) opens and closes it.
- **Not proven yet**: the Swift and Kotlin were never compiled nor run on a device when this was written. On-device checks belong to #705 (Maestro).

## Considered Options

- **A third-party keyboard-shortcuts library**: rejected: no withdrawing of a shortcut, and a native dependency we would not control.
- **A JS key listener only**: rejected: nothing in the system's shortcuts panel, which is how a person finds them.
- **Native `UIMenu` and Android popup menus**: rejected for now: two implementations to keep alike, and the menus are three short actions; revisit if the actions grow (« Renommer », « Supprimer » wait for #690).
