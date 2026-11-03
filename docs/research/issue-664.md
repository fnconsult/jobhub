# Research for issue #664: Passkeys as a second step (ADR-0075)

Scope: only the external facts the issue depends on (`@better-auth/passkey`, WebAuthn via SimpleWebAuthn, Better Auth two-factor). Checked 2026-11-03 against Better Auth's docs source (raw `docs/content/docs/plugins/passkey.mdx` and `2fa.mdx` on GitHub `main`) and the npm registry. www.better-auth.com is not reachable from this session, so the docs repo was used. Product code is out of scope.

## 1. Package and version

Source: https://registry.npmjs.org/@better-auth/passkey
- `latest` is 1.7.15. `@better-auth/passkey@1.7.7` exists and has peer `better-auth ^1.7.7`, which matches the repo (`apps/web/package.json`: `"better-auth": "^1.7.7"`). Pin the passkey package to the same range ("version aligned").
- Runtime deps: `@simplewebauthn/server ^13.3.2`, `@simplewebauthn/browser ^13.3.0`, `zod`.

## 2. Setup

Source: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/passkey.mdx
- Server: `passkey()` from `@better-auth/passkey` in `plugins`. Client: `passkeyClient()` from `@better-auth/passkey/client`.
- Adds a `passkey` table (migrate or `npx auth generate`): id, name (optional), publicKey, userId (FK user), credentialID, counter, deviceType, backedUp, transports (optional), createdAt (optional), aaguid (optional). The jobhub schema/migration must include it.
- Options: `rpID` (registrable domain suffix of the auth origin; `localhost` for dev), `rpName`, `origin` (no trailing slash), `authenticatorSelection` (attachment, residentKey default `preferred`, userVerification default `preferred`). Staging and prod are different hosts, so rpID/origin must be set per environment; a passkey registered under one rpID does not work under another.
- Challenge cookie default `better-auth-passkey` (`advanced.webAuthnChallengeCookie`).

## 3. Management endpoints (needed for the Sécurité section)

Same source.
- Add: client `authClient.passkey.addPasskey({ name?, authenticatorAttachment?, ... })` (`/passkey/add-passkey`); needs a session by default (`registration.requireSession` true). If no name is given the stored name is empty (default label falls back in UI, `getAuthenticatorName(aaguid)` is best-effort and Apple returns an all-zero AAGUID).
- List: `GET /passkey/list-user-passkeys` (`passkey.listUserPasskeys`). Rows carry name, createdAt, aaguid, deviceType, backedUp, transports. Documented schema has NO `lastUsedAt`/last-used column: "dernière utilisation" in the acceptance criteria is NOT provided by the plugin. Not verified whether `counter` changes (synced authenticators often keep it at 0, so it is unusable as a signal). Plan on a custom column or our own field updated on verification.
- Rename: `POST /passkey/update-passkey { id, name }`. Delete: `POST /passkey/delete-passkey { id }`. Both require a session.

## 4. Passkey as a 2FA step: the plugin does not do it

Sources: passkey.mdx above; https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/2fa.mdx
- The 2FA plugin documents only TOTP, OTP and backup codes (`verifyTotp`, `verifyOtp`, `verifyBackupCode`, optional `trustDevice` 30 days). Passkey is not a documented second factor. 2fa.mdx line 136: passkey, magic link and other passwordless sign-ins "are not gated by 2FA by default".
- The passkey plugin's documented sign-in is `signIn.passkey` (`/sign-in/passkey`), which creates a full session. Nothing documented ties a passkey assertion to a pending two-factor session.
- Consequence: acceptance criteria "valid with a passkey alone", "key must belong to the account of the pending session, otherwise refused and the session stays pending" and "10 backup codes shown" require custom server code. Not verified: whether the plugin exposes a verify-only endpoint (assertion check without creating a session), and how pending-2FA session state is represented. Read the installed package source (`generatePasskeyAuthenticationOptions`, `verifyPasskeyAuthentication`) before designing; do not assume.
- 2fa.mdx line 95: enabling 2FA requires a password by default; users who signed up via passkeys/magic links need `allowPasswordless: true`. Magic-link-only jobhub accounts need that flag. Also, `enable` returns TOTP details and backup codes for `method: "totp"` only; backup-code generation for a passkey-only setup is a separate call (`/two-factor/generate-backup-codes`, needs session) and must be checked against whatever state "2FA enabled" means without a TOTP secret.
- Our magic-link login is not gated by 2FA by default (same line 136), so ADR-0075's pending-session behaviour is custom regardless.

## 5. WebAuthn facts

Source: passkey.mdx ("Debugging" links https://developer.chrome.com/docs/devtools/webauthn)
- Plugin uses SimpleWebAuthn (https://simplewebauthn.dev/). RP ID rule: registrable domain suffix, never an eTLD.
- e2e: Chromium virtual authenticator via DevTools Protocol (`WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator`). NOT verified here: exact CDP parameters (need `hasResidentKey`, `hasUserVerification`, `isUserVerified`, `automaticPresenceSimulation`); check https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/ when writing the test. WebAuthn requires a secure context; `http://localhost` is allowed, so the e2e rpID must be `localhost`.

## 6. Data export / privacy

- Plugin stores `publicKey` and `credentialID`; the issue says never export the public key. Exportable fields available: name, aaguid/deviceType (device model, only if known), createdAt. Last use depends on section 3.
- Not researched: GDPR classification of WebAuthn public keys and AAGUIDs (left to the « Légal » issue of #663).

## 7. Not checked

- Autofill/conditional UI (out of scope: direct passkey sign-in is excluded).
- Safari/iOS behaviour of platform authenticators; browser support matrix.
