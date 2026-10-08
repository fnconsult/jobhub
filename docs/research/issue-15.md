# Research for issue #15: Job Digest

Scope: only the external facts needed for the email unsubscribe link and deliverability. Checked 2026-10-08 against primary sources. Product code is out of scope.

## 1. One-click unsubscribe headers (RFC 8058)

Source: https://www.rfc-editor.org/rfc/rfc8058

- Send one `List-Unsubscribe` header with exactly one HTTPS URI (a `mailto:` may be added), plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- The message must carry a valid DKIM signature whose `h=` covers both headers. Without it, receivers must not offer one-click.
- The URI must identify the recipient and list and include an opaque, hard-to-forge token that the server verifies.
- The endpoint must accept a POST (form body `List-Unsubscribe=One-Click`), must not redirect, and must not depend on cookies or auth.

Implication: the unsubscribe endpoint is a public, token-based POST (no session). Token must scope to one Profile's digest opt-in, not the whole account.

## 2. Gmail/Yahoo bulk sender rules

Source: https://support.google.com/a/answer/81126

- Applies above 5,000 messages/day to Gmail accounts (in force since 2024-02-01). Requires SPF, DKIM, DMARC (policy may be `none`), From-domain alignment, one-click unsubscribe headers plus a visible body link, and spam rate under 0.30% (aim under 0.10%).
- The 2-day processing time sometimes quoted was not found on this page; not verified.

Implication: below the threshold the headers are not mandatory, but the AC requires an unsubscribe link anyway; adding the headers is cheap and avoids a later rework.

## 3. Amazon SES (the hosting doc names SES, eu-west-3)

Source: https://docs.aws.amazon.com/ses/latest/dg/sending-email-subscription-management.html

- SES offers optional managed subscription management (`ListManagementOptions`, or `X-SES-LIST-MANAGEMENT-OPTIONS` over SMTP). It needs Easy DKIM and cannot add links if the sender signs mail itself. It overrides your own `List-Unsubscribe` headers.
- `List-Unsubscribe` and `List-Unsubscribe-Post` can be set by hand without it.
- The repo sends through `SMTP_URL` and keeps opt-in per Profile in its own database. So the simplest fit is our own endpoint plus hand-set headers, rather than SES contact lists (which would duplicate state and tie it to SES).

## Not covered

- Legal basis for the digest (GDPR/ePrivacy consent vs. legitimate interest, CNIL guidance): not researched here; the opt-in AC is the conservative choice. Flag for legal review if wanted.
- Per-language email copy needs no external fact.
