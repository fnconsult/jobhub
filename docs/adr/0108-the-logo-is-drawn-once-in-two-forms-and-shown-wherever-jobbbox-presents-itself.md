# The logo is drawn once, in two forms, and shown wherever Jobbbox presents itself

ADR-0105 gave Jobbbox its logo, « La boîte qui répond », but wired it only into the public shell and the favicons. #988 puts it on every other surface: the Sidebar, the sign-in stage, the error pages, the emails, the extension, the app and the store listings. Decided with the product owner on 2026-11-17.

- **One source draws it**: `packages/shared/src/logo.ts` (`@jobhub/shared/logo`) holds the shape and the colours. `logoSvg` draws the symbol in two forms, `symbol` (full, from 40 px) and `small` (below 40 px, flat, the offer outlined so it keeps its shape on a white toolbar); `logoIconSvg` draws icon tiles, maskable icons and the one-colour Android 13 icon. The web's `Logo.tsx` and the app's `ui/Logo.tsx` take their shape from it; the files (`public/brand`, the extension's icons, the app's icons and store graphics) are drawn by script, not by hand. A test checks the symbol's contrast is at least 3:1 on both backgrounds.
- **The Sidebar carries the symbol and the name**; collapsed on a wide screen, the Top Bar carries the symbol alone, named by the brand label. Inside the app the symbol never repeats elsewhere.
- **`/brand` is a public, untracked path**, open during the second sign-in step and during maintenance, like the manifest and the favicons. The self-contained pages (maintenance, the proxy's fallback pages) draw the small form inline.
- **Emails carry one image, the logo, the same for every recipient** (hosted PNG at 2x, `alt="Jobbbox"`). This amends ADR-0053's « no image » rule for emails: it tracks nothing, and the « tracks nothing » tests allow exactly this image.
- **The web manifest's theme colour is the accent.**
- **The beta extension's mark is the logo with an orange β.**
- **The app has a splash screen**, light and dark, through `expo-splash-screen`: a native change, so it needs a store build.

## Considered Options

- **The full symbol at every size**: the offer's white sheet disappears on a white toolbar at 16 px.
- **A remote logo for the extension and the app**: the icons must work offline and in the stores' review.
- **Hand-drawn files**: they drift from the symbol; scripts redraw all of them from one source.
