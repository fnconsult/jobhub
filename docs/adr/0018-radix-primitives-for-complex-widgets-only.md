# Unstyled Radix primitives for complex widgets only, styled with our tokens

Complex widgets (dialog, dropdown menu, popover, tabs) are built on unstyled Radix primitives (`@radix-ui/react-*`) in the web app, styled with our design tokens in plain CSS. Everything else stays plain HTML and plain CSS (`apps/web/src/app/app.css`). The reason is keyboard and screen-reader behaviour (ADR-0009): focus management, arrow-key navigation, Escape, focus return and the ARIA roles and states of these widgets are easy to get subtly wrong by hand and hard to test for a senior audience, while Radix ships them tested and leaves the look to us.

## Considered Options

- **Hand-rolled widgets** (`<details>`, our own focus handling): no dependency, but each widget re-implements the WAI-ARIA patterns and their edge cases; the `<details>` Profile switcher had no arrow keys, no Escape and no menu semantics.
- **shadcn/ui or a styled component library**: rejected because it brings Tailwind (or another styling system) and its own look; our look comes from our tokens, whose contrast is audited in CI, and a second styling system would let pages drift below the ADR-0009 floor.
- **Tailwind**: rejected for the same reason; plain CSS on our tokens stays the single way to style.

## Consequences

- Add one `@radix-ui/react-<widget>` package per widget, only when a widget needs it; never the whole `radix-ui` bundle.
- Radix parts are styled through class names and `data-state` / `data-highlighted` attributes in `app.css`, never with inline styles or another CSS system.
- The Profile switcher is the first use (a dropdown menu). The sidebar drawer below 64rem is the second (`@radix-ui/react-dialog`). The Tailored Documents tabs on the Application page are the third (`@radix-ui/react-tabs`). The browser extension keeps its vanilla TypeScript and only shares the tokens.
