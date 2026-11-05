# Issue #686: 6-digit code in the magic-link e-mail (Better Auth email OTP)

Scope: only what implementing #686 needs. Checked on 2026-11-04 against the source of `better-auth@1.7.7` as installed (`dist/plugins/email-otp/*.mjs`, `dist/plugins/magic-link/index.mjs`) and `.d.mts` types, which is the code that will run. The docs sites (better-auth.com, developer.apple.com, reactnative.dev) were NOT reachable from this session (network allow-list), so the iOS/React Native points below are unverified.

## Better Auth email OTP plugin (verified in source)
- Plugin: `emailOTP({...})` from `better-auth/plugins`; client plugin in `email-otp/client`. Sign-in endpoint: `POST /sign-in/email-otp`, client `authClient.signIn.emailOtp({ email, otp })`. Returns `{ token, user }` and sets the session cookie. Send endpoint takes `type: "sign-in"`.
- Options: `sendVerificationOTP({ email, otp, type })` (required), `otpLength` (default 6), `expiresIn` seconds (default 300), `allowedAttempts` (default 3, so set 5), `storeOTP` (`plain` default, `hashed`, `encrypted`, or custom hash/encrypt), `disableSignUp`, `resendStrategy` (`"rotate"` or `"reuse"`), `rateLimit` (default 3 requests per 60 s per route), `overrideDefaultEmailVerification`.
- Single use: `atomicVerifyOTP` calls `consumeVerificationValue` (deletes the row) before comparing. Wrong code: row is re-created with `value:attempts+1` and the same `expiresAt`. When stored attempts >= `allowedAttempts` the call throws `TOO_MANY_ATTEMPTS` (403) and the row stays consumed, so a new e-mail must be requested. With `allowedAttempts: 5`: 5 wrong codes return `INVALID_OTP`, the 6th call (even with the right code) returns `TOO_MANY_ATTEMPTS`. Test the "5 wrong then refused" e2e accordingly.
- Expired: `OTP_EXPIRED`. Error codes: `OTP_EXPIRED`, `INVALID_OTP`, `TOO_MANY_ATTEMPTS`.
- Compare is constant-time. Use `storeOTP: "hashed"` to match the magic link's `storeToken: "hashed"` (apps/web/src/auth/index.ts:362).
- Unknown e-mail: `disableSignUp: true` returns `INVALID_OTP`; otherwise the plugin CREATES a user with `emailVerified: true`. Align with how the magic link is configured for sign-up.
- Unverified existing user: promoted through `revokeUnprovenAccountAccess`.

## Gaps against the acceptance criteria (design consequences)
1. "Same e-mail, same validity": the two plugins are independent. Magic link stores a token (`magic-link/index.mjs`, default `expiresIn` 300) and the OTP a separate verification row (`sign-in-otp-<email>` style identifier). Our code must request both in one flow and pass the same duration (`MAGIC_LINK_MINUTES * 60`) to both `expiresIn`.
2. "Using one makes the other unusable": NOT provided by Better Auth. Must be implemented: on successful OTP sign-in, delete the pending magic-link verification; on magic-link verify, delete the OTP row (hooks `after` on `/sign-in/email-otp` and `/magic-link/verify`, or `internalAdapter.deleteVerificationByIdentifier`). The magic-link identifier is computed with a hashed token, so find it by creating both from one server-side action and recording the link between them, or via the `value`/email lookup.
3. "Never logged": the plugin hands the plaintext `otp` to `sendVerificationOTP`; do not log that callback's args or the e-mail body. `storeOTP: "hashed"` keeps it out of the DB.
4. Rate limit default is 3/60 s per route; check it does not clash with the existing limiter.
5. Second step (ADR-0075): `/sign-in/email-otp` creates the session itself, so the gate (session pending for accounts with 2-step) must also hook this path, not only the magic-link verify.

## Client input hints (NOT verified here; docs unreachable)
- iOS autofill from Mail/Messages uses `textContentType="oneTimeCode"` on React Native `TextInput`; Android equivalent is `autoComplete="sms-otp"` (and web `autocomplete="one-time-code"`). Numeric keyboard: `keyboardType="number-pad"` / web `inputmode="numeric"`. Confirm in the React Native TextInput docs and Apple UITextContentType docs once allowed. Note iOS Mail suggests codes from the message text, so the e-mail should show the code as plain digits.

## To unblock the unverified part
Allow `www.better-auth.com`, `developer.apple.com`, `reactnative.dev` in the session network settings.
