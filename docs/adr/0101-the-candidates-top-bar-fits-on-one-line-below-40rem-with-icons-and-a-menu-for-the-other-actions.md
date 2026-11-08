# The Candidate's Top Bar fits on one line below 40rem, with icons and a « … » menu for the other actions

Status: accepted (#897)

On a phone the Top Bar of the Candidate's pages took two rows (Menu, title, then « Fiche », « Activité », « Effacer » or « Aide »), and the page moved down by that much. The fix is a rule for any narrow space, not only this bar.

- **Below 40rem, the bar of the Candidate's pages fits on one line, icons only**: Menu, the title (one line), one visible action, and « … ». Each icon is named by an `aria-label` and a tooltip and has a target of at least 44 px. Tablet, desktop and the Back Office (Compact Density) are unchanged.
- **One action is visible**: the page's own main action if it has one (`useTopBarPrimary`), otherwise « Fiche » on an object's page, otherwise « Activité ». While an AI action runs, « Activité » is the visible one, with its stop icon and the current step in its accessible name; when the run ends the visible action goes back and keyboard focus stays on it; focus on the stop icon, which goes with the run, moves to « … », where « Activité » now is.
- **The others go under « … » (« Autres actions »)** with their full labels, in a menu with arrows, Escape and focus back to « … ».
- **Each entry calls the same function as the button it replaces**, so changing what an action does is done in one place (« Activité » calls `useActivityColumn().toggle`, as AI Activity's « Activité » button does since #809, its `shown` and `controls` for `aria-expanded` and `aria-controls`).
- Buttons register their action with the bar (`useTopBarAction`); on a phone they render nothing themselves.
- **The width decides in CSS, not in the script**: the server's HTML holds both the wide buttons and the compact bar's icons, and the `width < 40rem` media query shows one set and takes the other out of the page (`display: none`, out of the accessibility tree and the tab order). The first paint is the right bar at every width, before or without JavaScript, and nothing moves at hydration; once the page knows its width it draws only that set.
