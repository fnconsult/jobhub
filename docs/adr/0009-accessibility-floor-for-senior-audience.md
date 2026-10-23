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
- never the only place a piece of information or a function lives

Two exceptions were also recorded:
- **The Coach shows no author names.** « Votre coach » and « Vous » are read only by screen readers. Sighted readers tell the turns apart by alignment, by a background on the Candidate's messages at least 3:1 against the surface, and by the activity glyph before each Coach reply.
- **The activity glyph is small (1.15em) and animated.** It is decorative (`aria-hidden`), since the step's text sits beside it. It stays still under `prefers-reduced-motion` and meets 3:1 as a graphic (`#d97757`, 3.1:1 on white). Screen readers hear when a task starts and when it ends or fails, not each step.

Every function keeps a visible label, on mobile too: an icon alone, even with an `aria-label` and a tooltip, does not meet the floor.
