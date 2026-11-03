# Two-step verification is our own session gate, asked after a magic link only

_Builds on ADR-0011 (Candidate accounts on Better Auth, Sign-in Providers) and ADR-0016 (Human Coaches identified by email)._

Candidates may turn on Two-step verification. It is mandatory for Administrators and Human Coaches. The second step is an authenticator app code (TOTP), a passkey or a backup code. It is asked after a magic-link sign-in only. A sign-in through a Sign-in Provider counts as both steps, for every role.

A session signed in by magic link for an account that has Two-step verification, or that must have it, starts **pending**. A pending session is enforced on the server, never only in the interface. It reaches the second-step page, its own endpoints and sign-out, nothing else: no page, no API route and no extension request. The extension uses the web app's cookie (ADR-0011), so the same check covers it, and it tells the person to finish signing in on Jobbbox. The session leaves pending when a second step succeeds. If an account must have Two-step verification but has no factor yet, its pending session can only reach the setup page.

- **Who must have it** is decided on every request, not when the session starts. An Administrator holds a Back Office Role or is in `ADMIN_EMAILS`. A Human Coach matches an active `human_coach` row (ADR-0016). Someone made a coach or given a role while signed in is sent to set it up on their next request. `ADMIN_EMAILS` super-admins are not exempt, unlike Require SSO for Administrators.
- **Better Auth's two-factor plugin is used for storage and verification only.** Its sign-in flow intercepts credential sign-ins (`/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`). Jobbbox has no password, so magic-link sign-ins and OAuth callbacks would get through. The gate is ours: a column on `session`, set by our database hooks, as `signInMethod` already is. The plugin's TOTP secret and backup codes may be reused, with `allowPasswordless`.
- **Passkeys** come from `@better-auth/passkey`. Used as the second step, a passkey must belong to the pending session's account.
- **Recovery**: 10 single-use backup codes, shown once when the feature is turned on and renewable from Mon compte. Without them, a super-admin resets the account's Two-step verification in the Back Office. The reset is recorded in the Back Office Audit and emailed to the account. Turning it off, or removing the last factor, takes a second step done less than 10 minutes earlier. An Administrator or Human Coach cannot turn it off.
- **No "trust this device"**: the step is asked once per magic-link sign-in, not per page or per day.

## Considered Options

- **An emailed code as the second step**: the magic link already proves the inbox, so a second email adds nothing.
- **SMS**: a new sub-processor, phone numbers to keep, and weak against SIM swap.
- **Ask again after a Sign-in Provider**: safer, because Jobbbox cannot see whether Google or Microsoft enforced their own second step. The product owner chose not to ask twice. Require SSO for Administrators remains the way to make the Back Office depend on the organisation's identity provider.
- **Better Auth's own `twoFactorRedirect` flow**: it never runs for a magic link or an OAuth callback (see above).
- **Gate in the interface only (middleware redirects)**: an API route or the extension would accept a pending session.

## Consequences

- An Administrator or Human Coach who signs in through a provider with no second step of its own gets one factor. Choosing which Sign-in Providers are allowed for Administrators is now a security decision.
- The Data export lists the account's Two-step verification state and factors (kind, name, dates), never a TOTP secret, a backup code or a passkey's public key.
