# One Design System in Mercury's direction, with two Densities and a component layer on our tokens

The search refresh (#396–#409) shipped far from the finish of the Paramètres prototype (branch `prototype/parametres`, variant A). The production UI is one global `app.css` of about 5,300 lines whose classes are 70–80% feature-specific, with no Button, Table, Drawer, Toast or EmptyState component, no dark mode and no visual test. Decided in a grilling session on the whole platform's visual UI (2026-10-27), with Mercury's web app (Mobbin) as the reference.

- **Mercury is the visual direction**: its palette structure, buttons, shell, tables, charts, detail drawer and empty states. The Paramètres prototype stays the bar for finish: hairlines, muted secondary text, provenance pills, status dot plus words. This replaces ADR-0009's "Notion-like" look. The look chosen is variant A of the Design System prototype (branch `prototype/design-system`), named « Mercury pur »: cool greys, an indigo accent, pill-shaped controls, a Top Bar with search. The replies of the Coach and the Assistant are unframed text after their Activity glyph.
- **The refresh covers the skin, the components and the shell, and the layout of pages**: hierarchy, grouping and the length of intro texts. It does not change routes or navigation.
- **Surfaces**: the Candidate app and the Back Office come first. The browser extension takes the tokens and the simple components and moves into a side panel (ADR-0050). Emails become sober branded HTML with a plain-text part, last.
- **One Design System, two Densities**: Confort on the Candidate side (ADR-0009's floor, the Text Size) and Compact in the Back Office (amendment to ADR-0009).
- **Dark mode is prepared from the start**: every semantic token has a light and a dark value. Dark mode follows `prefers-color-scheme` and a choice in Préférences, and ships once the screens are migrated.
- **A component layer on our tokens, ADR-0018 kept**: Button, Field, Table, Tabs, Drawer, Dialog, Badge/Pill, Toast, EmptyState, Card/Stat and PageHeader. Each has its own CSS beside it, on the tokens, in cascade layers. Radix stays for the complex widgets. `app.css` shrinks as screens migrate.
- **Accessibility stays checked in CI**: the token audit (ADR-0009) covers both themes and both Densities. The screenshot specs also run axe.
- **Type is Inter**, self-hosted (no Google Fonts), with tabular figures for numbers. The system font stack is the fallback.
- **Icons come from Lucide only** (ISC licence), drawn inline at stroke 1.7. Every function keeps its visible label (ADR-0009). The Activity glyphs and the Signalement glyphs stay our own.
- **Motion is short and functional**: 150–220 ms ease-out on drawers, dialogs, toasts and hovers. Data never animates, and nothing moves under `prefers-reduced-motion`.
- **Everything is in `rem`**, so the Text Size applies to both Densities, the Back Office included.
- **A logo is out of scope**: a wordmark and monogram are designed separately. Until then, a square « J » in the accent colour stands in.
- **Migration order**:
  0. Tokens (light and dark), Inter, the two Densities.
  1. The components, the Design System page and the screenshot baselines.
  2. The shell on both sides: Sidebar, Top Bar, Coach Panel and Back Office Assistant.
  3. The Back Office: Paramètres, Dashboard and Activité first (their prototype is the yardstick), then the rest.
  4. The Candidate side: Recherches d'offres, Candidatures, Agenda, Profile, Mon compte.
  5. The extension's Side Panel (ADR-0050).
  6. HTML emails.
  7. Dark mode switched on.
- **Verified three ways**:
  1. A Design System page lists every component and token, in both Densities and both themes. It is a Back Office page under Plateforme, readable by every Back Office Role, and built from the real components.
  2. Playwright screenshot baselines of key screens (light, dark, three widths) are compared in CI.
  3. The first migrated page of each family (table, form, dashboard, Candidate list) is reviewed side by side with its prototype by the user.

## Considered Options

- **Keep the prototype's Notion look and borrow Mercury's patterns only**: the user asked for Mercury.
- **Restyle tokens and CSS only**: the gap to the prototype is as much layout and text length as colour.
- **shadcn/ui and Tailwind**: rejected again for ADR-0018's reasons (a second styling system, contrast audited only on our tokens). What is missing is components, not a framework.
- **One density everywhere**: either the Back Office stays loose or the Candidate side loses ADR-0009's floor.
