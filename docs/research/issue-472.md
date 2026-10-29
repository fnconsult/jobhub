# Issue #472: HTML emails, external facts

Scope: only what implementing #472 needs. Sources are first-party; fetched 2026-10-28.

## Brevo transactional API (`POST /v3/smtp/email`)
Source: https://developers.brevo.com/reference/sendtransacemail
- `htmlContent` is required when no `templateId` is used; `textContent` is optional. The page states no "at least one of" rule, so always send both.
- `sender`, `subject` required without `templateId`; `to` required without `messageVersions`.
- `headers` accepts custom non-standard headers in Title-Case. The page does not confirm `List-Unsubscribe` can be set this way. Verify against staging before relying on it.
- Name fields are limited to 70 characters. No documented size limit for `htmlContent`/`textContent`.

## One-click unsubscribe (RFC 8058)
Source: https://www.rfc-editor.org/rfc/rfc8058 (sections 3.1, 4)
- Needs `List-Unsubscribe` with an HTTPS URI and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Both headers must be covered by a valid DKIM signature. Out of scope for #472 (footer link only), but relevant if headers are added later.

## Mail-client CSS support
Source: https://www.caniemail.com/features/html-style/
- `<style>` is not supported inside `<body>` in Gmail; Gmail webmail caps the style tag at 16 KB; Outlook for Windows is buggy with it.
- Consequence: inline all styles (as the issue specifies); use `<style>` only for optional enhancements.
- `prefers-color-scheme` support was not covered by the page fetched; not verified. Treat dark mode as "palette that stays legible when a client inverts colours", not as a media-query guarantee.

## Implementation implications
- Table layout, inline styles, images with `alt`, no external CSS.
- Mailers: Brevo `htmlContent` + `textContent`; SMTP multipart/alternative.
