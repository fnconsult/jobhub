# Accessibility floor for a senior audience

The design is Notion-like (whites, light greys), but the audience is 40+. Every screen meets WCAG 2.1 AA:
- body text is at least 16px
- the Candidate can change the text size
- light greys are used only for surfaces and borders, never for body text
- no function is reachable only through an unlabelled icon

Don't "refine" the look by greying text or shrinking type.

## Amendment: metadata text and the exceptions it allows (issue #317, 2026-10-23)

The floor above is for body text. Metadata (a token count and a time, a renewal date, the line under a Coach reply, the words beside a closed button) may be smaller, within these limits:
- at least 0.8125rem (13 px at the standard text size), in `rem`, so it follows the Candidate's text size
- at least 4.5:1 against its background, so `#6b6a67` on white and never `#9b9a97`
- both are design tokens: `--font-size-meta` (0.8125rem) and `--color-text-meta` (`#6b6a67`), checked by the token audit
- never the only place a piece of information or a function lives

Two exceptions were also recorded:
- **The Coach shows no author names.** « Votre coach » and « Vous » are read only by screen readers. Sighted readers tell the turns apart by alignment, by a background on the Candidate's messages at least 3:1 against the surface (the accent colour, 6.2:1 against the panel), and by the activity glyph before each Coach reply.
- **The activity glyph is small (1.15em) and animated.** It is decorative (`aria-hidden`), since the step's text sits beside it. It stays still under `prefers-reduced-motion` and meets 3:1 as a graphic (`#d97757`, 3.1:1 on white). Screen readers hear when a task starts and when it ends or fails, not each step.

- Provenance lines and the tokens and time spent of a stopped action are metadata: the e2e text floor is 13 px for them (#334).

Every function keeps a visible label, on mobile too: an icon alone, even with an `aria-label` and a tooltip, does not meet the floor.

## Amendment: the AI Activity stop icon (issues #316 and #333, 2026-10-24)

One more exception, asked by the user after #316 closed (« dans les tâches, retire le libellé Arrêter garde l'icône et rajoute l'icône d'arrêt à côté du texte en cours lorsque les tâches sont cachées »):
- **In AI Activity, Stop is an icon alone.** It is a filled square in a bordered button, on each running action in the pane and, with the pane closed, beside the words of the step in progress in the top bar.
- It is named by an `aria-label` and a tooltip that say which action it stops (« Arrêter la recherche d'offres », « Arrêter la réponse du coach »), never just « Arrêter ».
- It is never the only way to stop. The Job Search's page keeps its labelled « Arrêter la recherche », and the Coach Panel's « Envoyer » becomes a labelled « Arrêter » while a reply is on its way.
- Its target is at least the top bar's control height there, and at least 2.25rem in the pane. It sits right beside the action's name or step in words, so it is never read out of context.
- Stopping asks for no confirmation. It is disabled once asked (« Arrêt en cours… »), and the stopped action stays in the pane, in words and in very light red.

The exception covers this icon only. Every other function still needs a visible label.

## Amendment: the AI Activity button (2026-10-24)

One more exception, asked by the user (« retire le libellé AI activity du bouton des tâches IA »):
- **The AI Activity button never shows its label « Activité IA ».** At rest it shows the tasks icon and the page's summary, or the icon alone on a page with no AI content and on a phone; open, a close icon; while an action runs, the step in words.
- Its label stays its accessible name and its tooltip.
- The words (the summary or the step) sit outside the button's bordered frame, which holds the icon alone, as metadata. They are still part of the one button: clicking them opens the pane, they are in its accessible name, and Tab stops once. Stop sits beside the button, after the frame.

The exception covers this button only. Every other function still needs a visible label.
