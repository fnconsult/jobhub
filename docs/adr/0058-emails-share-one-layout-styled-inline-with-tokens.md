# Emails share one layout, styled inline from the Design System tokens

Step 6 of ADR-0053's migration (#472). The seven emails (sign-in, Job Digest, Follow-up, abandoned Follow-up, Appointment Reminder, Apple sign-in failure alert, web-search spend alert) were plain text, each worded on its own.

- **One structure, two parts.** Each email is a pure function returning a title, paragraphs, Job Offer cards, at most one button and a footer; `renderEmail` turns it into the text part and the HTML part, so both always say the same thing. The layout adds the greeting and the signature in the email's language.
- **Inline styles from the light tokens (Confort Density), table-based.** Mail clients drop or rewrite `<style>`, so the look does not depend on it; a `<style>` in the head only adds the dark token values under `prefers-color-scheme: dark` and Outlook.com's `[data-ogsc]`. A lint (no external stylesheet, web font, script, flex or grid; alt text on images; table layout) runs on every email.
- **No images and no web fonts.** Inter heads the font stack and falls back to the system fonts.
- **The mailer writes the sender address into the footer**, from `MAIL_FROM`, so the emails do not need the live setting passed in.
- **The admin alerts stay French by default** but can take a language.
- **Screenshot baselines render with Inter injected** as a data-URI font, so they do not depend on a machine's fallback font.

Alternative not taken: an HTML email framework (MJML, React Email). One layout of a few functions does not justify a build step or a dependency.
