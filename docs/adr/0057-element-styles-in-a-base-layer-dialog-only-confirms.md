# Element styles sit in a base layer below components, and the Dialog only confirms

The component layer of ADR-0053 landed in #462. Three choices there are easy to undo by accident and surprising without context.

- **Cascade layers**: the shared design CSS declares `@layer base, components;`. Element styles (`dt`, `dd`, `h2`…) live in `base`, component styles in `components`, and a page's own unlayered CSS beats both. Global element rules left unlayered in `app.css` overrode component styles, so they moved into `base`. New global element rules go in `base`, never unlayered.
- **The Dialog is for confirmations only** (`role="alertdialog"`, focus starts on « Annuler »). Anything the person fills in opens in a Drawer, which is why the five former Radix dialogs (criteria, Agenda entry, Coaching Session date, Signalement, and the phone menu) became Drawers.
- **Small text is for metadata only** (ADR-0009): pills, small buttons, segmented options and field errors stay at body size. Only hints, table column headers, a Stat's metadata line, the page header eyebrow and raised cents use the metadata size, in the metadata colour. The Toast uses its own `inverse` and `onInverse` tokens, contrast-checked.

The components page is served only to e2e and development builds; the Back Office Design System page stays #463.

## Amended by ADR-0070

On the Candidate's pages, anything the person fills in (Signalement included) opens in the Work Pane beside the conversation, not in a Drawer (ADR-0070). The Drawer stays for the Back Office and for the Sidebar on phones; the Dialog still only confirms, « Effacer la conversation » included.
