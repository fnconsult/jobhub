# PROTOTYPE — Jobbbox mobile shell (throwaway)

Branch `prototype/mobile-shell`, never merged into `main`. Written under prototype rules: no tests, no real API, data in memory.

**Question:** how should the native shell navigate on a phone and on a tablet, with the conversation as the page (ADR-0070) and the Fiche as a sheet (phone) or a column (from 64rem)?

## Run it

```bash
npm run prototype:mobile        # from the repo root: installs, then starts Expo
```

- **Phone / iPad:** install **Expo Go** (it must support SDK 58), scan the QR code. Not on the same Wi-Fi as the computer? `npm --prefix docs/prototypes/mobile-shell start -- --tunnel`.
- **Browser:** press `w` once Expo has started (or `npm --prefix docs/prototypes/mobile-shell run web`); `?variant=A|B|C` picks a variant, ← → cycle them, ⌘\ shows or hides the Sidebar, ⌘I the Fiche, Esc closes a sheet.

## What to look at

The pink bar at the bottom is the prototype's, not the design: ‹ › switch variant, « Thème » cycles Auto / Clair / Sombre, « État » shows the width in rem and why the layout chose sheet or column.

| Variant | Phone | Wide screen (≥ 64rem) |
|---|---|---|
| **A · Tiroir (Claude)** — the agreed design | ☰ opens a drawer: menus, Coach conversations, Espace coach and Mon compte at its foot | Sidebar as a column (☰ hides it); it falls back to a drawer when the conversation would keep < 28rem |
| **B · Onglets** | Bottom tabs: Accueil, Candidatures, Offres, Agenda, Coach; Mon compte top right | A labelled rail on the left |
| **C · Sans chrome** | No menu at all: destinations are chips above the composer, ⌂ goes home | Same |

Try: open « Aéroline » → **Fiche** (drag the handle between the two heights, or « Agrandir »), « Changer le statut », a suggestion (the reply streams; ■ stops it), the iPad in landscape, portrait and Split View, and the system's largest text size (the layout falls back to the phone one as rem grows).

## Not in the prototype

Icons are text glyphs (Lucide in the real app), the font is the system one (Inter in the real app), WebViews are stand-ins, phones are not locked to portrait, and iPad hardware-keyboard shortcuts work only in the browser build.

## Verdict (2026-11-04)

**Variant A · Tiroir (Claude) wins**, tried by the product owner on an iPhone in Expo Go. A drawer on a phone, the Sidebar as a column from 64rem, the Fiche as a sheet with two detents below 64rem and a column from 64rem, by the window width in rem. B (bottom tabs) and C (chips above the composer) are dropped. Recorded in ADR-0076.
