# The extension lives in the browser's Side Panel, not in a popup

The extension's popup closes as soon as the person clicks the job posting, so reading an offer and scoring it against a Profile means going back and forth. Decided in the visual UI grilling (2026-10-27, ADR-0053): the extension becomes a pane docked to the right of the page, like the Claude and ChatGPT extensions.

- **Built on the browser's own side panel API** (`chrome.sidePanel` in Chrome and Edge). It stays open from tab to tab and follows the posting in view.
- **The popup goes.** The toolbar icon opens the Side Panel, and so does the « Analyser cette offre » badge on a Job Site's posting.
- **It uses the Design System** in the Confort Density, with the shared tokens and its simple components.
- **Firefox comes later**, through its own sidebar (`sidebar_action`).

## Considered Options

- **A panel injected into the page (iframe)**: it works in any browser, but it breaks on some sites, fights their CSS and covers their content.
- **Keep the popup**: it closes on every click in the page.
