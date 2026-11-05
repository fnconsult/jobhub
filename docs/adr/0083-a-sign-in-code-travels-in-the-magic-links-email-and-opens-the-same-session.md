# A sign-in code travels in the magic link's email and opens the same session

_Builds on ADR-0011 (Candidate accounts on Better Auth), ADR-0075 (the second step) and ADR-0076 (the native app). Completes ADR-0080._

On a phone, the link in the email does not always reach the right place (the email is read on another device, the app is not installed yet). The same email therefore carries a **sign-in code** of six digits, typed in the web page or in the app.

- **One module in front of Better Auth's email OTP plugin** (`apps/web/src/auth/sign-in-code.ts`). The link's `sendMagicLink` issues the code and sends both in one email. The code is valid for as long as the link, is stored hashed, and allows five tries: the sixth is refused even with the right code, and a new email must be requested. A newer email replaces the code. The plugin serves `POST /sign-in/email-otp` only; its other endpoints answer 404. The code is never logged.
- **Using one spends the other.** Better Auth does not do this, so a database hook after the session is created does it: a sign-in by link deletes the address's code; a sign-in by code deletes every pending link for that address.
- **A session opened by code records `signInMethod` "magic-link".** It is the same email and the same proof of the address, so the second step (ADR-0075) and « Require SSO for Administrators » treat it exactly as a link's session, and a pending session refuses the code as it refuses a new link request.

## Considered Options

- **A new `signInMethod` "code"**: every rule that reads "signed in by magic link" would need the new value, with no difference in what was proved.
- **Letting the plugin's own OTP endpoints stay on**: they include password-reset and email-change flows we do not have.
- **A code that does not spend the link**: the same email would open two sessions.
