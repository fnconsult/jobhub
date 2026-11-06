# The sign-in page offers a new email after every refused code, because the server does not say why

_Builds on ADR-0083 (a sign-in code travels in the magic link's email)._

Better Auth's email OTP answers `INVALID_OTP` both for a wrong code and for a code that no longer exists (link already used, five tries spent, a newer email sent). Only the sixth try on a live code answers `TOO_MANY_ATTEMPTS`.

- **The web page offers « Recevoir un nouvel e-mail » from the first refused code on, and keeps it.** It cannot tell a typo from a dead code, so it never takes the button back: a person whose code is gone would otherwise be stuck without a way out.
- **The server does not tell the two cases apart.** A distinct answer for "no code" would show anyone whether an address is waiting for a code. The page stays as blind as the attacker would be.
- The mobile app already shows its resend button at all times.

## Considered Options

- **Hiding the button after the first `INVALID_OTP`, showing it only on `TOO_MANY_ATTEMPTS`**: the original behaviour (#755). A dead code answers `INVALID_OTP`, so the person had no way to ask for a new email.
- **A distinct error for a code that no longer exists**: reveals which addresses have a pending code.
