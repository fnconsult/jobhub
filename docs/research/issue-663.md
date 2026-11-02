# Research for #663: Two-step verification 1/3 (TOTP, backup codes, pending session)

Checked 2026-11-02, only what implementation needs. Primary source: Better Auth docs, `docs/content/docs/plugins/2fa.mdx` on `main` (https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/2fa.mdx). The repo pins `better-auth ^1.7.7` (apps/web/package.json): confirm each point against the installed version's types before coding. RFC 6238 / RFC 4226 / Google Key URI could not be fetched (proxy 403); not needed beyond what the plugin implements.

## Better Auth `twoFactor` plugin
- Storage: `user.twoFactorEnabled` (boolean) plus table `twoFactor` with `id, userId, secret, backupCodes, verified, failedVerificationCount, lockedUntil`. New table must go in `EXPORTED_TABLES` and account deletion; export must omit `secret` and `backupCodes`.
- `allowPasswordless: true` lets users without a credential account (magic link users) enable/disable/manage 2FA without a password. The password is still required if a credential account exists. The option does not change which sign-in methods are challenged.
- Magic link sign-in is NOT challenged by default: only `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number` return `twoFactorRedirect`. So the pending-session gate (database hook + server barrier) is ours to build, as the ADR says.
- `twoFactor.enable` (totp, default) returns `{ method: "totp", totpURI, backupCodes }`. `twoFactorEnabled` stays false until a valid code is verified (`skipVerificationOnEnable` default false: keep it). Calling enable when a verified authenticator exists returns `TOTP_ALREADY_ENABLED`.
- The TOTP URI contains the secret and email: treat as secret, render the QR locally, never via a third-party QR service. Show the secret key as text too (acceptance criterion).
- TOTP defaults: 6 digits, 30 s period, SHA-1 (imports must match). `verifyTotp` accepts one period before and after.
- `verifyTotp` / `verifyBackupCode` take `trustDevice` (default shown as `true`, 30 days, refreshed): pass `false` explicitly, trusted devices are not in scope. Verify the real default on 1.7.x. `verifyBackupCode` has `disableSession` (do not set the session cookie).
- Backup codes: defaults `amount: 10`, `length: 10`. `storeBackupCodes` is `"plain"` (default) or `"encrypted"` or a custom encryptor; the docs offer no built-in hash. The issue says "hachés": either accept encrypted storage (ADR/privacy register must say "chiffrés") or supply a custom transform and check that `verifyBackupCode` still works with it. Used code is removed (single use). `generateBackupCodes` deletes the previous set. `viewBackupCodes` is server-only and meant for fresh sessions.
- TOTP secret is encrypted at rest by the plugin with the auth secret (`symmetricEncrypt` from `better-auth/crypto`, per the import section). Auth secret rotation therefore invalidates stored secrets.
- Lockout: schema has `failedVerificationCount` and `lockedUntil` ("account lockout"), but this page does not state the threshold or duration. Unverified: the "5 errors then wait" rule may need our own counter or the plugin's rate limit config; check source (`packages/better-auth/src/plugins/two-factor`) before relying on it.
- Fresh-session requirement (< 10 min) for disable/regenerate is not provided by the plugin: store our own "last second step" timestamp.

## Implications for implementation
1. Use plugin for secret/backup storage only; do not use `twoFactorRedirect`.
2. Pass `trustDevice: false`; set no trusted-device cookie.
3. Decide hashed vs encrypted backup codes and align the privacy register wording.
4. Verify lockout behaviour and the `trustDevice` default in the installed 1.7.x source.
5. Set backup-code `amount: 10` explicitly.
